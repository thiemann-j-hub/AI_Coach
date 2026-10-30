import { describe, expect, it } from "vitest";
import { computeDebrief } from "./debrief";

describe("computeDebrief — Welle 1: Gewicht und Beitrag je Anker", () => {
  it("verteilt die 70 Anker-Punkte nach Gewicht über die beobachteten Anker", () => {
    const d = computeDebrief({
      rubric: [
        { key: "a", label: "A", score: 4, weight: 50 },
        { key: "b", label: "B", score: 1, weight: 25 },
        { key: "c", label: "C", score: null, weight: 25 },
      ],
      checkpoints: [{ id: "x", hit: true }, { id: "y", hit: false }],
    });
    const a = d.anchors.find((x) => x.key === "a")!;
    const b = d.anchors.find((x) => x.key === "b")!;
    const c = d.anchors.find((x) => x.key === "c")!;
    // Nicht beobachtet: kein Gewicht, kein Beitrag — die Basis schrumpft (Ehrlichkeits-Prinzip).
    expect(c.weightPct).toBeNull();
    expect(c.contribution).toBeNull();
    expect(a.weightPct).toBe(67);
    expect(b.weightPct).toBe(33);
    // a: 0,7 × (50/75) × 100 = 46,7 → 47; b: 0,7 × (25/75) × 0 = 0
    expect(a.contribution).toBe(47);
    expect(b.contribution).toBe(0);
    // Gesamt = 0,7 × gewichteter Ankerwert (66,7) + 0,3 × 50 = 46,7 + 15 = 62
    expect(d.overall).toBe(62);
  });

  it("ohne Schlüsselmomente tragen die Anker allein (Beitrag aus 100 Punkten)", () => {
    const d = computeDebrief({ rubric: [{ key: "a", label: "A", score: 3 }, { key: "b", label: "B", score: 3 }], checkpoints: [] });
    // 1 × 0,5 × 67 = 33,5 → 34 je Anker (Rundung je Anker; die Gesamtnote rechnet ungerundet: 67).
    expect(d.anchors.map((x) => x.contribution)).toEqual([34, 34]);
    expect(d.overall).toBe(67);
  });
});
