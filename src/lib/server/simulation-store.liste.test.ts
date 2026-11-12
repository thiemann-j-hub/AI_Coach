import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Paket 6, C22 (12.11.2026): Die Listen-Abfrage zählt die Züge selbst (`ARRAY_LENGTH`) und holt vom Debrief nur
 * Gesamtwert und Urteil. Vorher kamen je Lauf das ganze Gespräch und der ganze Debrief mit (bis 100 Läufe).
 */
const h = vi.hoisted(() => ({ rows: [] as unknown[], queries: [] as Array<{ query: string; params: Array<{ name: string; value: unknown }> }> }));

vi.mock("@/lib/cosmos", () => ({
  runsContainer: () => ({}),
  queryItems: async (_c: unknown, query: string, params: Array<{ name: string; value: unknown }>) => {
    h.queries.push({ query, params });
    return h.rows;
  },
  readItem: async () => null,
  upsertItem: async (_c: unknown, item: unknown) => item,
  replaceItemIfMatch: async (_c: unknown, item: unknown) => item,
  deleteItem: async () => undefined,
}));
vi.mock("@/lib/server/radar-emit", () => ({ deleteCoachMeasurement: async () => undefined }));
vi.mock("server-only", () => ({}));

import { listSimulations } from "./simulation-store";

beforeEach(() => {
  h.rows = [];
  h.queries.length = 0;
});

describe("listSimulations (C22)", () => {
  it("zählt die Züge in der Abfrage und lädt weder Gespräche noch den ganzen Debrief", async () => {
    await listSimulations("u1", 100);
    const { query, params } = h.queries[0];
    expect(query).toContain("ARRAY_LENGTH(c.turns) AS turnCount");
    expect(query).toContain("c.debriefJson.overall AS overall");
    expect(query).toContain("c.debriefJson.verdict AS verdict");
    expect(query).not.toMatch(/c\.turns\s*,/);
    expect(query).not.toMatch(/c\.debriefJson\s*(,|FROM)/);
    expect(query).not.toMatch(/SELECT\s+\*/);
    // Unverändert: eigene Partition, abgebrochene Läufe fehlen, neueste zuerst, Obergrenze.
    expect(query).toContain("c.sessionId = @pk");
    expect(query).toContain("c.status != 'aborted'");
    expect(query).toContain("ORDER BY c.createdAt DESC");
    expect(params).toEqual([
      { name: "@pk", value: "sim:u1" },
      { name: "@dt", value: "simulation" },
      { name: "@limit", value: 100 },
    ]);
  });

  it("liefert dieselbe Form wie bisher", async () => {
    h.rows = [
      { id: "a", scenarioId: "sim-coaching-morgan", status: "finished", createdAt: "c1", updatedAt: "u1", turnCount: 9, attempt: 2, overall: 73, verdict: "passed" },
      // Aktiver Lauf ohne Debrief; Altbestand ohne Versuchsnummer.
      { id: "b", scenarioId: "ws-1", status: "active", createdAt: "c2", updatedAt: "u2", turnCount: 1 },
      // Lauf ohne Züge-Feld: Die Abfrage liefert dann keine Zahl.
      { id: "c", scenarioId: "ws-1", status: "finishing", createdAt: "c3", updatedAt: "u3", verdict: "kaputt", overall: null },
    ];
    expect(await listSimulations("u1")).toEqual([
      { id: "a", scenarioId: "sim-coaching-morgan", status: "finished", createdAt: "c1", updatedAt: "u1", turnCount: 9, attempt: 2, overall: 73, verdict: "passed" },
      { id: "b", scenarioId: "ws-1", status: "active", createdAt: "c2", updatedAt: "u2", turnCount: 1, attempt: 1, overall: null, verdict: null },
      { id: "c", scenarioId: "ws-1", status: "finishing", createdAt: "c3", updatedAt: "u3", turnCount: 0, attempt: 1, overall: null, verdict: null },
    ]);
  });
});
