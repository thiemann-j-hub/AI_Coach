import { describe, expect, it } from "vitest";
import { bestByScenario, catalogOrder } from "./katalog";

describe("bestByScenario (U21: „schon gespielt“ mit bestem Ergebnis)", () => {
  it("nimmt je Szenario das beste Ergebnis und zählt die abgeschlossenen Läufe", () => {
    expect(
      bestByScenario([
        { scenarioId: "sim-a", overall: 58 },
        { scenarioId: "sim-b", overall: 81 },
        { scenarioId: "sim-a", overall: 73 },
        { scenarioId: "sim-a", overall: 64.6 },
      ])
    ).toEqual({ "sim-a": { best: 73, count: 3 }, "sim-b": { best: 81, count: 1 } });
  });

  it("Lauf ohne Punktzahl (Altbestand, nicht bewertbar): gespielt, aber ohne Prozent", () => {
    expect(bestByScenario([{ scenarioId: "sim-a" }, { scenarioId: "sim-a", overall: null }])).toEqual({
      "sim-a": { best: null, count: 2 },
    });
    // Eine spätere Punktzahl gilt, 0 % ist ein Ergebnis.
    expect(bestByScenario([{ scenarioId: "sim-a" }, { scenarioId: "sim-a", overall: 0 }])).toEqual({
      "sim-a": { best: 0, count: 2 },
    });
  });

  it("robust gegen Müll: keine Liste, Zeilen ohne Szenario, Text statt Zahl", () => {
    expect(bestByScenario(null)).toEqual({});
    expect(bestByScenario(undefined)).toEqual({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(bestByScenario([null as any, {}, { scenarioId: 7, overall: 50 }, { scenarioId: "sim-a", overall: "73" }])).toEqual({
      "sim-a": { best: null, count: 1 },
    });
  });
});

describe("catalogOrder (U21: Reihenfolge nach Stufe, nichts doppelt)", () => {
  const liste = [
    { id: "a", difficulty: 2 },
    { id: "b", difficulty: 1 },
    { id: "c", difficulty: 3 },
    { id: "d", difficulty: 1 },
    { id: "e", difficulty: 2 },
  ];

  it("ordnet nach Stufe 1, 2, 3 und lässt die Reihenfolge innerhalb der Stufe wie bisher", () => {
    expect(catalogOrder(liste).map((s) => s.id)).toEqual(["b", "d", "a", "e", "c"]);
  });

  it("Szenarien, die schon als Empfehlung darüber stehen, kommen in der Liste nicht noch einmal vor", () => {
    expect(catalogOrder(liste, [{ id: "d" }, { id: "a" }]).map((s) => s.id)).toEqual(["b", "e", "c"]);
  });

  it("verändert die Eingabe nicht (pure)", () => {
    const copy = [...liste];
    catalogOrder(liste, [{ id: "b" }]);
    expect(liste).toEqual(copy);
  });
});
