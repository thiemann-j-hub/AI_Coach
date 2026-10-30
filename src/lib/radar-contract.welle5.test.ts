import { describe, expect, it } from "vitest";
import { buildCoachMeasurementDoc, faehigkeitenFromRubric } from "./radar-contract";

describe("Welle 5 — Anker je Fähigkeit im Radar-Messpunkt (additiv)", () => {
  it("bringt die Anker-Rubrik in die Radar-Form (Stufe 0/null → null, Gewicht Standard 1)", () => {
    expect(
      faehigkeitenFromRubric([
        { key: "rahmen", label: "Rahmen", score: 3, weight: 15 },
        { key: "ursache", label: "Ursache", score: null, weight: 25 },
        { key: "konkret", label: "Konkret", score: 0 },
        { key: "", score: 2 },
      ])
    ).toEqual([
      { id: "rahmen", stufe: 3, gewicht: 15 },
      { id: "ursache", stufe: null, gewicht: 25 },
      { id: "konkret", stufe: null, gewicht: 1 },
    ]);
    expect(faehigkeitenFromRubric(undefined)).toBeUndefined();
    expect(faehigkeitenFromRubric([])).toBeUndefined();
  });

  it("schreibt Fähigkeiten, Szenario und Urteil nur, wenn sie da sind — Alt-Form bleibt gleich", () => {
    const base = {
      workspaceId: "ws-1",
      subjectId: "oid-1",
      runId: "run-1",
      createdAt: "2026-10-30T10:00:00.000Z",
      competencyRatings: [{ id: "C1", score: 3 }],
    };
    const alt = buildCoachMeasurementDoc(base)!;
    expect(alt).not.toHaveProperty("faehigkeiten");
    expect(alt).not.toHaveProperty("szenarioId");
    expect(alt).not.toHaveProperty("bestanden");
    const neu = buildCoachMeasurementDoc({
      ...base,
      rubric: [{ key: "rahmen", score: 4, weight: 20 }],
      szenarioId: "sim-coaching-morgan",
      bestanden: true,
    })!;
    expect(neu.faehigkeiten).toEqual([{ id: "rahmen", stufe: 4, gewicht: 20 }]);
    expect(neu.szenarioId).toBe("sim-coaching-morgan");
    expect(neu.bestanden).toBe(true);
    expect(buildCoachMeasurementDoc({ ...base, bestanden: null })).not.toHaveProperty("bestanden");
  });
});
