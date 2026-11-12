'use client';

/**
 * Auswertungs-Seite eines Rollenspiels (COACH-UX-BLUEPRINT §3/W1-7):
 * lädt /api/simulation/get und rendert die gemeinsame SimulationEvaluation.
 * Aktive (unfertige) Simulationen leiten zum Einstieg weiter — dort läuft
 * der Chat; diese Route ist ausschließlich das ERGEBNIS.
 *
 * Paket 3, U12 und S7 (12.11.2026): Die Auswertung läuft als Auftrag. Rechnet sie noch (`finishing`), zeigt die
 * Seite die Warteansicht mit dem eigenen Gespräch, fragt alle 2 s den Status und lädt das Ergebnis ohne
 * Seitenwechsel. Ist sie gescheitert (`active` mit `finishError`), steht hier der Weg zurück: noch einmal
 * auswerten oder ins Gespräch. Ablauf und Formate: WELLE2-ABLAUF.md, Regeln in auswertung-ablauf.ts.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import AppShell from '@/components/app/app-shell';
import { authFetch } from '@/lib/api-client';
import { aiErrorMessage } from '@/lib/api-error-text';
import { decideApiFailure, type ApiFailureBody, type ApiFailureDecision } from '@/lib/simulation/api-failure';
import {
  ABGLEICH_ABSTAND_MS,
  ABGLEICH_VERSUCHE,
  STATUS_ABSTAND_MS,
  STATUS_FEHLER_MAX,
  abgleichStehtAus,
  seitenPhase,
  type CheckinLike,
} from '@/lib/simulation/auswertung-ablauf';
import { empfehlbareSzenarien, type EndscreenScenario } from '@/lib/simulation/endscreen';
import { useTranslation } from '@/i18n/useTranslation';
import { SimulationEvaluation } from '@/components/simulation/simulation-evaluation';
import { EvalFehlschlag, EvalWarten } from '@/components/simulation/eval-warten';
import {
  splitTitle,
  type SimEvalDebrief,
  type SimEvalDelta,
  type SimEvalFeedback,
  type SimEvalHistoryPoint,
  type SimEvalRating,
  type SimEvalTurn,
} from '@/components/simulation/eval-teile';

interface LoadedSim {
  scenarioId: string;
  scenarioTitle: string | null;
  personaName: string | null;
  feedback: SimEvalFeedback;
  debrief: SimEvalDebrief | null;
  delta: SimEvalDelta | null;
  attempt: number;
  focus: string | null;
  ratings: SimEvalRating[] | null;
  /** A1: Selbsteinschätzung aus dem Check-in (für die Selbstbild-Karte); bei alten Läufen der Freitext. */
  selfAssessment: string | null;
  /** Paket 3: die zwei Antworten des Check-ins (fehlt bei alten Läufen). */
  checkin: CheckinLike | null;
  /** Züge des Gesprächs: Reiter „Gespräch“, Sprungziele der Zitate, Kennzahlen. */
  turns: SimEvalTurn[] | null;
  convoLocale: string | null;
  /** B2: Modus + Härtegrad des Laufs (Badges in der Auswertung). */
  mode: 'practice' | 'check';
  hardness: 'mild' | 'standard' | 'hart';
  /** O2: vom Lernenden angepasster Vorsatz (null = Modellvorschlag gilt). */
  commitment: { text: string; source: 'model' | 'user' } | null;
}

/** Lauf, dessen Auswertung noch rechnet oder gescheitert ist: nur, was Warteansicht und Fehlschlag brauchen. */
interface PendingSim {
  scenarioTitle: string | null;
  personaName: string | null;
  turns: SimEvalTurn[];
  /** Letzter Fehlschlag (Fehlerart der KI oder `STALE`, dazu die Fehler-Nummer). */
  finishError: { code?: string | null; requestId?: string | null } | null;
}

/** finishing = Auswertung rechnet (Warteansicht) · failed = gescheitert, Lauf wieder offen. */
type Phase = 'loading' | 'finishing' | 'failed' | 'ready' | 'notfound' | 'error';

const KEIN_WARTESTAND = { startedAt: null as string | null, typicalMs: null as number | null, offsetMs: 0 };

