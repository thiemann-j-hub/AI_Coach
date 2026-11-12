import { describe, expect, it } from "vitest";
import {
  recommendScenarios,
  weakestObservedC,
  weakestObservedSkill,
  type RatingLike,
  type SkillRatingLike,
} from "./empfehlung";

const ratings: RatingLike[] = [
  { id: "C1", name: "Beziehungsmanagement und Vernetzung", score: 3 },
  { id: "C2", name: "Problemlösung und Entscheidungsfindung", score: 2 },
  { id: "C3", name: "Befähigen und Entwickeln", score: null }, // nicht beobachtbar
  { id: "C5", name: "Kommunikation und Teamfähigkeit", score: 2 },
];

const k = (...keys: string[]) => keys.map((key) => ({ key }));
const scenarios = [
  { id: "a", difficulty: 1 as const, competencies: k("rahmen", "ursache") },
  { id: "b", difficulty: 1 as const, competencies: k("konkret", "vereinbarung") },
  { id: "c", difficulty: 2 as const, competencies: k("rahmen", "konkret") },
  { id: "d", difficulty: 2 as const, competencies: k("ursache", "einwand") },
  { id: "e", difficulty: 3 as const, competencies: k("konkret", "ursache") },
];

// Rubrik einer Rollenspiel-Auswertung (feedback.rubric): Schlüssel der Fähigkeit, Titel, Stufe 1–4 oder null.
const rubric: SkillRatingLike[] = [
  { key: "rahmen", label: "Rahmen setzen und Sicherheit geben", score: 3 },
  { key: "konkret", label: "Konkret bleiben", score: 2 },
  { key: "ursache", label: "Bis zur Ursache zuhören", score: 2 },
  { key: "vereinbarung", label: "Verbindlich vereinbaren", score: null }, // nicht beobachtbar
];

describe("weakestObservedC (W1-4)", () => {
  it("null-Scores zählen nie (null-statt-0-Regel)", () => {
    // C3 ist null → darf trotz »fehlendem« Wert nicht als schwächste gelten.
    const w = weakestObservedC(ratings);
    expect(w?.id).not.toBe("C3");
  });

  it("bei Gleichstand gewinnt die niedrigere C-Nummer (deterministisch)", () => {
    // C2 und C5 sind beide 2 → C2.
    expect(weakestObservedC(ratings)?.id).toBe("C2");
    // Kompetenzmodell v2 (28.08.): C2 heißt jetzt „Problemlösung und
    // Entscheidungsfindung" — der Test pinnt weiter Name-zu-id, nicht den
    // alten Wortlaut.
    expect(weakestObservedC(ratings)?.name).toContain("Problemlösung");
  });

  it("robust gegen Müll: kein Array / leere Liste / nur nulls → null", () => {
    expect(weakestObservedC(null)).toBeNull();
    expect(weakestObservedC(undefined)).toBeNull();
    expect(weakestObservedC([])).toBeNull();
    expect(weakestObservedC([{ id: "C1", score: null }])).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(weakestObservedC("kaputt" as any)).toBeNull();
  });
});

describe("weakestObservedSkill (U15, Owner-Entscheid 12.11.2026)", () => {
  it("nimmt die niedrigste beobachtete Stufe; »nicht beobachtbar« zählt nie", () => {
    const w = weakestObservedSkill([{ key: "rahmen", score: 3 }, { key: "konkret", score: 1 }, { key: "ursache", score: null }]);
    expect(w).toEqual({ key: "konkret", label: null, score: 1 });
  });

  it("bei Gleichstand gewinnt die Fähigkeit des „Größten Hebels“, sonst die frühere in der Rubrik", () => {
    // konkret und ursache stehen beide auf 2.
    expect(weakestObservedSkill(rubric)?.key).toBe("konkret");
    expect(weakestObservedSkill(rubric, "ursache")).toEqual({ key: "ursache", label: "Bis zur Ursache zuhören", score: 2 });
    // Der Hebel hebt keine stärkere Fähigkeit über eine schwächere.
    expect(weakestObservedSkill(rubric, "rahmen")?.key).toBe("konkret");
  });

  it("robust gegen Müll: kein Array / leere Liste / nur nulls / Zeilen ohne Schlüssel → null", () => {
    expect(weakestObservedSkill(null)).toBeNull();
    expect(weakestObservedSkill(undefined)).toBeNull();
    expect(weakestObservedSkill([])).toBeNull();
    expect(weakestObservedSkill([{ key: "rahmen", score: null }])).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(weakestObservedSkill([{ score: 1 } as any, null as any])).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(weakestObservedSkill("kaputt" as any)).toBeNull();
  });
});

describe("recommendScenarios (W1-4, seit U15 aus den Fähigkeiten)", () => {
  it("Szenarien, die die Fähigkeit bewerten, zuerst, stabil in Katalog-Reihenfolge, Top 3", () => {
    const r = recommendScenarios(scenarios, "ursache");
    expect(r.map((s) => s.id)).toEqual(["a", "d", "e"]);
  });

  it("das gerade gespielte Szenario steht nicht zuerst, sondern hinter den anderen Treffern", () => {
    expect(recommendScenarios(scenarios, "ursache", 3, "a").map((s) => s.id)).toEqual(["d", "e", "a"]);
    // Bewertet nur das gerade gespielte die Fähigkeit, bleibt es der einzige Treffer und steht vor dem Auffüllen.
    expect(recommendScenarios(scenarios, "einwand", 3, "d").map((s) => s.id)).toEqual(["d", "a", "b"]);
  });

  it("ohne Treffer bleibt die Katalog-Reihenfolge (kein Crash)", () => {
    const r = recommendScenarios(scenarios, "gibt-es-nicht");
    expect(r.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("Cold Start: leichteste zuerst, füllt über Stufe 1 hinaus auf 3 auf", () => {
    const r = recommendScenarios(scenarios, null);
    expect(r).toHaveLength(3);
    expect(r.map((s) => s.id)).toEqual(["a", "b", "c"]);
    // Es gibt nur 2 Stufe-1-Szenarien im echten Katalog — der Streifen darf
    // deshalb nie leer ausgehen, sondern füllt mit Stufe 2 auf.
    expect(r[2].difficulty).toBe(2);
  });

  it("verändert das Eingabe-Array nicht (pure)", () => {
    const copy = [...scenarios];
    recommendScenarios(scenarios, null);
    recommendScenarios(scenarios, "konkret", 3, "b");
    expect(scenarios).toEqual(copy);
  });
});
