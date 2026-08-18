'use client';

/**
 * Gemeinsame Rollenspiel-Auswertung (COACH-UX-BLUEPRINT §3/W1-7+W1-8):
 * aus SimulationClient extrahiert, damit die Auswertung eine EIGENE Route
 * (/simulation/[simId]) bekommt — verlinkbar, bookmarkbar, Reload-fest.
 * W1-8: einheitlicher ScoreRing, Herkunfts-Pill, C1–C10-Block offen.
 */

import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  GraduationCap,
  History,
  Loader2,
  MessagesSquare,
  Minus,
  RotateCcw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { ScoreRing } from '@/components/app/score-ring';
import { computeDeltaCta, computeStudioBridge } from '@/lib/simulation/endscreen';
import { computeDelivery, type DeliveryReport } from '@/lib/simulation/delivery';
import { useTranslation } from '@/i18n/useTranslation';

/* ── Typen (Vertrag der /api/simulation/get- bzw. finish-Antwort) ── */

export interface SimEvalFeedback {
  summary: string;
  rubric: { key: string; label: string; evidence: string[]; why: string; score: number | null }[];
  checkpoints: { id: string; hit: boolean; comment: string }[];
  nextStep: string;
  focusReview?: { addressed: boolean; comment: string } | null;
  /** A1: Abgleich Selbstbild ↔ Auswertung (nur wenn Check-in beantwortet wurde). */
  selfReview?: { agreement: 'confirms' | 'partly' | 'differs'; comment: string } | null;
}

