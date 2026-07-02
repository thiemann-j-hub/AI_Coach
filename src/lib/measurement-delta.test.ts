import { describe, it, expect } from "vitest";
import { computeMeasurementDelta } from "./measurement-delta";

/**
 * Plattform-Bedingung B (Skalen-SSOT + Null-Disziplin):
 * - Delta rechnet ueber metricsFromCompetencyRatings (0 ⇒ null, 1–4-Skala)
 * - nicht beobachtbar in EINEM Lauf ⇒ Delta null (nie 0, nie Pseudo-Delta)
 * - overall = Mittel NUR der beobachtbaren Werte (nie scoreOverall/10)
 */
describe("computeMeasurementDelta", () => {
  it("rechnet Deltas auf der 1–4-Vertragsskala (beidseitig beobachtbar)", () => {
    const d = computeMeasurementDelta(
      [{ id: "C1", score: 3 }, { id: "C2", score: 4 }],
      [{ id: "C1", score: 2 }, { id: "C2", score: 4 }]
    );
    expect(d.deltas.C1).toBe(1);
    expect(d.deltas.C2).toBe(0);
    expect(d.comparableCount).toBe(2);
    // overall = Mittel der beobachtbaren: (3+4)/2=3.5 vs (2+4)/2=3 → +0.5
    expect(d.current.overall).toBe(3.5);
    expect(d.previous.overall).toBe(3);
    expect(d.deltas.overall).toBe(0.5);
  });

  it("NULL-Disziplin: in einem Lauf nicht beobachtbar ⇒ Delta null, zaehlt als nicht vergleichbar", () => {
    const d = computeMeasurementDelta(
      [{ id: "C1", score: 3 }, { id: "C2", score: null }],
      [{ id: "C1", score: null }, { id: "C2", score: 2 }]
    );
    expect(d.deltas.C1).toBeNull();
    expect(d.deltas.C2).toBeNull();
    expect(d.comparableCount).toBe(0);
    expect(d.notComparableCount).toBe(2);
  });

  it("Vertrags-Regel: score 0 gilt als NICHT beobachtbar (0 ⇒ null), kein Delta", () => {
    const d = computeMeasurementDelta(
      [{ id: "C1", score: 0 }],
      [{ id: "C1", score: 3 }]
    );
    expect(d.current.C1).toBeNull();
    expect(d.deltas.C1).toBeNull();
    expect(d.notComparableCount).toBe(1);
  });

  it("beidseitig unbeobachtet ⇒ weder vergleichbar noch 'nicht vergleichbar' (keine Aussage)", () => {
    const d = computeMeasurementDelta([], []);
    expect(d.deltas.C5).toBeNull();
    expect(d.comparableCount).toBe(0);
    expect(d.notComparableCount).toBe(0);
    expect(d.deltas.overall).toBeNull();
  });

  it("rundet auf 1 Nachkommastelle (kein Float-Rauschen im UI)", () => {
    const d = computeMeasurementDelta(
      [{ id: "C1", score: 3 }, { id: "C2", score: 3 }, { id: "C3", score: 2 }],
      [{ id: "C1", score: 2 }, { id: "C2", score: 4 }, { id: "C3", score: 2 }]
    );
    // overall: (3+3+2)/3=2.7 vs (2+4+2)/3=2.7 → 0
    expect(d.deltas.overall).toBe(0);
    expect(d.deltas.C1).toBe(1);
    expect(d.deltas.C2).toBe(-1);
  });

  it("defensiv: kaputte/fremde Eingaben werfen nie", () => {
    const d = computeMeasurementDelta("garbage", { nope: true });
    expect(d.comparableCount).toBe(0);
    expect(d.deltas.overall).toBeNull();
  });
});
