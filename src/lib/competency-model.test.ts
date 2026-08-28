import { describe, expect, it } from "vitest";
import {
  COMP_MODEL,
  defaultCompetencyRatings,
  normalizeCompetencyRatings,
} from "./competency-model";

/**
 * Regressionsschutz für den SIM-2-Refactor: Diese Logik lag vorher inline in
 * /api/analyze (bezahlter Pfad) — Verhalten muss identisch geblieben sein.
 */
describe("competency-model", () => {
  it("COMP_MODEL: 10 Kompetenzen C1–C10 mit den Runtime-Labels", () => {
    expect(COMP_MODEL).toHaveLength(10);
    expect(COMP_MODEL.map((c) => c.id)).toEqual([
      "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10",
    ]);
    expect(COMP_MODEL[1].name).toBe("Problemlösung und Entscheidungsfindung");
  });

  it("defaultCompetencyRatings: vollständig, alles null + 'nicht ausreichend beobachtbar'", () => {
    const d = defaultCompetencyRatings();
    expect(d).toHaveLength(10);
    for (const r of d) {
      expect(r.score).toBeNull();
      expect(r.confidence).toBeNull();
      expect(r.evidence).toEqual([]);
      expect(r.why).toBe("nicht ausreichend beobachtbar");
    }
  });

  it("normalisiert: fehlende ids -> Default, Score außerhalb 1–4 -> null, Evidenz auf 2 gekappt", () => {
    const out = normalizeCompetencyRatings(
      {
        competencies: [
          { id: "C1", score: 3, why: "gut", evidence: ["A: x", "B: y", "C: z"], confidence: 0.8 },
          { id: "C2", score: 7, why: "zu hoch", evidence: ["q"] },
          { id: "C3", score: 2, why: "", evidence: [] },
        ],
      },
      {}
    );
    expect(out).toHaveLength(10);
    const c1 = out.find((r) => r.id === "C1")!;
    expect(c1.score).toBe(3);
    expect(c1.evidence).toHaveLength(2);
    expect(c1.confidence).toBe(0.8);
    const c2 = out.find((r) => r.id === "C2")!;
    expect(c2.score).toBeNull();
    expect(c2.why).toBe("nicht ausreichend beobachtbar");
    const c3 = out.find((r) => r.id === "C3")!;
    expect(c3.score).toBe(2);
    expect(c3.why).toBe("—");
    const c4 = out.find((r) => r.id === "C4")!;
    expect(c4.score).toBeNull();
    expect(c4.why).toBe("nicht ausreichend beobachtbar");
  });

  it("anonymisiert Rollen-Labels in der Evidenz und respektiert lang=en", () => {
    const out = normalizeCompetencyRatings(
      {
        competencies: [
          { id: "C5", score: 2, why: "ok", evidence: ["Anna Chef: gut gemacht, Bert Blau."] },
          { id: "C6", score: null, why: "", evidence: [] },
        ],
      },
      { lang: "en", leaderLabel: "Anna Chef", employeeLabel: "Bert Blau" }
    );
    const c5 = out.find((r) => r.id === "C5")!;
    expect(c5.evidence[0]).toBe("Führungskraft: gut gemacht, Mitarbeiter:in.");
    const c6 = out.find((r) => r.id === "C6")!;
    expect(c6.why).toBe("not sufficiently observable");
  });

  it("wirft nicht bei Garbage-Input (Negativ-Test)", () => {
    for (const garbage of [null, undefined, 42, "x", {}, { competencies: "nope" }]) {
      const out = normalizeCompetencyRatings(garbage as unknown);
      expect(out).toHaveLength(10);
      expect(out.every((r) => r.score === null)).toBe(true);
    }
  });
});
