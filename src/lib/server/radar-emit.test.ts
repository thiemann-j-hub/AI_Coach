import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  emitCoachMeasurement,
  deleteCoachMeasurement,
  radarEmitEnabled,
  io,
  type RadarContainerLike,
} from "./radar-emit";

/**
 * Radar-Emitter: Flag-Gate (off ⇒ No-Op {skipped}), Vertrags-Doc beim Emit,
 * Fail-soft (Cosmos-Fehler wirft nie in den Fachpfad), Delete 404-tolerant +
 * flag-unabhaengig (Nutzer-Loeschrecht). Cosmos wird ueber den io-Seam
 * (Muster entra-token-store) durch einen In-Memory-Fake ersetzt.
 */

const BASE = {
  workspaceId: "ws-central-1",
  subjectId: "oid-subject-1",
  runId: "run-abc",
  createdAt: "2026-03-01T08:30:00.000Z",
  competencyRatings: [{ id: "C1", score: 3 }, { id: "C2", score: 0 }],
};

let upserts: any[];
let deleteAttempts: Array<{ id: string; pk: string }>;
let upsertImpl: (doc: unknown) => Promise<unknown>;
let deleteImpl: (id: string, pk: string) => Promise<unknown>;

const origContainer = io.container;
const origFlag = process.env.RADAR_EMIT;

beforeEach(() => {
  upserts = [];
  deleteAttempts = [];
  upsertImpl = async () => ({});
  deleteImpl = async () => ({});
  const fake: RadarContainerLike = {
    items: {
      upsert: (doc: unknown) => {
        upserts.push(doc);
        return upsertImpl(doc);
      },
    },
    item: (id: string, pk: string) => ({
      delete: () => {
        deleteAttempts.push({ id, pk });
        return deleteImpl(id, pk);
      },
    }),
  };
  io.container = () => fake;
  process.env.RADAR_EMIT = "on";
});

afterEach(() => {
  io.container = origContainer;
  if (origFlag === undefined) delete process.env.RADAR_EMIT;
  else process.env.RADAR_EMIT = origFlag;
});

describe("radar-emit: Flag-Gate", () => {
  it("RADAR_EMIT!=on ⇒ No-Op {skipped}, KEIN Cosmos-Zugriff", async () => {
    process.env.RADAR_EMIT = "off";
    expect(radarEmitEnabled()).toBe(false);
    const r = await emitCoachMeasurement(BASE);
    expect(r).toEqual({ ok: true, skipped: true, reason: "flag_off" });
    expect(upserts).toHaveLength(0);

    delete process.env.RADAR_EMIT; // ungesetzt = off (INERT by default)
    const r2 = await emitCoachMeasurement(BASE);
    expect(r2).toEqual({ ok: true, skipped: true, reason: "flag_off" });
    expect(upserts).toHaveLength(0);
  });
});

describe("radar-emit: Emit (RADAR_EMIT=on)", () => {
  it("upsertet das Vertrags-Doc: id coach:{runId}, ts = createdAt (runDoc), 0 ⇒ null", async () => {
    const r = await emitCoachMeasurement(BASE);
    expect(r).toEqual({ ok: true, skipped: false });
    expect(upserts).toHaveLength(1);
    const doc = upserts[0];
    expect(doc).toMatchObject({
      id: "coach:run-abc",
      v: 1,
      type: "measurement",
      appId: "coach",
      workspaceId: BASE.workspaceId,
      subjectId: BASE.subjectId,
      ts: BASE.createdAt, // ts IMMER = runDoc.createdAt, nie Date.now
      runId: BASE.runId,
      scale: { min: 1, max: 4 },
    });
    expect(doc.metrics.C1).toBe(3);
    expect(doc.metrics.C2).toBeNull(); // score 0 ⇒ nicht beobachtbar
    expect(doc.metrics.overall).toBe(3); // Mittel NUR der beobachtbaren
  });

  it("fehlende subjectId (keine oid) ⇒ skip invalid_input, kein Upsert", async () => {
    const r = await emitCoachMeasurement({ ...BASE, subjectId: "" });
    expect(r).toEqual({ ok: true, skipped: true, reason: "invalid_input" });
    expect(upserts).toHaveLength(0);
  });

  it("keine beobachtbaren Werte ⇒ skip (kein Leer-Event)", async () => {
    const r = await emitCoachMeasurement({
      ...BASE,
      competencyRatings: [{ id: "C1", score: 0 }, { id: "C2", score: null }],
    });
    expect(r).toEqual({ ok: true, skipped: true, reason: "no_observable_metrics" });
    expect(upserts).toHaveLength(0);
  });

  it("fail-soft: Cosmos-Upsert wirft ⇒ {ok:false}, wirft NIE in den Fachpfad", async () => {
    upsertImpl = async () => {
      throw new Error("cosmos down");
    };
    await expect(emitCoachMeasurement(BASE)).resolves.toEqual({ ok: false });
  });
});

describe("radar-emit: Delete-Konsistenz (Analyse löschen = Messpunkt löschen)", () => {
  it("loescht coach:{runId} in jeder Kandidaten-Partition (dedupe, null/leer gefiltert)", async () => {
    const r = await deleteCoachMeasurement("run-abc", [
      "ws-central-1",
      "ws-central-1", // Duplikat
      null,
      undefined,
      "",
      "owner-oid-1",
    ]);
    expect(deleteAttempts).toEqual([
      { id: "coach:run-abc", pk: "ws-central-1" },
      { id: "coach:run-abc", pk: "owner-oid-1" },
    ]);
    expect(r.deleted).toBe(2);
  });

  it("404-tolerant: fehlendes Doc ist der Normalfall und wirft nicht", async () => {
    deleteImpl = async (_id, pk) => {
      if (pk === "ws-a") {
        const err = new Error("NotFound") as Error & { code?: number };
        err.code = 404;
        throw err;
      }
      return {};
    };
    const r = await deleteCoachMeasurement("run-abc", ["ws-a", "ws-b"]);
    expect(r.deleted).toBe(1); // ws-a 404 (ok), ws-b geloescht
    expect(deleteAttempts).toHaveLength(2);
  });

  it("fail-soft: anderer Cosmos-Fehler wird geloggt und geschluckt (wirft NIE)", async () => {
    deleteImpl = async () => {
      throw new Error("cosmos down");
    };
    await expect(
      deleteCoachMeasurement("run-abc", ["ws-a"])
    ).resolves.toEqual({ deleted: 0 });
  });

  it("laeuft auch bei RADAR_EMIT=off (Loeschrecht ist NICHT flag-gated)", async () => {
    process.env.RADAR_EMIT = "off";
    const r = await deleteCoachMeasurement("run-abc", ["ws-a"]);
    expect(deleteAttempts).toEqual([{ id: "coach:run-abc", pk: "ws-a" }]);
    expect(r.deleted).toBe(1);
  });
});
