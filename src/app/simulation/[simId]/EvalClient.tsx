'use client';

/**
 * Auswertungs-Seite eines Rollenspiels (COACH-UX-BLUEPRINT §3/W1-7):
 * lädt /api/simulation/get und rendert die gemeinsame SimulationEvaluation.
 * Aktive (unfertige) Simulationen leiten zum Einstieg weiter — dort läuft
 * der Chat; diese Route ist ausschließlich das ERGEBNIS.
 */

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle, Loader2 } from 'lucide-react';
import AppShell from '@/components/app/app-shell';
import { authFetch } from '@/lib/api-client';
import { useTranslation } from '@/i18n/useTranslation';
import {
  SimulationEvaluation,
  splitTitle,
  type SimEvalDebrief,
  type SimEvalDelta,
  type SimEvalFeedback,
  type SimEvalRating,
} from '@/components/simulation/simulation-evaluation';

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
}

export default function EvalClient() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams<{ simId: string }>();
  const simId = typeof params?.simId === 'string' ? params.simId : '';

  const [state, setState] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading');
  const [sim, setSim] = useState<LoadedSim | null>(null);
  // W3-1: Katalog-Projektion für den Delta-CTA (best effort — ohne Katalog
  // erscheint der Satz ohne Szenario-Button).
  const [scenarios, setScenarios] = useState<
    Array<{ id: string; title: string; competencyFocus?: string[] }>
  >([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch('/api/simulation/scenarios');
        const json = await res.json().catch(() => null);
        if (!cancelled && res.ok && json?.ok && Array.isArray(json.scenarios)) {
          setScenarios(
            json.scenarios.map((s: { id: string; title: string; competencyFocus?: string[] }) => ({
              id: s.id,
              title: s.title,
              competencyFocus: s.competencyFocus,
            }))
          );
        }
      } catch {
        /* CTA degradiert ohne Katalog */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!simId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`/api/simulation/get?simId=${encodeURIComponent(simId)}`);
        if (res.status === 404 || res.status === 400) {
          if (!cancelled) setState('notfound');
          return;
        }
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error('load');
        const s = json.simulation;
        if (s.status !== 'finished' || !s.feedback) {
          // Noch aktiv → der Chat lebt am Einstieg; Wiederaufnahme dort.
          router.replace('/');
          return;
        }
        if (!cancelled) {
          setSim({
            scenarioId: s.scenarioId,
            scenarioTitle: json.scenario?.title ?? null,
            personaName: json.scenario?.persona?.name ?? null,
            feedback: s.feedback,
            debrief: s.debrief ?? null,
            delta: s.delta ?? null,
            attempt: s.attempt ?? 1,
            focus: s.focus ?? null,
            ratings: s.competencyRatings ?? null,
          });
          setState('ready');
        }
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [simId, router]);

  const ts = t.simulation;
  const subtitle = sim?.scenarioTitle ? splitTitle(sim.scenarioTitle).heroTitle : undefined;

  if (state === 'loading') {
    return (
      <AppShell title={ts.feedbackTitle}>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t.common.loading}
        </div>
      </AppShell>
    );
  }

  if (state !== 'ready' || !sim) {
    return (
      <AppShell title={ts.feedbackTitle}>
        <div className="glass-panel max-w-xl rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-rose-400 mt-0.5 shrink-0" />
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
    <AppShell title={ts.feedbackTitle} subtitle={subtitle}>
      <SimulationEvaluation
        personaName={sim.personaName}
        feedback={sim.feedback}
        debrief={sim.debrief}
        delta={sim.delta}
        attempt={sim.attempt}
        focus={sim.focus}
        ratings={sim.ratings}
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
        onNew={() => router.push('/')}
      />
    </AppShell>
  );
}
