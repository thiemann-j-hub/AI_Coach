import { describe, it, expect } from "vitest";
import {
  metricsFromCompetencyRatings,
  buildCoachMeasurementDoc,
  coachMeasurementDocId,
  RADAR_CONTRACT_VERSION,
} from "./radar-contract";

/**
 * Beweist die GELOCKTEN Mapping-Regeln des Radar-Vertrags (Hub-SSOT):
 * 0/null ⇒ null (nicht 0), overall = Mittel der beobachtbaren Werte
 * (1 Nachkommastelle), ts = runDoc.createdAt, Leer-Events werden verworfen.
 */

const rating = (id: string, score: number | null) => ({
  id,
  name: id,
  score,
  confidence: null,
  why: "",
  evidence: [] as string[],
});

describe("radar-contract: Metrik-Mapping (gelockte Regeln)", () => {
  it("score 0 und null ⇒ null (nicht beobachtbar, NICHT 0); fehlende Dimension ⇒ null", () => {
    const m = metricsFromCompetencyRatings([
      rating("C1", 0),
      rating("C2", null),
      rating("C3", 3),
    ]);
    expect(m.C1).toBeNull();
    expect(m.C2).toBeNull();
    expect(m.C3).toBe(3);
    expect(m.C4).toBeNull(); // im Lauf gar nicht enthalten
  });

  it("overall = arithmetisches Mittel NUR der beobachtbaren Werte (0/null zaehlen nicht als 0)", () => {
    const m = metricsFromCompetencyRatings([
      rating("C1", 3),
      rating("C2", 2),
      rating("C3", 0),
      rating("C4", null),
    ]);
    // (3+2)/2 = 2.5 — NICHT (3+2+0)/3
    expect(m.overall).toBe(2.5);
  });

  it("overall wird auf 1 Nachkommastelle gerundet (3,3,2 → 2.7)", () => {
    const m = metricsFromCompetencyRatings([
      rating("C1", 3),
      rating("C2", 3),
      rating("C3", 2),
    ]);
    expect(m.overall).toBe(2.7); // 8/3 = 2.666… → 2.7
  });

  it("alle Werte unbeobachtbar ⇒ overall null und KEIN Doc (Leer-Event wird nicht emittiert)", () => {
    const ratings = [rating("C1", 0), rating("C2", null)];
    expect(metricsFromCompetencyRatings(ratings).overall).toBeNull();
    expect(
      buildCoachMeasurementDoc({
        workspaceId: "ws-1",
        subjectId: "oid-1",
        runId: "run-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        competencyRatings: ratings,
      })
    ).toBeNull();
  });

  it("ts = runDoc.createdAt (NIE Date.now) + Vertragsfelder exakt nach Hub-SSOT", () => {
    const createdAt = "2025-11-03T09:15:00.000Z";
    const doc = buildCoachMeasurementDoc({
      workspaceId: "ws-1",
      subjectId: "oid-1",
      runId: "run-1",
      createdAt,
      competencyRatings: [rating("C1", 4), rating("C9", 2)],
    });
    expect(doc).not.toBeNull();
    expect(doc!.ts).toBe(createdAt); // Zeitstabilitaet (Hub „Riss 4")
    expect(doc).toMatchObject({
      id: "coach:run-1",
      v: RADAR_CONTRACT_VERSION,
      type: "measurement",
      appId: "coach",
      workspaceId: "ws-1",
      subjectId: "oid-1",
      runId: "run-1",
      scale: { min: 1, max: 4 },
    });
    expect(doc!.metrics.C1).toBe(4);
    expect(doc!.metrics.C9).toBe(2);
    expect(doc!.metrics.overall).toBe(3); // (4+2)/2
  });

  it("fehlende Pflichtfelder ⇒ kein Doc; unbrauchbare ratings-Formen werfen nie", () => {
    expect(
      buildCoachMeasurementDoc({
        workspaceId: "",
        subjectId: "oid-1",
        runId: "run-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        competencyRatings: [rating("C1", 3)],
      })
    ).toBeNull();
    expect(metricsFromCompetencyRatings(undefined).overall).toBeNull();
    expect(metricsFromCompetencyRatings("kaputt").overall).toBeNull();
    expect(metricsFromCompetencyRatings([{ id: "X9", score: 3 }]).C1).toBeNull();
    expect(coachMeasurementDocId("abc")).toBe("coach:abc");
  });
});
