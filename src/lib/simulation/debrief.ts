/**
 * Debrief 2.0 — deterministische Gesamtwertung der Gesprächssimulation
 * (Blueprint pulsenorth-ops/COACH-DEBRIEF-BLUEPRINT.md, Welle D1).
 *
 * GRUNDSATZ: Das LLM liefert Evidenz, Begründung und Einzel-Scores (1–4) —
 * die RECHNUNG (Gesamtscore, Bestehen, Labels, Deltas) passiert hier in Code,
 * damit sie nachvollziehbar, stabil und testbar ist (Lehre Deckungsbeitrag).
 *
 * EHRLICHKEIT statt 0-%-Strafe (bewusste Abgrenzung zu Synthesia Roleplay):
 * »nicht beobachtbar« drückt den Score nicht auf 0, sondern verkleinert die
 * Bewertungsbasis. Sind weniger als die Hälfte der Kompetenzen belegt, gibt es
 * KEIN Bestanden/Nicht bestanden, sondern das Urteil »Nicht bewertbar«.
 *
 * Pure & isomorph: läuft server- wie clientseitig (alte Simulationen ohne
 * gespeicherten Debrief werden beim Lesen nachgerechnet).
 */

export interface DebriefRubricInput {
  key: string;
  label: string;
  score: number | null; // 1–4 oder null = nicht beobachtbar
  /** B1: relatives Anker-Gewicht (Default 1 = alle gleich). */
  weight?: number;
}

export interface DebriefCheckpointInput {
  id: string;
  hit: boolean;
}

/** Erwartungslabel je Kompetenz (Score 1–4 bzw. nicht beobachtbar). */
export type ExpectationLabel =
  | "not-observable"
  | "below"
  | "approaching"
  | "meets"
  | "exceeds";

export type DebriefVerdict = "passed" | "failed" | "unrated";

export interface DebriefAnchor {
  key: string;
  label: string;
  score: number | null;
  /** 0–100, null wenn nicht beobachtbar. */
  pct: number | null;
  expectation: ExpectationLabel;
}

export interface Debrief {
  /** 0–100, null wenn zu wenig beobachtbar (verdict "unrated"). */
  overall: number | null;
  verdict: DebriefVerdict;
  /** Bestehensgrenze in Prozent (aus dem Szenario, Default 60). */
  passMarkPct: number;
  /** Anteil belegter Kompetenzen 0–1 (Transparenz der Bewertungsbasis). */
  coverage: number;
  anchors: DebriefAnchor[];
  checkpointsHit: number;
  checkpointsTotal: number;
  /** Anteil Kompetenz- vs. Schlüsselmoment-Wertung an overall. */
  weights: { anchors: number; checkpoints: number };
}

export interface DebriefDelta {
  overall: number | null; // Punkt-Differenz zum Vorversuch (null wenn unvergleichbar)
  anchors: Array<{ key: string; delta: number | null }>;
  prevOverall: number | null;
  prevAttempt: number;
}

export const DEFAULT_PASS_THRESHOLD = 0.6;
/** B2: Bestehensgrenze im Prüfungsmodus, wenn das Szenario keine eigene setzt. */
export const CHECK_PASS_THRESHOLD = 0.7;
const ANCHOR_WEIGHT = 0.7;
const CHECKPOINT_WEIGHT = 0.3;
/** Unter dieser Belegquote ist ein Urteil unseriös → "Nicht bewertbar". */
const MIN_COVERAGE_FOR_VERDICT = 0.5;

/** Score 1–4 → Prozent (1 = 0 %, 4 = 100 %). */
export function scoreToPct(score: number): number {
  const s = Math.min(4, Math.max(1, score));
  return Math.round(((s - 1) / 3) * 100);
}

export function expectationForScore(score: number | null): ExpectationLabel {
  if (score == null) return "not-observable";
  if (score >= 4) return "exceeds";
  if (score >= 3) return "meets";
  if (score >= 2) return "approaching";
  return "below";
}

