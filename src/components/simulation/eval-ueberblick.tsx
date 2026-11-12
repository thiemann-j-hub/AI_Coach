'use client';

/**
 * Paket 3, U14 und S10 (12.11.2026): Reiter „Überblick“ der Rollenspiel-Auswertung.
 * Anlass: eine lange Seite mit zwölf Abschnitten. Hier steht, was man zuerst wissen will: Punktzahl mit Urteil und
 * Ergebnis des Gesprächs, Gesamtbild, größter Hebel, Selbstbild und Auswertung, Vorsatz, Verlauf, Fokus-Rückblick.
 * Die Bausteine stammen aus simulation-evaluation.tsx (Stand vor Paket 3) und sind inhaltlich unverändert.
 */

import React, { useMemo, useState } from 'react';
import { ArrowRight, Check, CheckCircle2, ChevronRight, History, Loader2, Minus, Pencil, RotateCcw, Sparkles } from 'lucide-react';
import { ScoreRing } from '@/components/app/score-ring';
import { textMitSpruengen } from '@/lib/simulation/zitat-stelle';
import { useTranslation } from '@/i18n/useTranslation';
import {
  DeltaTag,
  Zitat,
  cx,
  type SimEvalDebrief,
  type SimEvalDelta,
  type SimEvalFeedback,
  type SimEvalHistoryPoint,
  type SimEvalTurn,
  type ZurStelle,
} from './eval-teile';

/**
 * A3: Verlaufskurve — Score über Versuche als schlichtes Inline-SVG (keine
 * neue Bibliothek). Bestehenslinie gestrichelt, bester Versuch markiert.
 */