export default function EvalClient() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams<{ simId: string }>();
  const simId = typeof params?.simId === 'string' ? params.simId : '';

  const [state, setState] = useState<Phase>('loading');
  const [sim, setSim] = useState<LoadedSim | null>(null);
  const [pending, setPending] = useState<PendingSim | null>(null);
  // Warteansicht: Start und übliche Dauer aus `status`, Abstand der Server-Uhr aus der Kopfzeile `Date`.
  const [wait, setWait] = useState(KEIN_WARTESTAND);
  // Nach dem Verlassen der Seite setzt keine späte Antwort mehr einen Zustand oder wechselt die Seite.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // W3-1: Katalog-Projektion für den Delta-CTA (best effort — ohne Katalog
  // erscheint der Satz ohne Szenario-Button). U15: mit den Fähigkeiten je Szenario statt C1 bis C10.
  const [scenarios, setScenarios] = useState<EndscreenScenario[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch('/api/simulation/scenarios');
        const json = await res.json().catch(() => null);
        if (!cancelled && res.ok && json?.ok && Array.isArray(json.scenarios)) {
          setScenarios(empfehlbareSzenarien(json.scenarios));
        }
      } catch {
        /* CTA degradiert ohne Katalog */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // A3: Verlaufskurve — alle Versuche desselben Szenarios (best effort;
  // ohne Historie fehlt nur die Kurve, der Rest der Auswertung steht).
  const [history, setHistory] = useState<SimEvalHistoryPoint[]>([]);
  useEffect(() => {
    if (!sim?.scenarioId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch('/api/simulation/list?limit=100');
        const json = await res.json().catch(() => null);
        if (!cancelled && res.ok && json?.ok && Array.isArray(json.items)) {
          setHistory(
            json.items
              .filter(
                (i: { scenarioId: string; status: string }) =>
                  i.scenarioId === sim.scenarioId && i.status === 'finished'
              )
              .map((i: { id: string; attempt?: number; overall?: number | null }) => ({
                id: i.id,
                attempt: i.attempt ?? 1,
                overall: typeof i.overall === 'number' ? i.overall : null,
              }))
          );
        }
      } catch {
        /* Kurve degradiert still */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sim?.scenarioId]);

  /**
   * Lädt den Lauf und entscheidet die Ansicht (seitenPhase). Gibt sie zurück, damit die Status-Abfrage weiß,
   * ob sie weiterläuft. Alte Läufe ohne die neuen Felder landen wie bisher in der Auswertung oder am Einstieg.
   */
  const load = useCallback(async (): Promise<Phase> => {
    try {
      const res = await authFetch(`/api/simulation/get?simId=${encodeURIComponent(simId)}`);
      if (res.status === 404 || res.status === 400) {
        if (alive.current) setState('notfound');
        return 'notfound';
      }
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error('load');
      if (!alive.current) return 'loading';
      const s = json.simulation;
      const phase = seitenPhase(s);
      if (phase === 'home') {
        // Noch aktiv (ohne Fehlschlag) oder abgebrochen → der Chat lebt am Einstieg; Wiederaufnahme dort.
        router.replace('/');
        return 'loading';
      }
      const scenarioTitle: string | null = json.scenario?.title ?? null;
      const personaName: string | null = json.scenario?.persona?.name ?? null;
      const turns: SimEvalTurn[] | null = Array.isArray(s.turns) ? s.turns : null;
      if (phase === 'ready') {
        setSim({
          scenarioId: s.scenarioId,
          scenarioTitle,
          personaName,
          feedback: s.feedback,
          debrief: s.debrief ?? null,
          delta: s.delta ?? null,
          attempt: s.attempt ?? 1,
          focus: s.focus ?? null,
          ratings: s.competencyRatings ?? null,
          selfAssessment: s.selfAssessment ?? null,
          checkin: s.checkin ?? null,
          turns,
          convoLocale: s.convoLocale ?? json.scenario?.locale ?? null,
          mode: s.mode ?? 'practice',
          hardness: s.hardness ?? 'standard',
          commitment: s.commitment ?? null,
        });
      } else {
        setPending({ scenarioTitle, personaName, turns: turns ?? [], finishError: phase === 'failed' ? s.finishError : null });
      }
      setState(phase);
      return phase;
    } catch {
      if (alive.current) setState('error');
      return 'error';
    }
  }, [simId, router]);

  useEffect(() => {
    if (simId) void load();
  }, [simId, load]);

  // Paket 3, U12 und S7: Solange gerechnet wird, alle 2 s den Status fragen. Die Abfrage endet mit dem Ergebnis,
  // mit dem Fehlschlag und beim Verlassen der Seite.
  useEffect(() => {
    if (state !== 'finishing' || !simId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fails = 0;
    const tick = async () => {
      let weiter = true;
      try {
        const res = await authFetch(`/api/simulation/status?simId=${encodeURIComponent(simId)}`, { cache: 'no-store' });
        const json = await res.json().catch(() => null);
        if (stopped) return;
        if (res.ok && json?.ok) {
          fails = 0;
          if (json.status === 'finishing') {
            const startedAt: string | null = typeof json.startedAt === 'string' ? json.startedAt : null;
            const serverNow = Date.parse(res.headers.get('date') ?? '');
            setWait((w) => ({
              startedAt,
              typicalMs: typeof json.typicalMs === 'number' ? json.typicalMs : null,
              // Abstand zur Server-Uhr nur einmal je Rechnung bestimmen (die Kopfzeile kennt nur ganze Sekunden).
              offsetMs: startedAt && w.startedAt === startedAt ? w.offsetMs : Number.isFinite(serverNow) ? serverNow - Date.now() : 0,
            }));
          } else {
            // Fertig, gescheitert oder abgebrochen: `get` entscheidet die Ansicht, ohne Seitenwechsel.
            weiter = (await load()) === 'finishing';
          }
        } else {
          fails += 1;
        }
      } catch {
        fails += 1;
      }
      if (stopped || !weiter) return;
      if (fails >= STATUS_FEHLER_MAX) {
        // Der Status ist nicht erreichbar: ein letzter Blick auf den Lauf, sonst die Fehlermeldung.
        if ((await load()) === 'finishing' && !stopped) setState('error');
        return;
      }
      timer = setTimeout(tick, STATUS_ABSTAND_MS);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [state, simId, load]);

  // Paket 3: Ist der Check-in beantwortet, der Abgleich „Selbstbild und Auswertung“ aber noch nicht da, bis zu
  // dreimal im Abstand von 4 s nachladen. Kommt er nicht, fehlt nur diese eine Karte.
  const [abgleichAufgegeben, setAbgleichAufgegeben] = useState(false);
  const abgleichOffen =
    state === 'ready' && !!sim && !abgleichAufgegeben && abgleichStehtAus(sim.checkin, sim.feedback.selfReview);
  useEffect(() => {
    if (!abgleichOffen || !simId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let versuche = 0;
    const tick = async () => {
      versuche += 1;
      try {
        const res = await authFetch(`/api/simulation/get?simId=${encodeURIComponent(simId)}`);
        const json = await res.json().catch(() => null);
        if (stopped) return;
        const selfReview = res.ok && json?.ok ? json.simulation?.feedback?.selfReview : null;
        if (selfReview) {
          setSim((prev) => (prev ? { ...prev, feedback: { ...prev.feedback, selfReview } } : prev));
          return;
        }
      } catch {
        /* nächster Versuch */
      }
      if (stopped) return;
      if (versuche >= ABGLEICH_VERSUCHE) setAbgleichAufgegeben(true);
      else timer = setTimeout(tick, ABGLEICH_ABSTAND_MS);
    };
    timer = setTimeout(tick, ABGLEICH_ABSTAND_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [abgleichOffen, simId]);

  const ts = t.simulation;
  const titleSource = sim?.scenarioTitle ?? pending?.scenarioTitle ?? null;
  const subtitle = titleSource ? splitTitle(titleSource).heroTitle : undefined;

  // Paket 3: „Noch einmal auswerten“ nach einem Fehlschlag. `finish` antwortet sofort; gerechnet wird im Hintergrund.
  const [retryBusy, setRetryBusy] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [topUpUrl, setTopUpUrl] = useState<string | null>(null);
  /** Satz zu einer Fehlerantwort von `finish` (Entscheidung aus api-failure.ts, Texte aus dem Wörterbuch). */
  function failureText(d: ApiFailureDecision, body: ApiFailureBody | null, res: Response): string {
    switch (d.kind) {
      case 'credits':
        return d.text === 'member' ? t.common.balanceEmptyMember : ts[d.text];
      case 'ai':
        return aiErrorMessage(t.aiErrors, body, res, ts.genericError) ?? ts.genericError;
      case 'kiAus':
        return d.text ?? ts.genericError;
      case 'server':
        return d.text;
      case 'wait':
        return ts.rateLimited.replace('{n}', String(d.seconds));
      case 'text':
        return ts[d.key];
      default:
        return ts.genericError;
    }
  }
  async function retryFinish() {
    if (retryBusy) return;
    setRetryBusy(true);
    setRetryError(null);
    setTopUpUrl(null);
    try {
      const res = await authFetch('/api/simulation/finish', { method: 'POST', body: JSON.stringify({ simId }) });
      const body = (await res.json().catch(() => null)) as (ApiFailureBody & { ok?: boolean; status?: string }) | null;
      if (!alive.current) return;
      if (res.ok && body?.ok) {
        if (body.status === 'finishing') {
          setWait(KEIN_WARTESTAND);
          setState('finishing');
        } else {
          await load();
        }
        return;
      }
      const d = decideApiFailure(res.status, body, res.headers.get('retry-after'));
      // Der Lauf wird schon ausgewertet oder ist es (z. B. im zweiten Fenster): kein Fehler, neu laden.
      if ((d.kind as string) === 'evaluation') {
        await load();
        return;
      }
      setTopUpUrl(d.kind === 'credits' ? d.topUpUrl : null);
      setRetryError(failureText(d, body, res));
    } catch {
      if (alive.current) setRetryError(ts.genericError);
    } finally {
      if (alive.current) setRetryBusy(false);
    }
  }

  // Löschrecht (Owner-Vorgabe 04.08.): Nach W1 zeigt der Einstieg nur noch
  // OFFENE Läufe — ohne diesen Knopf wäre eine abgeschlossene Simulation
  // nirgends mehr löschbar. Zweistufig wie in der Liste, endgültig inkl. DB.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  async function deleteSim() {
    if (deleting) return;
    setDeleting(true);
    try {
      const res = await authFetch('/api/simulation/delete', {
        method: 'POST',
        body: JSON.stringify({ simId }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error('delete');
      router.push('/runs-dashboard');
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
      setState('error');
    }
  }

  const deleteAction = (
    <div className="flex items-center gap-2">
      {confirmDelete ? (
        <>
          <span className="hidden text-xs text-muted-foreground sm:inline">{ts.deleteConfirm}</span>
          <button
            onClick={() => void deleteSim()}
            disabled={deleting}
            className="pn-none inline-flex items-center gap-1.5 rounded-lg border border-rose-500/50 bg-rose-500/15 px-3 py-1.5 text-sm font-medium text-rose-800 dark:text-rose-400 transition-colors hover:bg-rose-500/25 disabled:opacity-50"
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {ts.deleteSim}
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            {t.common.cancel}
          </button>
        </>
      ) : (
        <button
          onClick={() => setConfirmDelete(true)}
          title={ts.deleteSim}
          aria-label={ts.deleteSim}
          className="pn-none inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-rose-500/30 hover:text-rose-800 dark:hover:text-rose-400"
        >
          <Trash2 className="h-4 w-4" />
          <span className="hidden sm:inline">{ts.deleteSim}</span>
        </button>
      )}
    </div>
  );

  if (state === 'loading') {
    return (
      <AppShell title={ts.feedbackTitle}>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t.common.loading}
        </div>
      </AppShell>
    );
  }

  if (state === 'finishing' && pending) {
    return (
      <AppShell title={ts.feedbackTitle} subtitle={subtitle}>
        <EvalWarten
          startedAt={wait.startedAt}
          typicalMs={wait.typicalMs}
          offsetMs={wait.offsetMs}
          turns={pending.turns}
          personaName={pending.personaName}
        />
      </AppShell>
    );
  }

  if (state === 'failed' && pending) {
    return (
      <AppShell title={ts.feedbackTitle} subtitle={subtitle}>
        <EvalFehlschlag
          detail={aiErrorMessage(
            t.aiErrors,
            { aiCode: pending.finishError?.code, requestId: pending.finishError?.requestId },
            null
          )}
          error={retryError}
          topUpUrl={topUpUrl}
          busy={retryBusy}
          onRetry={() => void retryFinish()}
          onBack={() => router.push(`/?simId=${encodeURIComponent(simId)}`)}
        />
      </AppShell>
    );
  }

  if (state !== 'ready' || !sim) {
    return (
      <AppShell title={ts.feedbackTitle}>
        <div className="pn-none glass-panel max-w-xl rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-rose-800 dark:text-rose-400 mt-0.5 shrink-0" />
          <div>
            <p>{state === 'notfound' ? t.evaluation.notFound : ts.genericError}</p>
            <button onClick={() => router.push('/')} className="mt-2 underline text-primary">
              {t.evaluation.backHome}
            </button>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title={ts.feedbackTitle} subtitle={subtitle} actions={deleteAction}>
      <SimulationEvaluation
        personaName={sim.personaName}
        feedback={sim.feedback}
        debrief={sim.debrief}
        delta={sim.delta}
        attempt={sim.attempt}
        focus={sim.focus}
        ratings={sim.ratings}
        selfAssessment={sim.selfAssessment}
        checkin={sim.checkin}
        selfReviewPending={abgleichOffen}
        turns={sim.turns}
        convoLocale={sim.convoLocale}
        mode={sim.mode}
        hardness={sim.hardness}
        history={history}
        currentScenarioId={sim.scenarioId}
        scenarios={scenarios}
        onOpenScenario={(scenarioId) =>
          router.push(`/?szenario=${encodeURIComponent(scenarioId)}`)
        }
        onRetry={(focusText) =>
          router.push(
            `/?szenario=${encodeURIComponent(sim.scenarioId)}&fokus=${encodeURIComponent(focusText)}`
          )
        }
        initialCommitment={sim.commitment?.text ?? null}
        onCommit={(text, source) => {
          // N17 (11.10.2026): Vorsatz erst mit dem Klick — übernommen (model) oder eigene Worte (user).
          void authFetch('/api/simulation/commit', {
            method: 'POST',
            body: JSON.stringify({ simId, text, source }),
          }).catch(() => undefined);
        }}
        onNew={() => router.push('/')}
      />
    </AppShell>
  );
}