export function computeDebrief(args: {
  rubric: DebriefRubricInput[];
  checkpoints: DebriefCheckpointInput[];
  passThreshold?: number;
}): Debrief {
  const passThreshold =
    typeof args.passThreshold === "number" &&
    args.passThreshold > 0 &&
    args.passThreshold < 1
      ? args.passThreshold
      : DEFAULT_PASS_THRESHOLD;

  const anchors: DebriefAnchor[] = args.rubric.map((r) => ({
    key: r.key,
    label: r.label,
    score: r.score,
    pct: r.score == null ? null : scoreToPct(r.score),
    expectation: expectationForScore(r.score),
  }));

  const observed = anchors.filter((a) => a.pct != null);
  const coverage = anchors.length === 0 ? 0 : observed.length / anchors.length;
  // B1: gewichtetes Mittel über die BEOBACHTETEN Anker (Normalisierung über
  // deren Gewichtssumme — Ehrlichkeits-Prinzip unverändert: null verkleinert
  // die Basis statt auf 0 zu drücken). Ohne weights identisch zum alten Mittel.
  const weightByKey = new Map(
    args.rubric.map((r) => [
      r.key,
      typeof r.weight === "number" && r.weight > 0 ? r.weight : 1,
    ])
  );
  const observedWeightSum = observed.reduce(
    (s, a) => s + (weightByKey.get(a.key) ?? 1),
    0
  );
  const anchorPct =
    observed.length === 0 || observedWeightSum === 0
      ? null
      : observed.reduce(
          (s, a) => s + (a.pct as number) * (weightByKey.get(a.key) ?? 1),
          0
        ) / observedWeightSum;

  const checkpointsTotal = args.checkpoints.length;
  const checkpointsHit = args.checkpoints.filter((c) => c.hit).length;
  const checkpointPct =
    checkpointsTotal === 0 ? null : (checkpointsHit / checkpointsTotal) * 100;

  // Gesamt: gewichteter Mix; fehlt eine Seite komplett, trägt die andere allein.
  let overall: number | null = null;
  if (anchorPct != null && checkpointPct != null) {
    overall = Math.round(ANCHOR_WEIGHT * anchorPct + CHECKPOINT_WEIGHT * checkpointPct);
  } else if (anchorPct != null) {
    overall = Math.round(anchorPct);
  } else if (checkpointPct != null && coverage >= MIN_COVERAGE_FOR_VERDICT) {
    overall = Math.round(checkpointPct);
  }

  const passMarkPct = Math.round(passThreshold * 100);
  const verdict: DebriefVerdict =
    overall == null || coverage < MIN_COVERAGE_FOR_VERDICT
      ? "unrated"
      : overall >= passMarkPct
        ? "passed"
        : "failed";

  return {
    overall: verdict === "unrated" ? overall : overall,
    verdict,
    passMarkPct,
    coverage: Math.round(coverage * 100) / 100,
    anchors,
    checkpointsHit,
    checkpointsTotal,
    weights: { anchors: ANCHOR_WEIGHT, checkpoints: CHECKPOINT_WEIGHT },
  };
}

/** Vergleich zum Vorversuch — nur berichten, was wirklich vergleichbar ist. */
export function computeDelta(args: {
  current: Debrief;
  previous: Debrief;
  prevAttempt: number;
}): DebriefDelta {
  const prevByKey = new Map(args.previous.anchors.map((a) => [a.key, a]));
  return {
    overall:
      args.current.overall != null && args.previous.overall != null
        ? args.current.overall - args.previous.overall
        : null,
    anchors: args.current.anchors.map((a) => {
      const p = prevByKey.get(a.key);
      return {
        key: a.key,
        delta: a.pct != null && p?.pct != null ? a.pct - p.pct : null,
      };
    }),
    prevOverall: args.previous.overall,
    prevAttempt: args.prevAttempt,
  };
}
