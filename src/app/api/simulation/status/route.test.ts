import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SimulationDoc } from "@/lib/server/simulation-store";

/**
 * GET /api/simulation/status (Paket 3, C4 / U12, 12.11.2026): Antwortformat für die Warteansicht und wann der
 * Aufräumer greift. Hier ist nur die Rückstellung (`revertFinish`) ersetzt — der Test sieht, WAS der Aufräumer
 * zurückgeben will. Der Geldweg dahinter (Rückbuchung genau einmal, Zähler, Vermerk) läuft echt in
 * ../finish/route.test.ts.
 */
const SIM = "sim-abcdefgh";
const KEY0 = `sim-finish:${SIM}:0`;

const store = new Map<string, SimulationDoc>();
let lesefehler = false;
vi.mock("@/lib/server/simulation-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/simulation-store")>()),
  getSimulation: async (uid: string, simId: string) => {
    if (lesefehler) throw new Error("Speicher nicht erreichbar");
    const d = store.get(simId);
    return d && d.uid === uid ? (JSON.parse(JSON.stringify(d)) as SimulationDoc) : null;
  },
}));
const revert = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/lib/server/simulation-finish", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/simulation-finish")>()),
  revertFinish: (...a: unknown[]) => revert(...a),
}));
vi.mock("@/ai/flows/simulation-feedback", () => ({ RICHTER_OPUS_TIMEOUT_MS: 110_000, judgeSimulation: vi.fn() }));
vi.mock("@/ai/flows/simulation-selfreview", () => ({ CHECKIN_MAX_CHARS: 400, generateSelfReview: vi.fn() }));
vi.mock("@/ai/flows/score-competencies", () => ({ scoreCompetencies: vi.fn() }));
vi.mock("@/ai/flows/simulation-regie", () => ({ regieVerlaufText: () => "" }));
vi.mock("@/lib/server/credits/entitlement", () => ({ compensateEntitlement: vi.fn(), reserveEntitlement: vi.fn(), settleEntitlement: vi.fn() }));
vi.mock("@/lib/api-auth", () => ({ requireAuth: async () => ({ uid: "u1", email: "a@example.com", oid: "oid-1" }) }));
const log = vi.hoisted(() => ({ api: vi.fn(), apiError: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: log }));

import { GET } from "./route";

const vor = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
function lauf(over: Partial<SimulationDoc> = {}): SimulationDoc {
  return {
    id: SIM,
    sessionId: "sim:u1",
    docType: "simulation",
    uid: "u1",
    scenarioId: "sc-1",
    createdAt: "2026-11-12T10:00:00.000Z",
    updatedAt: "2026-11-12T10:00:00.000Z",
    status: "active",
    turns: [],
    ...over,
  };
}
const status = (simId = SIM) => GET(new NextRequest(`http://localhost/api/simulation/status?simId=${simId}`));

beforeEach(() => {
  process.env.SIMULATION_ENABLED = "on";
  delete process.env.COACH_RICHTER;
  store.clear();
  store.set(SIM, lauf());
  lesefehler = false;
  revert.mockClear();
  for (const m of Object.values(log)) m.mockClear();
});

describe("GET /api/simulation/status — Antwortformat", () => {
  it("aktiver Lauf: Status, kein Fehlschlag, kein Beginn, erwartete Dauer vom Server", async () => {
    const res = await status();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "active", finishError: null, startedAt: null, typicalMs: 20_000 });
    expect(revert).not.toHaveBeenCalled();
  });

  it("Auswertung läuft: Beginn der Rechnung; mit dem starken Richter rund 50 s", async () => {
    const since = vor(0.5);
    store.set(SIM, lauf({ status: "finishing", finishing: { since } }));
    expect(await (await status()).json()).toEqual({ ok: true, status: "finishing", finishError: null, startedAt: since, typicalMs: 20_000 });
    process.env.COACH_RICHTER = "opus";
    expect((await (await status()).json()).typicalMs).toBe(50_000);
    expect(revert).not.toHaveBeenCalled();
  });

  it("letzter Fehlschlag wird durchgereicht; fertige und abgebrochene Läufe nennen nur ihren Status", async () => {
    const finishError = { code: "timeout", requestId: "rid-test-01", at: vor(1) };
    store.set(SIM, lauf({ finishError }));
    expect(await (await status()).json()).toMatchObject({ status: "active", finishError });
    store.set(SIM, lauf({ status: "finished", finishing: null, finishError: null }));
    expect(await (await status()).json()).toMatchObject({ status: "finished", finishError: null, startedAt: null });
    store.set(SIM, lauf({ status: "aborted" }));
    expect((await (await status()).json()).status).toBe("aborted");
  });

  it("ungültige Kennung 400, fremder oder unbekannter Lauf 404, Lesefehler 500, ausgeschaltet 503", async () => {
    expect((await status("x")).status).toBe(400);
    expect((await status("sim-unbekannt")).status).toBe(404);
    store.set(SIM, lauf({ uid: "u2" }));
    expect((await status()).status).toBe(404);
    lesefehler = true;
    expect((await status()).status).toBe(500);
    process.env.SIMULATION_ENABLED = "off";
    expect((await status()).status).toBe(503);
  });
});

describe("GET /api/simulation/status — Aufräumer", () => {
  it("hängt der Lauf länger als 6 Minuten, wird mit den Angaben vom Lauf zurückgestellt: Buchung aus dem Vermerk, Grund STALE", async () => {
    const since = vor(7);
    store.set(SIM, lauf({ status: "finishing", finishing: { since }, chargeRefunds: 0, openCharge: { key: KEY0, at: since, txId: "tx-1", workspaceId: "ws-1" } }));
    await status();
    expect(revert).toHaveBeenCalledTimes(1);
    expect(revert.mock.calls[0][0]).toEqual({
      uid: "u1",
      oid: "oid-1",
      simId: SIM,
      since,
      scenarioId: "sc-1",
      grant: { runId: KEY0, workspaceId: "ws-1", held: true, central: true, centralTxId: "tx-1" },
      refunds: 0,
      free: false,
      error: { code: "STALE" },
    });
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("jünger als 6 Minuten: nichts wird angefasst", async () => {
    store.set(SIM, lauf({ status: "finishing", finishing: { since: vor(5) }, openCharge: { key: KEY0, at: vor(5), txId: "tx-1" } }));
    await status();
    expect(revert).not.toHaveBeenCalled();
  });

  it("Vermerk ohne Buchungsnummer oder von einem früheren Versuch: keine Rückbuchung, nur der Status; freier Testlauf wird gemeldet", async () => {
    const since = vor(7);
    store.set(SIM, lauf({ status: "finishing", finishing: { since }, openCharge: { key: KEY0, at: since } }));
    await status();
    expect(revert.mock.calls[0][0]).toMatchObject({ grant: null, refunds: 0, free: false });

    // Zähler steht auf 1, der Vermerk gehört noch zur Kennung :0 — diese Buchung ist schon zurück.
    store.set(SIM, lauf({ status: "finishing", finishing: { since }, chargeRefunds: 1, openCharge: { key: KEY0, at: since, txId: "tx-1" } }));
    await status();
    expect(revert.mock.calls[1][0]).toMatchObject({ grant: null, refunds: 1 });

    store.set(SIM, lauf({ status: "finishing", finishing: { since }, freeTestEval: true }));
    await status();
    expect(revert.mock.calls[2][0]).toMatchObject({ grant: null, free: true, error: { code: "STALE" } });
  });
});