/** A3: ein Punkt der Verlaufskurve (aus /api/simulation/list, gleiche Quelle wie die Historie). */
export interface SimEvalHistoryPoint {
  id: string;
  attempt: number;
  overall: number | null;
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
  /** W3-1: C1–C10-Delta ggü. Vorversuch (measurement-delta, additiv). */
  competencies?: Record<string, number | null> | null;
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

/**
 * A3: Verlaufskurve — Score über Versuche als schlichtes Inline-SVG (keine
 * neue Bibliothek). Bestehenslinie gestrichelt, bester Versuch markiert.
 */
function AttemptChart(props: {
  points: SimEvalHistoryPoint[];
  passMark: number;
  currentAttempt: number;
  bestLabel: string;
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
      aria-label="Score-Verlauf"
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
              className="fill-current text-emerald-400 font-semibold"
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

/** A2: Drei-Stufen-Skala eines Delivery-Werts — zeigt, WO auf der Skala der Lauf liegt. */
function DeliveryScale(props: { position: 0 | 1 | 2; tone: 'ok' | 'mid' | 'off' }) {
  const toneCls =
    props.tone === 'ok' ? 'bg-emerald-400' : props.tone === 'mid' ? 'bg-amber-400' : 'bg-rose-400';
  return (
    <div className="flex gap-1 w-24 shrink-0" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={cx('h-1.5 flex-1 rounded-full', i === props.position ? toneCls : 'bg-border')}
        />
      ))}
    </div>
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
  /** A1: die Selbsteinschätzung aus dem Check-in (wörtlich, für die Karte). */
  selfAssessment?: string | null;
  /** A2: Turns für das deterministische Delivery-Panel (null = Panel entfällt). */
  turns?: Array<{ role: string; text: string }> | null;
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
  /** Zurück zum Einstieg. */
  onNew: () => void;
}) {
  const { t } = useTranslation();
  const ts = t.simulation;
  const { feedback, debrief, delta, attempt, focus, ratings } = props;

  const [openEvidence, setOpenEvidence] = useState<Record<string, boolean>>({});
  // W3-2: der Vorsatz ist SELBST geschrieben — vorbefüllt mit dem
  // nextStep-Vorschlag, frei editierbar (kein stummes slice mehr).
  // An der WORTGRENZE kürzen (Test-Fund 11.08.: der harte 280-Schnitt endete
  // mitten im Wort — »… statt alles zu bündeln« wurde zu »… sta«).
  const [commitment, setCommitment] = useState(() => truncateAtWord(feedback.nextStep, 280));

  // W3-1: Erkenntnis → Handlung (pure, getestet).
  const deltaCta = useMemo(
    () =>
      computeDeltaCta({
        ratings,
        deltaCompetencies: delta?.competencies ?? null,
        scenarios: props.scenarios ?? [],
        currentScenarioId: props.currentScenarioId ?? null,
      }),
    [ratings, delta, props.scenarios, props.currentScenarioId]
  );
  // W3-3: Studio-Brücke nur bei echter Schwäche (≤ 2).
  const studioBridge = useMemo(() => computeStudioBridge(ratings), [ratings]);
  // A2: Delivery deterministisch aus den Turns — pure, kostenlos, auch für Alt-Läufe.
  const delivery: DeliveryReport | null = useMemo(
    () => (props.turns && props.turns.length ? computeDelivery(props.turns, props.convoLocale) : null),
    [props.turns, props.convoLocale]
  );
  const [softenersOpen, setSoftenersOpen] = useState(false);

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

    // mx-auto: die Auswertung klebte auf breiten Bildschirmen am linken Rand
    // (Test-Fund 11.08.) — Chat und Verlauf zentrieren bereits.
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Herkunfts-Pill (W1-8): woher diese Messung stammt */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
          <MessagesSquare className="h-3.5 w-3.5" />
          {t.evaluation.sourceSim}
          {props.personaName ? ` · ${props.personaName}` : ''}
        </span>
        {props.mode === 'check' && (
          <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-400">
            {ts.modeCheckBadge}
          </span>
        )}
        {props.hardness && props.hardness !== 'standard' && (
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
            {props.hardness === 'mild' ? ts.hardnessMild : ts.hardnessHart}
          </span>
        )}
      </div>

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

      {/* A3: Verlaufskurve — erst ab dem zweiten bewerteten Versuch. */}
      {debrief && (props.history?.filter((p) => p.overall != null).length ?? 0) >= 2 && (
        <section className="glass-panel rounded-2xl p-5 border border-border space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <History className="h-4 w-4" /> {ts.historyTitle}
          </h2>
          <AttemptChart
            points={props.history!}
            passMark={debrief.passMarkPct}
            currentAttempt={attempt}
            bestLabel={ts.historyBest}
          />
          <p className="text-xs text-muted-foreground">{ts.historyHint}</p>
        </section>
      )}

      {/* A1: Selbstbild ↔ Auswertung — der Synthesia-Moment, aber belegt. */}
      {feedback.selfReview && props.selfAssessment && (
        <section
          className={cx(
            'glass-panel rounded-2xl p-4 border flex items-start gap-3',
            feedback.selfReview.agreement === 'confirms'
              ? 'border-emerald-500/30 bg-emerald-500/5'
              : feedback.selfReview.agreement === 'partly'
                ? 'border-sky-500/30 bg-sky-500/5'
                : 'border-amber-500/30 bg-amber-500/5'
          )}
        >
          {feedback.selfReview.agreement === 'confirms' ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
          ) : feedback.selfReview.agreement === 'partly' ? (
            <Minus className="h-5 w-5 text-sky-400 shrink-0 mt-0.5" />
          ) : (
            <RotateCcw className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
          )}
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {ts.selfReviewTitle} —{' '}
              {feedback.selfReview.agreement === 'confirms'
                ? ts.selfConfirms
                : feedback.selfReview.agreement === 'partly'
                  ? ts.selfPartly
                  : ts.selfDiffers}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 italic">»{props.selfAssessment}«</p>
            <p className="text-sm leading-relaxed mt-1">{feedback.selfReview.comment}</p>
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

      {/* A2: Delivery-Panel — WIE kommuniziert wurde. Deterministisch, ohne
          Score-Einfluss (Sparring-Beschluss); Weichmacher-Treffer sind auf
          Klick im Kontext einsehbar (Beleg-Philosophie). */}
      {delivery && delivery.talkRatioPct != null && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <Activity className="h-4 w-4" /> {ts.deliveryTitle}
          </h2>
          <div className="glass-panel rounded-xl border border-border p-4 space-y-3">
            <p className="text-xs text-muted-foreground">{ts.deliveryHint}</p>

            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">{ts.dlvTalkRatio}</div>
                <div className="text-xs text-muted-foreground">
                  {delivery.talkRatioPct} % ·{' '}
                  {delivery.talkBand === 'listening'
                    ? ts.dlvTalkListening
                    : delivery.talkBand === 'balanced'
                      ? ts.dlvTalkBalanced
                      : ts.dlvTalkTalking}
                </div>
              </div>
              <DeliveryScale
                position={delivery.talkBand === 'listening' ? 0 : delivery.talkBand === 'balanced' ? 1 : 2}
                tone={delivery.talkBand === 'balanced' ? 'ok' : 'mid'}
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">{ts.dlvSentenceLength}</div>
                <div className="text-xs text-muted-foreground">
                  {delivery.medianSentenceWords} {ts.dlvWordsUnit} ·{' '}
                  {delivery.sentenceBand === 'short'
                    ? ts.dlvSentenceShort
                    : delivery.sentenceBand === 'normal'
                      ? ts.dlvSentenceNormal
                      : ts.dlvSentenceLong}
                </div>
              </div>
              <DeliveryScale
                position={delivery.sentenceBand === 'short' ? 0 : delivery.sentenceBand === 'normal' ? 1 : 2}
                tone={delivery.sentenceBand === 'normal' ? 'ok' : 'mid'}
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">{ts.dlvOpeners}</div>
                <div className="text-xs text-muted-foreground">
                  {delivery.openerRepetitionPct} % ·{' '}
                  {delivery.openerBand === 'varied'
                    ? ts.dlvOpenersVaried
                    : delivery.openerBand === 'some'
                      ? ts.dlvOpenersSome
                      : ts.dlvOpenersRepetitive}
                </div>
              </div>
              <DeliveryScale
                position={delivery.openerBand === 'varied' ? 0 : delivery.openerBand === 'some' ? 1 : 2}
                tone={
                  delivery.openerBand === 'varied' ? 'ok' : delivery.openerBand === 'some' ? 'mid' : 'off'
                }
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{ts.dlvSofteners}</div>
                  <div className="text-xs text-muted-foreground">
                    {delivery.softenersPer100} {ts.dlvPer100} ·{' '}
                    {delivery.softenerBand === 'normal'
                      ? ts.dlvSoftenersNormal
                      : delivery.softenerBand === 'elevated'
                        ? ts.dlvSoftenersElevated
                        : ts.dlvSoftenersMany}
                  </div>
                </div>
                <DeliveryScale
                  position={
                    delivery.softenerBand === 'normal' ? 0 : delivery.softenerBand === 'elevated' ? 1 : 2
                  }
                  tone={
                    delivery.softenerBand === 'normal'
                      ? 'ok'
                      : delivery.softenerBand === 'elevated'
                        ? 'mid'
                        : 'off'
                  }
                />
              </div>
              {delivery.softenerMatches.length > 0 && (
                <div>
                  <button
                    onClick={() => setSoftenersOpen((v) => !v)}
                    className="text-[11px] font-semibold uppercase tracking-wide text-primary flex items-center gap-1"
                  >
                    <ChevronDown
                      className={cx('h-3.5 w-3.5 transition-transform', softenersOpen && 'rotate-180')}
                    />
                    {softenersOpen ? ts.dlvHideMatches : ts.dlvShowMatches} (
                    {delivery.softenerMatches.length})
                  </button>
                  {softenersOpen && (
                    <div className="space-y-1.5 mt-2">
                      {delivery.softenerMatches.slice(0, 12).map((m, idx) => (
                        <blockquote
                          key={idx}
                          className="text-xs italic border-l-2 border-primary/40 pl-2.5 py-0.5 text-muted-foreground leading-relaxed"
                        >
                          <span className="not-italic font-semibold">{m.phrase}</span> — {m.context}
                        </blockquote>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

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

      {/* ── W3: Endscreen-Mechaniken — Reihenfolge Delta → Commitment → Brücke ── */}

      {/* W3-1: Delta als Auslöser — Satz + Handlung statt stummem Tag. */}
      {deltaCta && (
        <section className="glass-panel rounded-2xl p-5 border border-primary/30 bg-primary/5">
          <p className="text-sm leading-relaxed">
            <span className="font-semibold">
              {(deltaCta.mode === 'dropped'
                ? t.evaluation.deltaDroppedSentence
                : t.evaluation.deltaWeakestSentence
              ).replace('{c}', deltaCta.cName ?? deltaCta.cKey)}
            </span>
            {deltaCta.scenarioTitle && (
              <> {t.evaluation.deltaScenarioAims.replace('{s}', splitTitle(deltaCta.scenarioTitle).motto)}</>
            )}
          </p>
          {deltaCta.scenarioId && props.onOpenScenario && (
            <button
              onClick={() => props.onOpenScenario!(deltaCta.scenarioId!)}
              className="mt-3 inline-flex items-center gap-2 rounded-lg border border-primary/40 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/10 transition-colors"
            >
              {t.evaluation.deltaCtaButton} <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </section>
      )}

      {/* W3-2: selbstgeschriebenes Commitment — kein stummes nextStep.slice mehr. */}
      <section className="glass-panel rounded-2xl p-5 border border-border space-y-3">
        <label
          htmlFor="commitment"
          className="text-sm font-semibold flex items-center gap-1.5"
        >
          <Sparkles className="h-4 w-4 text-primary" /> {t.evaluation.commitmentQuestion}
        </label>
        <textarea
          id="commitment"
          value={commitment}
          onChange={(e) => setCommitment(e.target.value)}
          rows={3}
          maxLength={300}
          className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => props.onRetry(commitment.trim().slice(0, 300))}
            disabled={props.retryBusy || commitment.trim().length === 0}
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
      </section>

      {/* W3-3: Studio-Brücke — nur bei echter Schwäche (≤ 2), neuer Tab. */}
      {studioBridge && (
        <section className="glass-panel rounded-2xl p-5 border border-accent/30 bg-accent/5">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
              <GraduationCap className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">{t.evaluation.studioBridgeTitle}</h3>
              <p className="mt-0.5 text-sm text-muted-foreground leading-relaxed">
                {t.evaluation.studioBridgeBody.replace(
                  '{c}',
                  studioBridge.cName ?? studioBridge.cKey
                )}
              </p>
              <a
                href={studioBridge.href}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-2 rounded-lg border border-accent/40 px-4 py-2 text-sm font-semibold text-accent hover:bg-accent/10 transition-colors"
              >
                <GraduationCap className="h-4 w-4" /> {t.evaluation.studioBridgeCta}
                <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
