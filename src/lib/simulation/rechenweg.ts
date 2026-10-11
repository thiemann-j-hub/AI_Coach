/**
 * Rechenweg des Ergebnisses (Runde-2-Entwurf N17 / C4, Owner-GO 11.10.2026): „Jede Zahl sagt,
 * was sie zählt.“ Reine Funktion aus dem gespeicherten Debrief — auch für Alt-Läufe ohne
 * Teilwerte (dann ungewichtetes Mittel der beobachteten Anker; das kann vom gespeicherten
 * Ergebnis leicht abweichen, deshalb „≈“).
 */
export interface RechenwegDebrief {
  overall: number | null;
  verdict: "passed" | "failed" | "unrated";
  passMarkPct: number;
  anchors: ReadonlyArray<{ pct: number | null }>;
  checkpointsHit: number;
  checkpointsTotal: number;
  anchorPct?: number | null;
  checkpointPct?: number | null;
  weights?: { anchors: number; checkpoints: number };
}

export interface RechenwegLabels {
  scale: string;
  anchors: string;
  checkpoints: string;
  sum: string;
  onlyAnchors: string;
  onlyCheckpoints: string;
  pass: string;
  unrated: string;
}

function fill(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function rechenweg(d: RechenwegDebrief, l: RechenwegLabels): string[] {
  const observed = d.anchors.filter((a) => a.pct != null);
  const exact = typeof d.anchorPct === "number" || d.anchorPct === null;
  const aPct =
    exact
      ? (d.anchorPct as number | null)
      : observed.length === 0
        ? null
        : Math.round(observed.reduce((s, a) => s + (a.pct as number), 0) / observed.length);
  const cPct =
    typeof d.checkpointPct === "number" || d.checkpointPct === null
      ? (d.checkpointPct as number | null)
      : d.checkpointsTotal === 0
        ? null
        : Math.round((d.checkpointsHit / d.checkpointsTotal) * 100);
  const aw = Math.round((d.weights?.anchors ?? 0.7) * 100);
  const cw = 100 - aw;
  const approx = exact ? "" : "≈ ";
  const out: string[] = [l.scale];
  if (d.anchors.length > 0) {
    out.push(fill(l.anchors, { observed: observed.length, total: d.anchors.length, pct: aPct == null ? "–" : `${approx}${aPct}`, weight: aw }));
  }
  if (d.checkpointsTotal > 0) {
    out.push(fill(l.checkpoints, { hit: d.checkpointsHit, total: d.checkpointsTotal, pct: cPct ?? "–", weight: cw }));
  }
  if (d.overall != null) {
    if (aPct != null && cPct != null) out.push(fill(l.sum, { aw: `${aw} %`, a: `${approx}${aPct}`, cw: `${cw} %`, c: cPct, overall: d.overall }));
    else if (aPct != null) out.push(fill(l.onlyAnchors, { overall: d.overall }));
    else if (cPct != null) out.push(fill(l.onlyCheckpoints, { overall: d.overall }));
  }
  out.push(d.verdict === "unrated" ? l.unrated : fill(l.pass, { passMark: d.passMarkPct }));
  return out;
}
