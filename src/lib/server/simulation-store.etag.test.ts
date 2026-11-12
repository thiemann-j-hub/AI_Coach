import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Paket 2, C3 (12.11.2026): Speichern mit Versionsprüfung. Cosmos wird durch einen kleinen Speicher im
 * Arbeitsspeicher ersetzt, der sich wie Cosmos verhält: jede Schreibung vergibt eine neue Version, ein
 * Ersetzen mit veralteter Version scheitert mit 412.
 */
const db = vi.hoisted(() => {
  const items = new Map<string, Record<string, unknown>>();
  let version = 0;
  return {
    items,
    next: () => `v${++version}`,
    reset: () => {
      items.clear();
      version = 0;
    },
  };
});

vi.mock("@/lib/cosmos", () => ({
  runsContainer: () => ({}),
  readItem: async (_c: unknown, id: string) => {
    const hit = db.items.get(id);
    return hit ? structuredClone(hit) : null;
  },
  upsertItem: async (_c: unknown, item: { id: string }) => {
    const saved = { ...item, _etag: db.next() };
    db.items.set(item.id, structuredClone(saved));
    return saved;
  },
  replaceItemIfMatch: async (_c: unknown, item: { id: string }, _pk: string, etag: string) => {
    const current = db.items.get(item.id);
    if (!current || current._etag !== etag) throw Object.assign(new Error("precondition failed"), { code: 412 });
    const saved = { ...item, _etag: db.next() };
    db.items.set(item.id, structuredClone(saved));
    return saved;
  },
  queryItems: async () => [],
  deleteItem: async () => undefined,
}));
vi.mock("@/lib/server/radar-emit", () => ({ deleteCoachMeasurement: async () => undefined }));

import {
  SIM_DOC_TYPE,
  SimulationConflictError,
  getSimulation,
  saveSimulation,
  updateSimulation,
  type SimulationDoc,
} from "./simulation-store";

function seed(extra: Partial<SimulationDoc> = {}): void {
  const doc = {
    id: "sim-12345678",
    sessionId: "sim:u1",
    docType: SIM_DOC_TYPE,
    uid: "u1",
    scenarioId: "s1",
    createdAt: "2026-11-12T08:00:00.000Z",
    updatedAt: "2026-11-12T08:00:00.000Z",
    status: "active",
    turns: [],
    ...extra,
    _etag: db.next(),
  };
  db.items.set(doc.id, doc as unknown as Record<string, unknown>);
}

describe("Lauf speichern mit Versionsprüfung (C3)", () => {
  beforeEach(() => db.reset());

  it("zwei Kopien desselben Laufs: die zweite Schreibung scheitert, statt die erste zu überschreiben", async () => {
    seed();
    const a = (await getSimulation("u1", "sim-12345678"))!;
    const b = (await getSimulation("u1", "sim-12345678"))!;
    a.coachNotes = [{ question: "f", answer: "a", ts: "t" }];
    await saveSimulation(a);
    b.turns.push({ role: "user", text: "Hallo", ts: "t" });
    await expect(saveSimulation(b)).rejects.toBeInstanceOf(SimulationConflictError);
    const stored = (await getSimulation("u1", "sim-12345678"))!;
    expect(stored.coachNotes).toHaveLength(1);
    expect(stored.turns).toHaveLength(0);
  });

  it("dieselbe Kopie kann mehrmals nacheinander speichern (das Relais hält seine Kopie lange)", async () => {
    seed();
    const a = (await getSimulation("u1", "sim-12345678"))!;
    a.turns.push({ role: "user", text: "eins", ts: "t" });
    await saveSimulation(a);
    a.turns.push({ role: "persona", text: "zwei", ts: "t" });
    await saveSimulation(a);
    expect((await getSimulation("u1", "sim-12345678"))!.turns).toHaveLength(2);
  });

  it("updateSimulation liest nach einem Konflikt neu und behält beide Änderungen", async () => {
    seed();
    let first = true;
    const saved = await updateSimulation("u1", "sim-12345678", (doc) => {
      if (first) {
        first = false;
        // Ein zweiter Schreiber kommt dazwischen, nachdem diese Kopie gelesen wurde.
        const other = structuredClone(db.items.get("sim-12345678")!) as unknown as SimulationDoc;
        other.coachNotes = [{ question: "f", answer: "a", ts: "t" }];
        db.items.set(other.id, { ...other, _etag: db.next() } as unknown as Record<string, unknown>);
      }
      doc.turns.push({ role: "user", text: "Hallo", ts: "t" });
    });
    expect(saved?.turns).toHaveLength(1);
    expect(saved?.coachNotes).toHaveLength(1);
  });

  it("updateSimulation schreibt nichts, wenn mutate false zurückgibt, und meldet null für fremde Läufe", async () => {
    seed({ status: "finished" });
    const before = db.items.get("sim-12345678")!._etag;
    const res = await updateSimulation("u1", "sim-12345678", (doc) => (doc.status === "finished" ? false : undefined));
    expect(res?.status).toBe("finished");
    expect(db.items.get("sim-12345678")!._etag).toBe(before);
    expect(await updateSimulation("u2", "sim-12345678", () => undefined)).toBeNull();
  });
});
