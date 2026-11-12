'use client';

/**
 * Gemeinsame Rollenspiel-Auswertung (COACH-UX-BLUEPRINT §3/W1-7+W1-8) auf der eigenen Route
 * /simulation/[simId]: verlinkbar, bookmarkbar, Reload-fest.
 *
 * Paket 3, U14 und S10 (12.11.2026): vier Reiter statt einer langen Seite mit zwölf Abschnitten.
 * „Überblick“ · „Fähigkeiten“ · „Gespräch“ · „Weiter üben“ liegen je in einer eigenen Datei (eval-*.tsx);
 * hier stehen der Kopf, die Reiterleiste und der Zustand, den mehrere Reiter teilen (Vorsatz, Sprung vom
 * Zitat zur Stelle im Gespräch, Rechenweg). Der aktive Reiter steht als `#name` in der Adresse.
 * Inhaltlich ist die Auswertung unverändert; neu sind das Gespräch zum Nachlesen (U17, S12), die Messlatte (S11)
 * und „Sachlich nicht gedeckt“ (S13).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessagesSquare, Sparkles } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  checkinAntworten,
  reiterAusHash,
  type AuswertungReiter,
  type CheckinLike,
} from '@/lib/simulation/auswertung-ablauf';
import { findeZitatStelle, markiereZuege, type ZitatEingabe } from '@/lib/simulation/zitat-stelle';
import { useTranslation } from '@/i18n/useTranslation';
import { EvalFaehigkeiten } from './eval-faehigkeiten';
import { EvalGespraech } from './eval-gespraech';
import { EvalUeberblick } from './eval-ueberblick';
import { EvalWeiterUeben } from './eval-weiter-ueben';
import type {
  SimEvalDebrief,
  SimEvalDelta,
  SimEvalFeedback,
  SimEvalHistoryPoint,
  SimEvalRating,
  SimEvalTurn,
} from './eval-teile';

/**
 * Kürzt an der letzten Wort-/Satzgrenze vor `max` (statt mitten im Wort).
 * Exportiert, damit die Regel getestet ist — sie steht im Eingabefeld des
 * Nutzers und ist damit sichtbarer Text, kein Detail.
 */
export function truncateAtWord(input: string, max: number): string {
  const s = String(input ?? '').trim();
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  // Bevorzugt am Satzende schneiden, sonst am letzten Leerzeichen.
  const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  if (sentence > max * 0.5) return head.slice(0, sentence + 1).trim();
  const space = head.lastIndexOf(' ');
  return (space > 0 ? head.slice(0, space) : head).trim();
}

/** Ein Reiter bleibt eingehängt, wenn er nicht zu sehen ist: Eingaben (Vorsatz) und Aufgeklapptes bleiben stehen. */
const REITER_FLAECHE = 'mt-5 space-y-6 data-[state=inactive]:hidden';