function AttemptChart(props: {
  points: SimEvalHistoryPoint[];
  passMark: number;
  currentAttempt: number;
  bestLabel: string;
  /** Name der Grafik für Vorleseprogramme. */
  label: string;
}) {
  const pts = [...props.points]
    .filter((p) => p.overall != null)
    .sort((a, b) => a.attempt - b.attempt);
  if (pts.length < 2) return null;
  const W = 320;
  const H = 120;
  const PAD = { l: 30, r: 14, t: 14, b: 20 };
  const x = (i: number) =>
    PAD.l + (i * (W - PAD.l - PAD.r)) / Math.max(1, pts.length - 1);
  const y = (v: number) => PAD.t + ((100 - v) * (H - PAD.t - PAD.b)) / 100;
  const best = pts.reduce((m, p) => ((p.overall ?? 0) > (m.overall ?? 0) ? p : m), pts[0]);
  const line = pts.map((p, i) => `${x(i)},${y(p.overall as number)}`).join(' ');
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full max-w-md"
      role="img"
      aria-label={props.label}
    >
      {[0, 50, 100].map((v) => (
        <g key={v}>
          <text x={PAD.l - 6} y={y(v) + 3} textAnchor="end" className="fill-current opacity-50" fontSize="8">
            {v}
          </text>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="stroke-current opacity-10" strokeWidth="1" />
        </g>
      ))}
      {/* Bestehenslinie */}
      <line
        x1={PAD.l}
        x2={W - PAD.r}
        y1={y(props.passMark)}
        y2={y(props.passMark)}
        className="stroke-amber-400/70"
        strokeWidth="1"
        strokeDasharray="4 3"
      />
      <polyline points={line} fill="none" className="stroke-current text-primary" strokeWidth="2" />
      {pts.map((p, i) => (
        <g key={p.id}>
          <circle
            cx={x(i)}
            cy={y(p.overall as number)}
            r={p.attempt === props.currentAttempt ? 4.5 : 3}
            className={cx(
              'fill-current',
              p.attempt === props.currentAttempt ? 'text-accent' : 'text-primary'
            )}
          />
          <text x={x(i)} y={H - 6} textAnchor="middle" className="fill-current opacity-60" fontSize="8">
            {p.attempt}
          </text>
          {p.id === best.id && (
            <text
              x={x(i)}
              y={y(p.overall as number) - 8}
              textAnchor="middle"
              className="fill-current text-emerald-800 dark:text-emerald-400 font-semibold"
              fontSize="8"
            >
              {props.bestLabel}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

/** Vorsatz als bewusster Klick (N17 / B8, 11.10.2026): Vorschlag → „Übernehmen“ oder „Selbst formulieren“. */
function VorsatzKarte(props: {
  suggestion: string;
  /** Zeitangabe zum Vorschlag („morgen“, „im nächsten 1:1“). */
  when: string | null;
  saved: string | null;
  onSave: (text: string, source: 'model' | 'user') => void;
}) {
  const { t } = useTranslation();
  const { suggestion, saved } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  function adoptSuggestion() {
    setEditing(false);
    props.onSave(suggestion.slice(0, 300), 'model');
  }
  function startOwn(prefill: string) {
    setDraft(prefill);
    setEditing(true);
  }
  function saveOwn() {
    const text = draft.trim().slice(0, 300);
    if (!text) return;
    setEditing(false);
    props.onSave(text, 'user');
  }
  return (
    <section className="pn-surface glass-panel rounded-2xl p-5 border border-border space-y-3" data-testid="commitment-section" data-state={saved ? 'saved' : 'open'}>
      <p className="text-sm font-semibold flex items-center gap-1.5">
        <Sparkles className="h-4 w-4 text-primary" /> {t.evaluation.commitmentQuestion}
      </p>
      {saved && !editing ? (
        <div className="pn-none rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5" data-testid="commitment-saved">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-400 flex items-center gap-1">
            <Check className="h-3 w-3" aria-hidden /> {t.evaluation.commitSavedTitle} · {t.evaluation.commitSaved}
          </div>
          <p className="text-sm font-medium leading-snug">{saved}</p>
          <button
            type="button"
            onClick={() => startOwn(saved)}
            className="pn-none mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            data-testid="commitment-edit"
          >
            <Pencil className="h-3 w-3" /> {t.evaluation.commitEdit}
          </button>
        </div>
      ) : editing ? (
        <div className="space-y-2" data-testid="commitment-editor">
          <textarea
            id="commitment"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t.evaluation.commitPlaceholder}
            rows={3}
            maxLength={300}
            autoFocus
            className="pn-field w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={saveOwn}
              disabled={draft.trim().length === 0}
              className="pn-none inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
              data-testid="commitment-save"
            >
              <Check className="h-4 w-4" /> {t.evaluation.commitSave}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="pn-none rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
            >
              {t.common.cancel}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2" data-testid="commitment-suggestion">
          <div className="pn-none rounded-xl border border-primary/40 bg-background/70 px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-primary flex items-center gap-1">
              <ArrowRight className="h-3 w-3" aria-hidden /> {t.evaluation.commitSuggestionTitle}
              {props.when && (
                <span className="normal-case tracking-normal text-muted-foreground">· {props.when}</span>
              )}
            </div>
            <p className="text-sm font-medium leading-snug">{suggestion}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={adoptSuggestion}
              className="pn-none inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
              data-testid="commitment-adopt"
            >
              <Check className="h-4 w-4" /> {t.evaluation.commitAdopt}
            </button>
            <button
              type="button"
              onClick={() => startOwn('')}
              className="pn-none inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
              data-testid="commitment-own"
            >
              <Pencil className="h-4 w-4" /> {t.evaluation.commitOwn}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">{t.evaluation.commitHint}</p>
        </div>
      )}
    </section>
  );
}

export function EvalUeberblick(props: {
  feedback: SimEvalFeedback;
  debrief: SimEvalDebrief | null;
  delta: SimEvalDelta | null;
  attempt: number;
  focus: string | null;
  /** A3: alle Versuche dieses Szenarios für die Verlaufskurve (inkl. aktuellem). */
  history?: SimEvalHistoryPoint[] | null;
  /** Die Antworten des Check-ins (seit Paket 3) oder der Freitext alter Läufe; leer = übersprungen. */
  selbstbild: string[];
  /** Der Check-in ist da, der Abgleich wird noch nachgeladen. */
  selfReviewPending?: boolean;
  /** S13: Aussagen, die den Fakten des Szenarios widersprechen. */
  sachlich: Array<{ zitat: string; warum: string }>;
  turns: SimEvalTurn[] | null;
  personaName: string | null;
  /** Zug, in dem ein Zitat steht (null = kein Treffer, kein Sprung). */
  turnOf: (zitat: string) => number | null;
  onJump: ZurStelle;
  /** Öffnet den Rechenweg im Reiter „Fähigkeiten“. */
  onShowCalc: () => void;
  suggestion: string;
  saved: string | null;
  onSaveCommitment: (text: string, source: 'model' | 'user') => void;
}) {
  const { t } = useTranslation();
  const ts = t.simulation;
  const { feedback, debrief, delta, attempt, focus, selbstbild } = props;
  const verdict = debrief?.verdict ?? 'unrated';
  const observedCount = debrief?.anchors.filter((a) => a.pct != null).length ?? 0;
  const review = feedback.selfReview ?? null;
  // U17: Das wörtliche Zitat im „Größten Hebel“ führt zur Stelle im Gespräch.
  const hebel = useMemo(
    () => textMitSpruengen(feedback.nextStep, props.turns, props.personaName),
    [feedback.nextStep, props.turns, props.personaName]
  );

  return (
    <>
      {/* Punktzahl mit Urteil und Ergebnis des Gesprächs, darunter das Gesamtbild. */}
      <section className="pn-tile glass-panel rounded-2xl p-5 sm:p-6 border border-border space-y-4">
        {debrief && (
          <div className="flex flex-col sm:flex-row items-center gap-5">
            <ScoreRing
              value={debrief.overall}
              verdict={verdict}
              passMark={debrief.passMarkPct}
              unratedLabel={ts.unrated}
            />
            <div className="flex-1 min-w-0 text-center sm:text-left space-y-2">
              <div className="flex items-center justify-center sm:justify-start gap-2 flex-wrap">
                <span
                  className={cx(
                    'text-sm font-bold px-3 py-1 rounded-full border',
                    verdict === 'passed'
                      ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-400 border-emerald-500/30'
                      : verdict === 'failed'
                        ? 'bg-rose-500/15 text-rose-800 dark:text-rose-400 border-rose-500/30'
                        : 'bg-muted text-muted-foreground border-border'
                  )}
                >
                  {verdict === 'passed'
                    ? debrief.verdictGrund === 'ziel'
                      ? ts.passedByGoal
                      : ts.passed
                    : verdict === 'failed'
                      ? debrief.verdictGrund === 'abbruch'
                        ? ts.failedByAbort
                        : ts.failed
                      : ts.unrated}
                </span>
                {/* Bewertung 2.0: das Ergebnis des Gesprächs als eigene Dimension neben der Punktzahl. */}
                {debrief.ergebnis && debrief.verdictGrund === 'punkte' && (
                  <span
                    className={cx(
                      'text-xs font-semibold px-2 py-0.5 rounded-full border',
                      debrief.ergebnis === 'ziel'
                        ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-400 border-emerald-500/30'
                        : debrief.ergebnis === 'abbruch'
                          ? 'bg-rose-500/10 text-rose-800 dark:text-rose-400 border-rose-500/30'
                          : 'bg-muted text-muted-foreground border-border'
                    )}
                    data-testid="ergebnis-badge"
                  >
                    {debrief.ergebnis === 'ziel' ? ts.ergebnisZiel : debrief.ergebnis === 'abbruch' ? ts.ergebnisAbbruch : ts.ergebnisOffen}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {ts.passMark}: {debrief.passMarkPct} %
                </span>
                <span className="text-xs text-muted-foreground">
                  · {ts.attemptLabel} {attempt}
                </span>
                {delta?.overall != null && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    · <DeltaTag delta={delta.overall} /> {ts.deltaVsPrev} {delta.prevAttempt}
                  </span>
                )}
              </div>
              {/* Prüfungsmodus (Owner-Entscheid 12.11.2026): Ziel erreicht, aber die Mindestpunktzahl fehlt. */}
              {debrief.ergebnis === 'ziel' && debrief.verdict === 'failed' && debrief.verdictGrund === 'punkte' && (
                <p className="text-sm leading-relaxed" data-testid="ziel-ohne-mindestpunkte">
                  {ts.zielOhneMindestpunkte.replace('{passMark}', String(debrief.passMarkPct))}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {observedCount}/{debrief.anchors.length} {ts.coverageNote} · {debrief.checkpointsHit}/{debrief.checkpointsTotal} {ts.checkpointsTitle}
              </p>
              {/* Rechenweg (N17 / C4): jede Zahl sagt, was sie zählt. Er steht bei den Fähigkeiten. */}
              <button
                type="button"
                onClick={props.onShowCalc}
                className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
                data-testid="calc-link"
              >
                {t.evaluation.calcToggle} <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>
        )}
        <div className={cx('space-y-2', debrief && 'border-t border-border/60 pt-4')}>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{ts.summaryTitle}</h2>
          <p className="text-sm leading-relaxed">{feedback.summary}</p>
        </div>
      </section>

      {/* Größter Hebel: der eine Moment mit Wirkung und wirksamerem Weg. */}
      <section className="pn-none glass-panel rounded-2xl border border-primary/30 bg-primary/5 p-4" data-testid="groesster-hebel">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-primary mb-1 flex items-center gap-1">
          <Sparkles className="h-3.5 w-3.5" /> {ts.biggestLever}
        </div>
        <p className="text-sm leading-relaxed">
          {hebel.map((s, i) =>
            s.turn == null ? (
              <React.Fragment key={i}>{s.text}</React.Fragment>
            ) : (
              <a
                key={i}
                href="#gespraech"
                title={ts.quoteJump}
                onClick={(e) => {
                  e.preventDefault();
                  props.onJump(s.turn as number);
                }}
                className="underline decoration-primary/60 decoration-dotted underline-offset-2 hover:text-primary"
              >
                {s.text}
              </a>
            )
          )}
        </p>
        {/* V3 (Owner-GO 25.09.): Merkkarten aus der Coaching-Bibliothek zum nächsten Schritt. */}
        {feedback.cards && feedback.cards.length > 0 && (
          <div className="mt-3 space-y-1.5" data-testid="debrief-cards">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {ts.coachCardsTitle}
            </div>
            {feedback.cards.map((c) => (
              <div key={c.id} className="pn-none rounded-lg border border-border bg-background/70 px-3 py-2">
                <div className="text-sm font-medium">{c.title}</div>
                {c.hint && <div className="text-xs text-muted-foreground leading-snug">{c.hint}</div>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* S13: Aussagen, die den Fakten des Szenarios widersprechen. Ohne Einträge steht hier nichts. */}
      {props.sachlich.length > 0 && (
        <section className="pn-none glass-panel rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4 space-y-2" data-testid="sachlich-liste">
          <div className="text-xs font-semibold uppercase tracking-wide text-rose-800 dark:text-rose-400">{ts.factCheckTitle}</div>
          <ul className="space-y-3">
            {props.sachlich.map((s, i) => (
              <li key={i} className="space-y-1">
                <Zitat text={s.zitat} turn={props.turnOf(s.zitat)} onJump={props.onJump} jumpLabel={ts.quoteJump} />
                <p className="text-sm leading-relaxed">{s.warum}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* A1: Selbstbild und Auswertung. Seit Paket 3 ein eigener Schritt nach dem Check-in: solange er
          aussteht, steht die Karte schon mit den eigenen Antworten da (kein Sprung im Seitenaufbau). */}
      {(review || (props.selfReviewPending && selbstbild.length > 0)) && (
        <section
          className={cx(
            'pn-none glass-panel rounded-2xl p-4 border flex items-start gap-3',
            !review
              ? 'border-border'
              : review.agreement === 'confirms'
                ? 'border-emerald-500/30 bg-emerald-500/5'
                : review.agreement === 'partly'
                  ? 'border-sky-500/30 bg-sky-500/5'
                  : 'border-amber-500/30 bg-amber-500/5'
          )}
          data-testid="self-review"
        >
          {!review ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground shrink-0 mt-0.5" aria-hidden />
          ) : review.agreement === 'confirms' ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-800 dark:text-emerald-400 shrink-0 mt-0.5" />
          ) : review.agreement === 'partly' ? (
            <Minus className="h-5 w-5 text-sky-800 dark:text-sky-400 shrink-0 mt-0.5" />
          ) : (
            <RotateCcw className="h-5 w-5 text-amber-800 dark:text-amber-400 shrink-0 mt-0.5" />
          )}
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {ts.selfReviewTitle}
              {review && (
                <>
                  {' '}
                  — {review.agreement === 'confirms' ? ts.selfConfirms : review.agreement === 'partly' ? ts.selfPartly : ts.selfDiffers}
                </>
              )}
            </div>
            {selbstbild.map((s, i) => (
              <p key={i} className="text-xs text-muted-foreground mt-0.5 italic">
                »{s}«
              </p>
            ))}
            {review ? (
              <p className="text-sm leading-relaxed mt-1">{review.comment}</p>
            ) : (
              <p className="text-xs text-muted-foreground mt-1" aria-live="polite">
                {t.common.loading}
              </p>
            )}
          </div>
        </section>
      )}

      <VorsatzKarte
        suggestion={props.suggestion}
        when={feedback.microTransfer?.when || null}
        saved={props.saved}
        onSave={props.onSaveCommitment}
      />

      {/* A3: Verlaufskurve — erst ab dem zweiten bewerteten Versuch. */}
      {debrief && (props.history?.filter((p) => p.overall != null).length ?? 0) >= 2 && (
        <section className="pn-tile glass-panel rounded-2xl p-5 border border-border space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <History className="h-4 w-4" /> {ts.historyTitle}
          </h2>
          <AttemptChart
            points={props.history!}
            passMark={debrief.passMarkPct}
            currentAttempt={attempt}
            bestLabel={ts.historyBest}
            label={ts.historyTitle}
          />
          <p className="text-xs text-muted-foreground">{ts.historyHint}</p>
        </section>
      )}

      {/* Fokus-Review (D2) */}
      {feedback.focusReview && focus && (
        <section
          className={cx(
            'pn-none glass-panel rounded-2xl p-4 border flex items-start gap-3',
            feedback.focusReview.addressed
              ? 'border-emerald-500/30 bg-emerald-500/5'
              : 'border-amber-500/30 bg-amber-500/5'
          )}
        >
          {feedback.focusReview.addressed ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-800 dark:text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <RotateCcw className="h-5 w-5 text-amber-800 dark:text-amber-400 shrink-0 mt-0.5" />
          )}
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {ts.focusReviewTitle} — {feedback.focusReview.addressed ? ts.focusYes : ts.focusNo}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 italic">»{focus}«</p>
            <p className="text-sm leading-relaxed mt-1">{feedback.focusReview.comment}</p>
          </div>
        </section>
      )}
    </>
  );
}
