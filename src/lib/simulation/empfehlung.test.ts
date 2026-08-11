import { describe, expect, it } from "vitest";
import { recommendScenarios, weakestObservedC, type RatingLike } from "./empfehlung";

const ratings: RatingLike[] = [
  { id: "C1", name: "Integrieren und Verbinden", score: 3 },
  { id: "C2", name: "Klarheit und Entscheidungsstärke", score: 2 },
  { id: "C3", name: "Befähigen und Entwickeln", score: null }, // nicht beobachtbar
  { id: "C5", name: "Kommunikation und Kooperation", score: 2 },
];

const scenarios = [
  { id: "a", difficulty: 1 as const, competencyFocus: ["C3", "C2"] },
  { id: "b", difficulty: 1 as const, competencyFocus: ["C5", "C4"] },
  { id: "c", difficulty: 2 as const, competencyFocus: ["C1", "C5"] },
  { id: "d", difficulty: 2 as const, competencyFocus: ["C2", "C6"] },
  { id: "e", difficulty: 3 as const, competencyFocus: ["C5", "C2"] },
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
    expect(weakestObservedC(ratings)?.name).toContain("Klarheit");
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

describe("recommendScenarios (W1-4)", () => {
  it("Fokus-Treffer zuerst, stabil in Katalog-Reihenfolge, Top 3", () => {
    const r = recommendScenarios(scenarios, "C2");
    expect(r.map((s) => s.id)).toEqual(["a", "d", "e"]);
  });

  it("ohne Treffer bleibt die Katalog-Reihenfolge (kein Crash)", () => {
    const r = recommendScenarios(scenarios, "C10");
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
    recommendScenarios(scenarios, "C5");
    expect(scenarios).toEqual(copy);
  });
});
