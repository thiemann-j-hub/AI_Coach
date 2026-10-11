import { describe, expect, it } from "vitest";
import { rechenweg } from "./rechenweg";

const L = {
  scale: "S",
  anchors: "A {observed}/{total} {pct} {weight}",
  checkpoints: "C {hit}/{total} {pct} {weight}",
  sum: "= {aw} x {a} + {cw} x {c} = {overall}",
  onlyAnchors: "nurA {overall}",
  onlyCheckpoints: "nurC {overall}",
  pass: "ab {passMark}",
  unrated: "unrated",
};

describe("Rechenweg (N17)", () => {
  it("mit gespeicherten Teilwerten: exakte Formel", () => {
    const z = rechenweg(
      { overall: 77, verdict: "passed", passMarkPct: 60, anchors: [{ pct: 67 }, { pct: 67 }, { pct: null }], checkpointsHit: 2, checkpointsTotal: 2, anchorPct: 67, checkpointPct: 100, weights: { anchors: 0.7, checkpoints: 0.3 } },
      L
    );
    expect(z).toEqual(["S", "A 2/3 67 70", "C 2/2 100 30", "= 70 % x 67 + 30 % x 100 = 77", "ab 60"]);
  });
  it("Alt-Lauf ohne Teilwerte: ungewichtetes Mittel mit ≈", () => {
    const z = rechenweg({ overall: 50, verdict: "failed", passMarkPct: 60, anchors: [{ pct: 33 }, { pct: 67 }], checkpointsHit: 0, checkpointsTotal: 0 }, L);
    expect(z).toEqual(["S", "A 2/2 ≈ 50 70", "nurA 50", "ab 60"]);
  });
  it("nicht bewertbar: Erklärung statt Bestehensgrenze", () => {
    const z = rechenweg({ overall: null, verdict: "unrated", passMarkPct: 60, anchors: [{ pct: null }, { pct: null }], checkpointsHit: 1, checkpointsTotal: 2, anchorPct: null, checkpointPct: 50 }, L);
    expect(z).toEqual(["S", "A 0/2 – 70", "C 1/2 50 30", "unrated"]);
  });
});
