import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Cosmos-Seam mocken -> kein echter Write; upsertItem ist ein Spy.
const upsertItem = vi.fn(async (_c: unknown, doc: unknown) => doc);
vi.mock("@/lib/cosmos", () => ({
  radarEventsContainer: () => ({}),
  upsertItem: (...a: unknown[]) => upsertItem(...a),
}));

import { buildMetrics, emitCoachMeasurement } from "./radar-emit";

const CREATED = "2026-02-15T18:58:59.000Z"; // historisches createdAt
const base = {
  workspaceId: "ws-1",
  subjectId: "oid-1",
  runId: "run-1",
  createdAt: CREATED,
  competency_ratings: [
    { id: "C1", score: 3 },
    { id: "C2", score: null },
    { id: "C10", score: 4 },
  ],
  scoreOverall: 2.8,
};

beforeEach(() => {
  upsertItem.mockClear();
  process.env.RADAR_EMIT_ENABLED = "on";
});
afterEach(() => {
  delete process.env.RADAR_EMIT_ENABLED;
});

describe("buildMetrics", () => {
  it("nicht beobachtbare Kompetenzen = null (NICHT 0), vorhandene = Zahl", () => {
    const m = buildMetrics(base.competency_ratings, 2.8);
    expect(m.C1).toBe(3);
    expect(m.C2).toBeNull();
    expect(m.C3).toBeNull(); // gar nicht geliefert -> null
    expect(m.C10).toBe(4);
  });
  it("overall = scoreOverall wenn 1..4", () => {
    expect(buildMetrics(base.competency_ratings, 2.8).overall).toBe(2.8);
  });
  it("overall faellt auf Mittelwert zurueck, wenn scoreOverall ausserhalb 1..4 (alte 0..10-Scores)", () => {
    // vorhandene C-Scores: 3 und 4 -> Mittel 3.5
    expect(buildMetrics(base.competency_ratings, 9).overall).toBe(3.5);
  });
  it("overall = mean wenn scoreOverall null", () => {
    expect(buildMetrics(base.competency_ratings, null).overall).toBe(3.5);
  });
});

describe("emitCoachMeasurement", () => {
  it("DARK by default: RADAR_EMIT_ENABLED != on -> false, KEIN Write", async () => {
    process.env.RADAR_EMIT_ENABLED = "off";
    expect(await emitCoachMeasurement(base)).toBe(false);
    expect(upsertItem).not.toHaveBeenCalled();
  });

  it("Happy Path: schreibt EIN measurement-Doc mit ts == createdAt (NICHT Date.now)", async () => {
    const before = Date.now();
    expect(await emitCoachMeasurement(base)).toBe(true);
    expect(upsertItem).toHaveBeenCalledTimes(1);
    const doc: any = upsertItem.mock.calls[0][1];
    expect(doc.id).toBe("coach:run-1");
    expect(doc.type).toBe("measurement"); // Pflicht (Hub filtert darauf)
    expect(doc.appId).toBe("coach");
    expect(doc.v).toBe(1);
    expect(doc.scale).toEqual({ min: 1, max: 4 });
    expect(doc.subjectId).toBe("oid-1");
    expect(doc.workspaceId).toBe("ws-1");
    expect(doc.runId).toBe("run-1");
    expect(doc.sourceRunId).toBe("run-1");
    // HARTE REGEL 1: ts ist exakt das uebergebene createdAt, KEIN frischer Timestamp
    expect(doc.ts).toBe(CREATED);
    expect(new Date(doc.ts).getTime()).toBeLessThan(before);
    expect(doc.metrics.C1).toBe(3);
    expect(doc.metrics.C2).toBeNull();
    expect(doc.metrics.overall).toBe(2.8);
  });

  it("kein numerischer Wert -> false, KEIN Write", async () => {
    expect(await emitCoachMeasurement({ ...base, competency_ratings: [], scoreOverall: null })).toBe(false);
    expect(upsertItem).not.toHaveBeenCalled();
  });

  it("fehlende Pflichtfelder (createdAt/subjectId/workspaceId/runId) -> false", async () => {
    expect(await emitCoachMeasurement({ ...base, createdAt: null })).toBe(false);
    expect(await emitCoachMeasurement({ ...base, subjectId: null })).toBe(false);
    expect(await emitCoachMeasurement({ ...base, workspaceId: null })).toBe(false);
    expect(await emitCoachMeasurement({ ...base, runId: null })).toBe(false);
    expect(upsertItem).not.toHaveBeenCalled();
  });

  it("fail-soft: upsert wirft -> false (kein Throw, kein Umwerfen von /api/analyze)", async () => {
    upsertItem.mockRejectedValueOnce(new Error("cosmos down"));
    expect(await emitCoachMeasurement(base)).toBe(false);
  });
});
