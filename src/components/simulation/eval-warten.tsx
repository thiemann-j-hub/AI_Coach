'use client';

/**
 * Paket 3, U12 und S7 (12.11.2026): Warten auf die Auswertung, und der Fehlschlag.
 * Anlass: Rund eine Minute Warten in einem kleinen Dialog, ohne Fortschritt. Jetzt rechnet der Auftrag schon
 * während des Check-ins; die Seite zeigt ehrlich, wie lange es meist noch dauert (Start und übliche Dauer kommen
 * vom Server), und darunter das eigene Gespräch. Scheitert die Auswertung, steht hier ein klarer Satz mit dem Weg
 * zurück (erneut auswerten oder ins Gespräch).
 */

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react';
import { wartestand } from '@/lib/simulation/auswertung-ablauf';
import { useTranslation } from '@/i18n/useTranslation';
import { GespraechVerlauf } from './gespraech-verlauf';
import { Kicker, cx, type SimEvalTurn } from './eval-teile';

export function EvalWarten(props: {
  /** Start der Rechnung und übliche Dauer aus `GET /api/simulation/status`; null bis zur ersten Antwort. */
  startedAt: string | null;
  typicalMs: number | null;
  /** Uhr des Servers minus Uhr des Geräts (aus der Kopfzeile `Date`). */
  offsetMs: number;
  turns: SimEvalTurn[];
  personaName: string | null;
}) {
  const { t } = useTranslation();
  const ts = t.simulation;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const stand = wartestand({ startedAt: props.startedAt, typicalMs: props.typicalMs, now: now + props.offsetMs });
  const pct = stand ? Math.round(stand.anteil * 100) : null;

  return (
    <div className="max-w-3xl mx-auto space-y-6" data-testid="eval-warten">
      <section className="pn-tile glass-panel rounded-2xl border border-border p-5 space-y-3">
        <Kicker>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {ts.evalWaitTitle}
        </Kicker>
        <div
          role="progressbar"
          aria-label={ts.evalWaitTitle}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct ?? undefined}
          className="h-2.5 overflow-hidden rounded-full bg-border"
        >
          <div
            className={cx(
              'h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear',
              // Ohne Zahl (erste Antwort steht aus) oder länger als üblich: der Balken zeigt nur, dass es läuft.
              (!stand || stand.restSekunden == null) && 'animate-pulse'
            )}
            style={{ width: `${pct ?? 33}%` }}
          />
        </div>
        <p className="min-h-5 text-sm text-muted-foreground" aria-live="polite">
          {stand ? (stand.restSekunden != null ? ts.evalWaitRest.replace('{n}', String(stand.restSekunden)) : ts.evalWaitSoon) : ''}
        </p>
      </section>
      {props.turns.length > 0 && (
        <section className="space-y-3">
          <Kicker>{ts.evalTranscriptTitle}</Kicker>
          <GespraechVerlauf turns={props.turns} personaName={props.personaName} />
        </section>
      )}
    </div>
  );
}

export function EvalFehlschlag(props: {
  /** Fehlerart und Fehler-Nummer des letzten Versuchs, wenn bekannt. */
  detail: string | null;
  /** Meldung, wenn der neue Versuch nicht starten konnte (z. B. kein Guthaben). */
  error: string | null;
  topUpUrl: string | null;
  busy: boolean;
  onRetry: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const ts = t.simulation;
  return (
    <div className="max-w-xl mx-auto" data-testid="eval-fehlschlag">
      <section className="pn-none glass-panel rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-800 dark:text-amber-400 mt-0.5" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium leading-relaxed">{ts.evalFailedBody}</p>
            {props.detail && <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{props.detail}</p>}
          </div>
        </div>
        {props.error && (
          <p className="text-sm text-rose-800 dark:text-rose-400" role="alert">
            {props.error}
            {props.topUpUrl && (
              <a href={props.topUpUrl} className="ml-2 underline text-primary" target="_blank" rel="noreferrer">
                {ts.topUp}
              </a>
            )}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <button
            type="button"
            onClick={props.onRetry}
            disabled={props.busy}
            className="btn-gradient text-white font-semibold rounded-xl px-5 py-2.5 text-sm flex items-center gap-2 shadow-neon disabled:opacity-60"
            data-testid="eval-retry"
          >
            {props.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            {ts.evalRetryCta}
          </button>
          <button type="button" onClick={props.onBack} className="text-sm font-medium text-primary hover:underline">
            {ts.evalBackToChat}
          </button>
        </div>
      </section>
    </div>
  );
}
