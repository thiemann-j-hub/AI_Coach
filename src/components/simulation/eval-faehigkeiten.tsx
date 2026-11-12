'use client';

/**
 * Paket 3, U14, S10 und S11 (12.11.2026): Reiter „Fähigkeiten“ der Rollenspiel-Auswertung.
 * Je Fähigkeit eine Karte mit Stufe, Messlatte („Deine Stufe“ und „So sieht die nächste aus“), „Das gelang“ und
 * „Nächstes Mal“ und den Belegen; ein Klick auf einen Beleg springt zur Stelle im Gespräch (U17). Oben der Rechenweg.
 * Ganz unten eingeklappt das Kompetenzmodell C1 bis C10 (Owner-Entscheid 12.11.2026): vorn stehen nur noch Prozent
 * und die Stufenworte der Fähigkeiten, x/4 nur noch dort.
 */

import React, { useState } from 'react';
import { ArrowRight, Check, ChevronDown } from 'lucide-react';
import { messlatte } from '@/lib/simulation/messlatte';
import { rechenweg } from '@/lib/simulation/rechenweg';
import { useTranslation } from '@/i18n/useTranslation';
import {
  DeltaTag,
  Zitat,
  cx,
  type SimEvalDebrief,
  type SimEvalDebriefAnchor,
  type SimEvalDelta,
  type SimEvalFeedback,
  type SimEvalRating,
  type ZurStelle,
} from './eval-teile';

const EXPECTATION_STYLES: Record<SimEvalDebriefAnchor['expectation'], string> = {
  exceeds: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-400 border-emerald-500/30',
  meets: 'bg-sky-500/15 text-sky-800 dark:text-sky-400 border-sky-500/30',
  approaching: 'bg-amber-500/15 text-amber-800 dark:text-amber-400 border-amber-500/30',
  below: 'bg-rose-500/15 text-rose-800 dark:text-rose-400 border-rose-500/30',
  'not-observable': 'bg-muted text-muted-foreground border-border',
};

