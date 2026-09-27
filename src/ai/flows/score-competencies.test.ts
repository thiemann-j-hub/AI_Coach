import { describe, it, expect } from "vitest";
import { applyCategoryRule, applyObservabilityCap, mergeConsensusRuns } from "./score-competencies";

/**
 * Konsens-Merge (SCORING_CONSENSUS): Mehrheits-Beobachtbarkeit + Median-Score.
 * Ziel: null-Flattern mechanisch eliminieren — eine Kompetenz, die nur 1 von 3
 * Läufen "sieht", ist konsistent nicht beobachtbar.
 */
const C = (id: string, score: number | null, why = "w", evidence: string[] = score ? ["\"Zitat\""] : []) =>
  ({ id, name: id, observability: "explicit" as const, evidence, why, score, confidence: score ? 0.8 : null });

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

describe("applyObservabilityCap — O1d: Beobachtbarkeit deckelt den Score (Gemini Zu 2: Struktur statt Zitat-Zwang)", () => {
  it("none → null, incidental → max 3, explicit bleibt, fehlendes Feld bleibt", () => {
    const out = applyObservabilityCap({
      competencies: [
        { id: "C7", name: "Innovative Kultur", observability: "none", evidence: ["x"], why: "…", score: 3 },
        { id: "C9", name: "Weitblick", observability: "incidental", evidence: ["Teilnehmer:in: …"], why: "…", score: 4 },
        { id: "C2", name: "Problemlösung", observability: "incidental", evidence: ["…"], why: "…", score: 2 },
        { id: "C5", name: "Kommunikation", observability: "explicit", evidence: ["…"], why: "…", score: 4 },
        { id: "C1", name: "Beziehung", evidence: ["…"], why: "…", score: 4 },
      ] as any,
    });
    const by = Object.fromEntries(out.competencies.map((c: any) => [c.id, c]));
    expect(by.C7.score).toBeNull();
    expect(by.C7.evidence).toEqual([]);
    expect(by.C9.score).toBe(3);
    expect(by.C2.score).toBe(2);
    expect(by.C5.score).toBe(4);
    expect(by.C1.score).toBe(4);
  });
});

describe("applyCategoryRule — O1d: Führungskompetenzen nur in Führungsszenarien", () => {
  it("zusammenarbeit/vertrieb → C3/C4/C7/C9 null; mitarbeiterfuehrung/ohne Kategorie unverändert", () => {
    const base = { competencies: [C("C4", 3), C("C5", 4), C("C9", 4), C("C3", null)] };
    const peer = applyCategoryRule(base, "zusammenarbeit");
    expect(peer.competencies.map((c) => `${c.id}=${c.score}`)).toEqual(["C4=null", "C5=4", "C9=null", "C3=null"]);
    expect(peer.competencies[0].evidence).toEqual([]);
    expect(applyCategoryRule(base, "vertrieb").competencies[2].score).toBeNull();
    expect(applyCategoryRule(base, "mitarbeiterfuehrung").competencies[0].score).toBe(3);
    expect(applyCategoryRule(base).competencies[2].score).toBe(4);
  });
});
