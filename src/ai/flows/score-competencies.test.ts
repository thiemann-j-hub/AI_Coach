import { describe, it, expect } from "vitest";
import { mergeConsensusRuns } from "./score-competencies";

/**
 * Konsens-Merge (SCORING_CONSENSUS): Mehrheits-Beobachtbarkeit + Median-Score.
 * Ziel: null-Flattern mechanisch eliminieren — eine Kompetenz, die nur 1 von 3
 * Läufen "sieht", ist konsistent nicht beobachtbar.
 */
const C = (id: string, score: number | null, why = "w", evidence: string[] = score ? ["\"Zitat\""] : []) =>
  ({ id, name: id, evidence, why, score, confidence: score ? 0.8 : null });

describe("mergeConsensusRuns", () => {
  it("Mehrheit beobachtet (2/3) -> Median-Score, Repraesentant liefert Evidenz", () => {
    const merged = mergeConsensusRuns([
      { competencies: [C("C1", 3)] },
      { competencies: [C("C1", 4)] },
      { competencies: [C("C1", null)] },
    ]);
    expect(merged.competencies[0].score).toBe(3.5); // Median von [3,4]
    expect(merged.competencies[0].evidence.length).toBeGreaterThan(0);
  });

  it("Minderheit beobachtet (1/3) -> konsistent null, KEIN Flattern", () => {
    const merged = mergeConsensusRuns([
      { competencies: [C("C9", 2)] },
      { competencies: [C("C9", null)] },
      { competencies: [C("C9", null)] },
    ]);
    expect(merged.competencies[0].score).toBeNull();
    expect(merged.competencies[0].evidence).toEqual([]);
  });

  it("3/3 beobachtet -> echter Median (Ausreisser wird neutralisiert)", () => {
    const merged = mergeConsensusRuns([
      { competencies: [C("C2", 3)] },
      { competencies: [C("C2", 3)] },
      { competencies: [C("C2", 1)] }, // der historische C2-Ausreisser
    ]);
    expect(merged.competencies[0].score).toBe(3);
  });

  it("alle null -> null; Reihenfolge der Kompetenzen bleibt erhalten", () => {
    const merged = mergeConsensusRuns([
      { competencies: [C("C1", 3), C("C2", null)] },
      { competencies: [C("C1", 3), C("C2", null)] },
      { competencies: [C("C1", 3), C("C2", null)] },
    ]);
    expect(merged.competencies.map((c) => c.id)).toEqual(["C1", "C2"]);
    expect(merged.competencies[1].score).toBeNull();
  });

  it("2 Laeufe (einer ausgefallen): Mehrheit = 1 -> einzelner Beobachter genuegt", () => {
    const merged = mergeConsensusRuns([
      { competencies: [C("C3", 2)] },
      { competencies: [C("C3", null)] },
    ]);
    // majority = ceil(2/2) = 1 -> beobachtet
    expect(merged.competencies[0].score).toBe(2);
  });
});