export function EvalFaehigkeiten(props: {
  feedback: SimEvalFeedback;
  debrief: SimEvalDebrief | null;
  delta: SimEvalDelta | null;
  ratings: SimEvalRating[] | null;
  /** Sprache des Gesprächs: in ihr stehen Auswertung und Stufentexte. */
  convoLocale: string | null;
  /** Zug, in dem ein Zitat steht (null = kein Treffer, kein Sprung). */
  turnOf: (zitat: string) => number | null;
  onJump: ZurStelle;
  calcOpen: boolean;
  onToggleCalc: () => void;
}) {
  const { t } = useTranslation();
  const ts = t.simulation;
  const { feedback, debrief, delta, ratings, calcOpen } = props;
  const [c10Open, setC10Open] = useState(false);
  const deltaByKey = new Map((delta?.anchors ?? []).map((a) => [a.key, a.delta]));

  const expectationLabel = (e: SimEvalDebriefAnchor['expectation']) =>
    e === 'exceeds'
      ? ts.expExceeds
      : e === 'meets'
        ? ts.expMeets
        : e === 'approaching'
          ? ts.expApproaching
          : e === 'below'
            ? ts.expBelow
            : ts.notObservable;

  return (
    <>
      {/* Rechenweg (N17 / C4, 11.10.2026): jede Zahl sagt, was sie zählt. */}
      {debrief && (
        <div data-testid="rechenweg">
          <button
            type="button"
            onClick={props.onToggleCalc}
            aria-expanded={calcOpen}
            className="pn-none inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            data-testid="calc-toggle"
          >
            <ChevronDown className={cx('h-3.5 w-3.5 transition-transform', calcOpen && 'rotate-180')} /> {t.evaluation.calcToggle}
          </button>
          {calcOpen && (
            <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground" data-testid="calc-lines">
              {rechenweg(debrief, {
                scale: t.evaluation.calcScale,
                anchors: t.evaluation.calcAnchors,
                checkpoints: t.evaluation.calcCheckpoints,
                sum: t.evaluation.calcSum,
                onlyAnchors: t.evaluation.calcOnlyAnchors,
                onlyCheckpoints: t.evaluation.calcOnlyCheckpoints,
                pass: t.evaluation.calcPass,
                unrated: t.evaluation.calcUnrated,
                goal: t.evaluation.calcGoal,
                abort: t.evaluation.calcAbort,
              }).map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Fähigkeiten mit Stufe, Messlatte, Balken, Vergleich zum Vorversuch und Belegen */}
      <div className="space-y-3">
        {feedback.rubric.map((r) => {
          const anchor = debrief?.anchors.find((a) => a.key === r.key);
          const pct = anchor?.pct ?? null;
          const exp = anchor?.expectation ?? (r.score == null ? 'not-observable' : 'meets');
          const anchorDelta = deltaByKey.get(r.key) ?? null;
          // S11: die Messlatte aus der Fähigkeiten-Bibliothek; fehlt ein Stufentext, entfällt sie still.
          const latte = messlatte(r.key, r.score, props.convoLocale);
          return (
            <div key={r.key} className="pn-tile glass-panel rounded-xl border border-border p-4 space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="text-sm font-semibold">{r.label}</h3>
                <div className="flex items-center gap-2">
                  <DeltaTag delta={anchorDelta} />
                  <span
                    className={cx(
                      'text-xs font-semibold px-2 py-0.5 rounded-full border',
                      EXPECTATION_STYLES[exp]
                    )}
                  >
                    {expectationLabel(exp)}
                  </span>
                </div>
              </div>
              {pct != null && (
                <div className="h-1.5 rounded-full bg-border overflow-hidden">
                  <div
                    className={cx(
                      'h-full rounded-full transition-all duration-700',
                      exp === 'exceeds' || exp === 'meets'
                        ? 'bg-gradient-to-r from-primary to-accent'
                        : exp === 'approaching'
                          ? 'bg-amber-400'
                          : 'bg-rose-400'
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
              {latte && (
                <dl className="grid gap-x-3 gap-y-1 text-sm leading-relaxed sm:grid-cols-[auto_1fr]" data-testid="messlatte">
                  <dt className="text-[11px] font-bold uppercase tracking-wide text-primary sm:pt-0.5">{ts.levelYours}</dt>
                  <dd>{latte.deine}</dd>
                  {latte.naechste && (
                    <>
                      <dt className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground sm:pt-0.5">{ts.levelNext}</dt>
                      <dd className="text-muted-foreground">{latte.naechste}</dd>
                    </>
                  )}
                </dl>
              )}
              {/* Welle 1 (3.3): zwei kurze Listen statt eines Absatzes; Alt-Läufe zeigen weiter die Begründung. */}
              {(r.wentWell?.length || r.tryNext?.length) ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {r.wentWell && r.wentWell.length > 0 && (
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400 mb-1">{ts.anchorWentWell}</div>
                      <ul className="space-y-1">
                        {r.wentWell.map((x, i) => (
                          <li key={i} className="text-sm leading-relaxed flex gap-2"><Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" /><span>{x}</span></li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {r.tryNext && r.tryNext.length > 0 && (
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wide text-primary mb-1">{ts.anchorTryNext}</div>
                      <ul className="space-y-1">
                        {r.tryNext.map((x, i) => (
                          <li key={i} className="text-sm leading-relaxed flex gap-2"><ArrowRight className="h-4 w-4 text-primary shrink-0 mt-0.5" /><span>{x}</span></li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground leading-relaxed">{r.why}</p>
              )}
              {anchor?.weightPct != null && anchor.contribution != null && (
                <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 pt-2 border-t border-dashed border-border">
                  <span>{ts.anchorWeight.replace('{pct}', String(anchor.weightPct))}</span>
                  <span>{ts.anchorContribution.replace('{points}', String(anchor.contribution))}</span>
                </div>
              )}
              {r.evidence.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{ts.evidenceLabel}</div>
                  {r.evidence.map((e, idx) => (
                    <Zitat key={idx} text={e} turn={props.turnOf(e)} onJump={props.onJump} jumpLabel={ts.quoteJump} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* C1 bis C10: eingeklappt (Owner-Entscheid 12.11.2026). Die Brücke zum Radar bleibt erreichbar. */}
      {ratings && ratings.length > 0 && (
        <section className="space-y-2">
          <button
            type="button"
            onClick={() => setC10Open((v) => !v)}
            aria-expanded={c10Open}
            className="inline-flex items-center gap-1 text-left text-sm font-semibold text-muted-foreground hover:text-foreground"
            data-testid="c10-toggle"
          >
            <ChevronDown className={cx('h-4 w-4 shrink-0 transition-transform', c10Open && 'rotate-180')} aria-hidden /> {ts.c10Title}
          </button>
          {c10Open && (
            <div className="pn-tile glass-panel rounded-xl border border-border p-4 space-y-2">
              <p className="text-xs text-muted-foreground">{ts.c10Hint}</p>
              {ratings.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 py-1 border-b border-border/50 last:border-0"
                >
                  <span className="text-sm">
                    <span className="font-mono text-xs text-muted-foreground mr-2">{r.id}</span>
                    {r.name}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {r.score == null ? ts.notObservable : `${r.score} / 4`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