export function SimulationEvaluation(props: {
  personaName: string | null;
  feedback: SimEvalFeedback;
  debrief: SimEvalDebrief | null;
  delta: SimEvalDelta | null;
  attempt: number;
  focus: string | null;
  ratings: SimEvalRating[] | null;
  /** A1: der Freitext alter Läufe aus dem Check-in (wörtlich, für die Karte „Selbstbild und Auswertung“). */
  selfAssessment?: string | null;
  /** Paket 3: die zwei Antworten des Check-ins (neue Läufe). */
  checkin?: CheckinLike | null;
  /** Paket 3: Der Check-in ist da, der Abgleich wird noch nachgeladen. */
  selfReviewPending?: boolean;
  /** Züge des Gesprächs: Reiter „Gespräch“, Sprungziele der Zitate, Kennzahlen (null = entfällt). */
  turns?: SimEvalTurn[] | null;
  /** A2: Gesprächssprache — wählt das Weichmacher-Lexikon. */
  convoLocale?: string | null;
  /** A3: alle Versuche dieses Szenarios für die Verlaufskurve (inkl. aktuellem). */
  history?: SimEvalHistoryPoint[] | null;
  /** B2: Modus + Härtegrad des Laufs (Badges). */
  mode?: 'practice' | 'check';
  hardness?: 'mild' | 'standard' | 'hart';
  /** Szenario dieser Auswertung (für den Delta-CTA: Abwechslung schlägt Wiederholung). */
  currentScenarioId?: string | null;
  /** Katalog-Projektion für den Delta-CTA (W3-1); leer = kein CTA-Szenario. */
  scenarios?: Array<{ id: string; title: string; competencyFocus?: string[] }>;
  /** W3-1: öffnet das Briefing eines empfohlenen Szenarios. */
  onOpenScenario?: (scenarioId: string) => void;
  /** Fokus-Retry: startet dasselbe Szenario mit diesem Fokus (W3-2: selbst geschrieben). */
  onRetry: (focusText: string) => void;
  retryBusy?: boolean;
  /** Gespeicherter Vorsatz (übernommen oder selbst formuliert); null = noch keiner. */
  initialCommitment?: string | null;
  /** N17 (11.10.2026): speichert den Vorsatz — erst mit dem Klick „Übernehmen“ oder „Vorsatz speichern“. */
  onCommit?: (text: string, source: 'model' | 'user') => void;
  /** Zurück zum Einstieg. */
  onNew: () => void;
}) {
  const { t } = useTranslation();
  const ts = t.simulation;
  const { feedback, debrief, delta, ratings, personaName, onCommit } = props;
  const turns = props.turns && props.turns.length ? props.turns : null;

  // Vorsatz als bewusster Klick (N17 / B8, Owner-GO 11.10.2026): Der Coach schlägt EINEN Schritt vor
  // (Micro-Transfer, bei Alt-Läufen der größte Hebel, an der Wortgrenze gekürzt). Erst „Übernehmen“
  // oder ein eigener Text macht daraus den Vorsatz — nichts wird mehr still gespeichert.
  const suggestion = feedback.microTransfer?.step?.trim() || truncateAtWord(feedback.nextStep, 280);
  const [saved, setSaved] = useState<string | null>(props.initialCommitment?.trim() || null);
  // Für „Nochmal üben — mit Fokus“: der gespeicherte Vorsatz, sonst der Vorschlag.
  const commitment = saved ?? suggestion;
  const saveCommitment = useCallback(
    (text: string, source: 'model' | 'user') => {
      setSaved(text);
      onCommit?.(text, source);
    },
    [onCommit]
  );

  // Reiter: der Name steht in der Adresse (teilbar, übersteht Neuladen), ohne neuen Eintrag im Verlauf des Browsers.
  const [tab, setTab] = useState<AuswertungReiter>(
    () => (typeof window === 'undefined' ? null : reiterAusHash(window.location.hash)) ?? 'ueberblick'
  );
  // U17: Zug, zu dem ein Klick auf ein Zitat rollt.
  const [sprung, setSprung] = useState<{ turn: number; n: number } | null>(null);
  // Rechenweg (N17 / C4): aufklappbar im Reiter „Fähigkeiten“, erreichbar auch von der Punktzahl im Überblick.
  const [calcOpen, setCalcOpen] = useState(false);
  const zeigeReiter = useCallback((next: AuswertungReiter, adresse = true) => {
    setTab(next);
    if (next !== 'gespraech') setSprung(null);
    if (!adresse) return;
    try {
      // null als Zustand: so übernimmt der App-Router die Adresse (basePath steckt schon in der aktuellen Adresse).
      window.history.replaceState(null, '', `#${next}`);
    } catch {
      /* ohne Adresse bleibt der Reiter im Zustand */
    }
  }, []);
  useEffect(() => {
    const liesAdresse = () => {
      const r = reiterAusHash(window.location.hash);
      if (r) zeigeReiter(r, false);
    };
    window.addEventListener('hashchange', liesAdresse);
    return () => window.removeEventListener('hashchange', liesAdresse);
  }, [zeigeReiter]);
  const zurStelle = useCallback(
    (turn: number) => {
      setSprung((s) => ({ turn, n: (s?.n ?? 0) + 1 }));
      zeigeReiter('gespraech');
    },
    [zeigeReiter]
  );
  // Die Reiterleiste klebt beim Rollen oben. Wechselt man dann den Reiter, beginnt der neue an seinem Anfang
  // (sonst stünde man mitten in einem anderen Inhalt). Der Sprung zu einem Zitat rollt selbst an seine Stelle.
  const wurzel = useRef<HTMLDivElement>(null);
  const leiste = useRef<HTMLDivElement>(null);
  const zumAnfang = useCallback(() => {
    requestAnimationFrame(() => {
      const w = wurzel.current;
      const l = leiste.current;
      if (w && l && l.getBoundingClientRect().top - w.getBoundingClientRect().top > 1) w.scrollIntoView({ block: 'start' });
    });
  }, []);
  const zeigeRechenweg = useCallback(() => {
    setCalcOpen(true);
    zeigeReiter('faehigkeiten');
    zumAnfang();
  }, [zeigeReiter, zumAnfang]);

  // Selbstbild: die Antworten des Check-ins, bei alten Läufen der Freitext.
  const selbstbild = useMemo(() => {
    const antworten = checkinAntworten(props.checkin);
    if (antworten.length) return antworten;
    const alt = props.selfAssessment?.trim();
    return alt ? [alt] : [];
  }, [props.checkin, props.selfAssessment]);
  // S13: ohne Feld (alte Läufe) oder mit leerer Liste steht nirgends etwas.
  const sachlich = useMemo(
    () =>
      (Array.isArray(feedback.sachlichNichtGedeckt) ? feedback.sachlichNichtGedeckt : []).filter(
        (s) => s && typeof s.zitat === 'string' && s.zitat.trim() && typeof s.warum === 'string'
      ),
    [feedback.sachlichNichtGedeckt]
  );
  // U17: Zitat → Zug im Gespräch (je Zitat einmal gesucht); null = kein Treffer, das Zitat bleibt ohne Sprung.
  const turnOf = useMemo(() => {
    const cache = new Map<string, number | null>();
    return (zitat: string): number | null => {
      if (!turns) return null;
      if (!cache.has(zitat)) {
        cache.set(zitat, findeZitatStelle(zitat, turns, { personaName, bevorzugt: 'user' })?.turn ?? null);
      }
      return cache.get(zitat) ?? null;
    };
  }, [turns, personaName]);
  const marken = useMemo(() => {
    if (!turns) return null;
    const zitate: ZitatEingabe[] = [
      ...feedback.rubric.flatMap((r) => (r.evidence ?? []).map((e) => ({ zitat: e, art: 'beleg' as const, hinweis: r.label }))),
      ...sachlich.map((s) => ({ zitat: s.zitat, art: 'sachlich' as const, hinweis: s.warum })),
    ];
    return markiereZuege(turns, zitate, personaName);
  }, [turns, feedback.rubric, sachlich, personaName]);

  const reiter: Array<{ id: AuswertungReiter; label: string }> = [
    { id: 'ueberblick', label: ts.evalTabOverview },
    { id: 'faehigkeiten', label: ts.evalTabSkills },
    { id: 'gespraech', label: ts.evalTabConversation },
    { id: 'weiter', label: ts.evalTabPractice },
  ];

    // mx-auto: die Auswertung klebte auf breiten Bildschirmen am linken Rand
    // (Test-Fund 11.08.) — Chat und Verlauf zentrieren bereits.
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Herkunfts-Pill (W1-8): woher diese Messung stammt */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
          <MessagesSquare className="h-3.5 w-3.5" />
          {t.evaluation.sourceSim}
          {props.personaName ? ` · ${props.personaName}` : ''}
        </span>
        {props.mode === 'check' && (
          <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-800 dark:text-amber-400">
            {ts.modeCheckBadge}
          </span>
        )}
        {props.hardness && props.hardness !== 'standard' && (
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
            {props.hardness === 'mild' ? ts.hardnessMild : ts.hardnessHart}
          </span>
        )}
      </div>
      {/* KI-Hinweis: einer bleibt (Paket 3). Er sagt beides: von einer KI erstellt (EU-KI-VO Art. 50), und sie kann
          sich irren (W1-13). Der zweite Hinweis mit dem Wortlaut der Transkript-Seite ist hier entfallen. */}
      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground" data-testid="ai-limit">
        <Sparkles className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        {t.aiWait.aiLimit}
      </p>

      <Tabs
        ref={wurzel}
        value={tab}
        onValueChange={(v) => {
          zeigeReiter(v as AuswertungReiter);
          zumAnfang();
        }}
      >
        {/* Am Handy passen die vier Namen in eine Zeile; längere Namen anderer Sprachen rollen waagerecht, nie abgeschnitten. */}
        <TabsList
          ref={leiste}
          aria-label={ts.feedbackTitle}
          className="sticky top-0 z-20 flex h-auto w-full justify-start overflow-x-auto rounded-none border-b border-border bg-background p-0 sm:gap-1"
        >
          {reiter.map((r) => (
            <TabsTrigger
              key={r.id}
              value={r.id}
              data-testid={`eval-tab-${r.id}`}
              className="shrink-0 rounded-none border-b-2 border-transparent px-2 py-2.5 text-sm font-semibold text-muted-foreground focus-visible:ring-inset focus-visible:ring-offset-0 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none sm:px-3"
            >
              {r.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="ueberblick" forceMount className={REITER_FLAECHE}>
          <EvalUeberblick
            feedback={feedback}
            debrief={debrief}
            delta={delta}
            attempt={props.attempt}
            focus={props.focus}
            history={props.history}
            selbstbild={selbstbild}
            selfReviewPending={props.selfReviewPending}
            sachlich={sachlich}
            turns={turns}
            personaName={personaName}
            turnOf={turnOf}
            onJump={zurStelle}
            onShowCalc={zeigeRechenweg}
            suggestion={suggestion}
            saved={saved}
            onSaveCommitment={saveCommitment}
          />
        </TabsContent>

        <TabsContent value="faehigkeiten" forceMount className={REITER_FLAECHE}>
          <EvalFaehigkeiten
            feedback={feedback}
            debrief={debrief}
            delta={delta}
            ratings={ratings}
            convoLocale={props.convoLocale ?? null}
            turnOf={turnOf}
            onJump={zurStelle}
            calcOpen={calcOpen}
            onToggleCalc={() => setCalcOpen((v) => !v)}
          />
        </TabsContent>

        <TabsContent value="gespraech" forceMount className={REITER_FLAECHE}>
          <EvalGespraech
            feedback={feedback}
            turns={turns}
            personaName={personaName}
            convoLocale={props.convoLocale ?? null}
            marken={marken}
            sprung={sprung}
            sichtbar={tab === 'gespraech'}
          />
        </TabsContent>

        <TabsContent value="weiter" forceMount className={REITER_FLAECHE}>
          <EvalWeiterUeben
            ratings={ratings}
            delta={delta}
            commitment={commitment}
            commitmentSaved={saved != null}
            currentScenarioId={props.currentScenarioId}
            scenarios={props.scenarios}
            onOpenScenario={props.onOpenScenario}
            onRetry={props.onRetry}
            retryBusy={props.retryBusy}
            onNew={props.onNew}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
