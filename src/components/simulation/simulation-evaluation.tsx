'use client';

/**
 * Gemeinsame Rollenspiel-Auswertung (COACH-UX-BLUEPRINT §3/W1-7+W1-8):
 * aus SimulationClient extrahiert, damit die Auswertung eine EIGENE Route
 * (/simulation/[simId]) bekommt — verlinkbar, bookmarkbar, Reload-fest.
 * W1-8: einheitlicher ScoreRing, Herkunfts-Pill, C1–C10-Block offen.
 */

import React, { useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  Loader2,
  MessagesSquare,
  RotateCcw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { ScoreRing } from '@/components/app/score-ring';
import { useTranslation } from '@/i18n/useTranslation';

/* ── Typen (Vertrag der /api/simulation/get- bzw. finish-Antwort) ── */

export interface SimEvalFeedback {
  summary: string;
  rubric: { key: string; label: string; evidence: string[]; why: string; score: number | null }[];
  checkpoints: { id: string; hit: boolean; comment: string }[];
  nextStep: string;
  focusReview?: { addressed: boolean; comment: string } | null;
}

export interface SimEvalDebriefAnchor {
  key: string;
  label: string;
  score: number | null;
  pct: number | null;
  expectation: 'not-observable' | 'below' | 'approaching' | 'meets' | 'exceeds';
}

export interface SimEvalDebrief {
  overall: number | null;
  verdict: 'passed' | 'failed' | 'unrated';
  passMarkPct: number;
  coverage: number;
  anchors: SimEvalDebriefAnchor[];
  checkpointsHit: number;
  checkpointsTotal: number;
}

export interface SimEvalDelta {
  overall: number | null;
  anchors: Array<{ key: string; delta: number | null }>;
  prevOverall: number | null;
  prevAttempt: number;
}

export interface SimEvalRating {
  id: string;
  name: string;
  score: number | null;
  why: string;
  evidence: string[];
}

/** »Motto — Gesprächstyp mit Name« (geteilt mit SimulationClient). */
export function splitTitle(title: string): { motto: string; heroTitle: string } {
  const idx = title.indexOf('—');
  if (idx < 0) return { motto: title, heroTitle: title };
  return { motto: title.slice(0, idx).trim(), heroTitle: title.slice(idx + 1).trim() };
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function DeltaTag({ delta }: { delta: number | null }) {
  if (delta == null || delta === 0) return null;
  const up = delta > 0;
  return (
    <span
      className={cx(
        'inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full',
        up ? 'text-emerald-400 bg-emerald-500/10' : 'text-rose-400 bg-rose-500/10'
      )}
    >
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? '+' : ''}
      {delta}
    </span>
  );
}

const EXPECTATION_STYLES: Record<SimEvalDebriefAnchor['expectation'], string> = {
  exceeds: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  meets: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  approaching: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  below: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  'not-observable': 'bg-muted text-muted-foreground border-border',
};

export function SimulationEvaluation(props: {
  personaName: string | null;
  feedback: SimEvalFeedback;
  debrief: SimEvalDebrief | null;
  delta: SimEvalDelta | null;
  attempt: number;
  focus: string | null;
  ratings: SimEvalRating[] | null;
  /** Fokus-Retry: startet dasselbe Szenario mit diesem Fokus. */
  onRetry: (focusText: string) => void;
  retryBusy?: boolean;
  /** Zurück zum Einstieg. */
  onNew: () => void;
}) {
  const { t } = useTranslation();
  const ts = t.simulation;
  const { feedback, debrief, delta, attempt, focus, ratings } = props;

  const [openEvidence, setOpenEvidence] = useState<Record<string, boolean>>({});

  const deltaByKey = new Map((delta?.anchors ?? []).map((a) => [a.key, a.delta]));
  const verdict = debrief?.verdict ?? 'unrated';
  const observedCount = debrief?.anchors.filter((a) => a.pct != null).length ?? 0;

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
    <div className="max-w-3xl space-y-6">
      {/* Herkunfts-Pill (W1-8): woher diese Messung stammt */}
      <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
        <MessagesSquare className="h-3.5 w-3.5" />
        {t.evaluation.sourceSim}
        {props.personaName ? ` · ${props.personaName}` : ''}
      </span>

      {/* ── Debrief-Held: Score, Urteil, größter Hebel ── */}
      {debrief && (
        <section className="glass-panel rounded-2xl p-6 border border-border">
          <div className="flex flex-col sm:flex-row items-center gap-6">
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
                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                      : verdict === 'failed'
                        ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                        : 'bg-muted text-muted-foreground border-border'
                  )}
                >
                  {verdict === 'passed' ? ts.passed : verdict === 'failed' ? ts.failed : ts.unrated}
                </span>
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
              <p className="text-xs text-muted-foreground">
                {observedCount}/{debrief.anchors.length} {ts.coverageNote} · {debrief.checkpointsHit}/{debrief.checkpointsTotal} {ts.checkpointsTitle}
              </p>
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-left">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-primary mb-1 flex items-center gap-1">
                  <Sparkles className="h-3.5 w-3.5" /> {ts.biggestLever}
                </div>
                <p className="text-sm leading-relaxed">{feedback.nextStep}</p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Fokus-Review (D2) */}
      {feedback.focusReview && focus && (
        <section
          className={cx(
            'glass-panel rounded-2xl p-4 border flex items-start gap-3',
            feedback.focusReview.addressed
              ? 'border-emerald-500/30 bg-emerald-500/5'
              : 'border-amber-500/30 bg-amber-500/5'
          )}
        >
          {feedback.focusReview.addressed ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <RotateCcw className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
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

      <section className="glass-panel rounded-2xl p-6 space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {ts.summaryTitle}
        </h2>
        <p className="text-sm leading-relaxed">{feedback.summary}</p>
      </section>

      {/* Kompetenz-Anker mit Erwartungslabel, Balken, Delta und Belegen */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {ts.rubricTitle}
        </h2>
        {feedback.rubric.map((r) => {
          const anchor = debrief?.anchors.find((a) => a.key === r.key);
          const pct = anchor?.pct ?? null;
          const exp = anchor?.expectation ?? (r.score == null ? 'not-observable' : 'meets');
          const anchorDelta = deltaByKey.get(r.key) ?? null;
          const isOpen = openEvidence[r.key] ?? false;
          return (
            <div key={r.key} className="glass-panel rounded-xl border border-border p-4 space-y-3">
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
              <p className="text-sm text-muted-foreground leading-relaxed">{r.why}</p>
              {r.evidence.length > 0 && (
                <div>
                  <button
                    onClick={() => setOpenEvidence((m) => ({ ...m, [r.key]: !isOpen }))}
                    className="text-[11px] font-semibold uppercase tracking-wide text-primary flex items-center gap-1"
                  >
                    <ChevronDown className={cx('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-180')} />
                    {isOpen ? ts.hideEvidence : ts.showEvidence} ({r.evidence.length})
                  </button>
                  {isOpen && (
                    <div className="space-y-1.5 mt-2">
                      {r.evidence.map((e, idx) => (
                        <blockquote
                          key={idx}
                          className="text-xs italic border-l-2 border-primary/40 pl-2.5 py-0.5 text-muted-foreground leading-relaxed"
                        >
                          {e}
                        </blockquote>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {ts.checkpointsTitle}
        </h2>
        <div className="space-y-2">
          {feedback.checkpoints.map((c) => (
            <div key={c.id} className="glass-panel rounded-xl border border-border p-3 flex gap-3">
              {c.hit ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {c.hit ? ts.hit : ts.missed}
                </div>
                <p className="text-sm leading-relaxed">{c.comment}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* C1–C10 — W1-8: NICHT mehr zugeklappt; die Brücke zum Radar ist Kernaussage. */}
      {ratings && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {ts.c10Title}
          </h2>
          <div className="glass-panel rounded-xl border border-border p-4 space-y-2">
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
        </section>
      )}

      {/* CTA-Zeile: Fokus-Retry zuerst — die Schleife ist das Produkt. */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => props.onRetry(feedback.nextStep.slice(0, 280))}
          disabled={props.retryBusy}
          className="btn-gradient text-white font-semibold rounded-xl px-6 py-3 flex items-center gap-2 shadow-neon disabled:opacity-60"
        >
          {props.retryBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <RotateCcw className="h-5 w-5" />}
          {ts.retryFocusCta}
        </button>
        <button
          onClick={props.onNew}
          className="rounded-xl px-6 py-3 text-sm font-semibold border border-border hover:bg-muted transition-colors flex items-center gap-2"
        >
          <MessagesSquare className="h-5 w-5" /> {ts.newSimulation}
        </button>
      </div>
    </div>
  );
}
