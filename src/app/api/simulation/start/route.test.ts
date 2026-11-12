import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Paket 1 (12.11.2026): Start. C29 — die Tagesgrenze greift, BEVOR eine KI läuft (vorher wurde bei abweichender
 * Gesprächssprache erst die Eröffnung erzeugt und das Tagesbudget belastet). C5 — Begrenzung je Person. Dazu die
 * Antwort der Tagesgrenze: 429 mit Satz in Du-Form und Code, weil die Oberfläche Server-Sätze anzeigt.
 */
const h = vi.hoisted(() => ({
  rateKeys: [] as string[],
  startedToday: vi.fn(),
  createSimulation: vi.fn(),
  runPersonaOpening: vi.fn(),
  budget: vi.fn(),
  logApi: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({ requireAuth: async () => ({ uid: "u1", email: "a@example.com", oid: "oid-1" }) }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (key: string) => {
    h.rateKeys.push(key);
    return null;
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { api: h.logApi, apiError: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
// Die Tagesgrenze selbst (Zahl, Vergleich, Antwort) bleibt echt; nur das Token-Budget ist ersetzt.
vi.mock("@/lib/server/cost-cap", async (original) => ({
  ...(await original<typeof import("@/lib/server/cost-cap")>()),
  checkAndConsumeBudget: (...a: unknown[]) => h.budget(...a),
}));
vi.mock("@/lib/server/credits/entitlement", () => ({ preflightEntitlement: async () => null }));
vi.mock("@/lib/server/scenario-store", async () => {
  const { getScenario } = await import("@/lib/simulation/scenarios");
  return { getScenarioForUser: async () => getScenario("sim-coaching-morgan"), hasOpenFreeTestEval: async () => false };
});
vi.mock("@/lib/server/simulation-store", () => ({
  countFinishedForScenario: async () => 0,
  countSimulationsStartedToday: (...a: unknown[]) => h.startedToday(...a),
  createSimulation: (...a: unknown[]) => h.createSimulation(...a),
}));
vi.mock("@/ai/flows/simulation-persona", () => ({ runPersonaOpening: (...a: unknown[]) => h.runPersonaOpening(...a) }));

import { POST } from "./route";

const start = (body: Record<string, unknown> = {}) =>
  POST(new NextRequest("http://localhost/api/simulation/start", { method: "POST", body: JSON.stringify({ scenarioId: "sim-coaching-morgan", ...body }), headers: { "content-type": "application/json" } }));

beforeEach(() => {
  process.env.SIMULATION_ENABLED = "on";
  delete process.env.COACH_SIM_STARTS_PER_DAY;
  delete process.env.ADMIN_EMAILS;
  delete process.env.COACH_LIVE;
  h.rateKeys.length = 0;
  for (const m of [h.startedToday, h.createSimulation, h.runPersonaOpening, h.budget, h.logApi]) m.mockReset();
  h.startedToday.mockResolvedValue(0);
  h.budget.mockResolvedValue({ allowed: true });
  h.runPersonaOpening.mockResolvedValue("Hi, you wanted to see me?");
  h.createSimulation.mockImplementation(async (a: { simId: string; scenarioId: string; openingTurn: unknown }) => ({
    id: a.simId,
    scenarioId: a.scenarioId,
    status: "active",
    turns: [a.openingTurn],
    createdAt: "2026-11-12T08:00:00.000Z",
  }));
});

afterEach(() => {
  delete process.env.SIMULATION_ENABLED;
  delete process.env.COACH_LIVE;
});

describe("Start /api/simulation/start", () => {
  it("Tagesgrenze erreicht: 429 mit Satz und Code, und es lief KEINE KI und kein Budget (C29)", async () => {
    h.startedToday.mockResolvedValue(6);
    // Englisch weicht von der Autorensprache ab: ohne die Grenze würde jetzt die Eröffnung erzeugt.
    const res = await start({ locale: "en" });
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.code).toBe("QUOTA_EXCEEDED");
    expect(json.error).toContain("6 Rollenspiele");
    expect(json.error).toContain("Du");
    expect(json.error).not.toMatch(/\bSie\b/);
    expect(h.runPersonaOpening).not.toHaveBeenCalled();
    expect(h.budget).not.toHaveBeenCalled();
    expect(h.createSimulation).not.toHaveBeenCalled();
  });

  it("unter der Grenze, andere Gesprächssprache: die Rolle eröffnet in dieser Sprache", async () => {
    h.startedToday.mockResolvedValue(5);
    const res = await start({ locale: "en" });
    expect(res.status).toBe(200);
    expect((await res.json()).simulation.turns[0].text).toBe("Hi, you wanted to see me?");
    expect(h.runPersonaOpening).toHaveBeenCalledTimes(1);
  });

  it("Autorensprache: fester Eröffnungssatz, keine KI", async () => {
    const res = await start();
    expect(res.status).toBe(200);
    expect(h.runPersonaOpening).not.toHaveBeenCalled();
    expect(h.createSimulation).toHaveBeenCalledTimes(1);
  });

  it("begrenzt je angemeldeter Person, nicht je Adresse (C5)", async () => {
    await start();
    expect(h.rateKeys).toEqual(["sim-start:u1"]);
  });
});

describe("Start: Sprechen nach vorn (Paket 4)", () => {
  const trichter = () => h.logApi.mock.calls.filter((c) => c[0] === "/api/simulation/trichter");

  it("S24: schreibt den Zählpunkt start mit dem gewählten Weg; der Weg steht nicht am Lauf", async () => {
    const res = await start({ weg: "sprechen" });
    expect(res.status).toBe(200);
    expect(trichter()).toEqual([["/api/simulation/trichter", "start", { scenarioId: "sim-coaching-morgan", weg: "sprechen" }]]);
    expect(h.createSimulation.mock.calls[0][0]).not.toHaveProperty("weg");
  });

  it("Mikrofon-Check: Start mit „Sprechen“ beginnt mit angehaltener Uhr, Start mit „Schreiben“ nicht", async () => {
    await start({ weg: "sprechen" });
    expect(typeof h.createSimulation.mock.calls[0][0].pauseSince).toBe("string");
    await start({ weg: "schreiben" });
    expect(h.createSimulation.mock.calls[1][0]).not.toHaveProperty("pauseSince");
  });

  it("ohne Weg (alter Client) fehlt das Feld; ein unbekannter Weg wird abgelehnt", async () => {
    await start();
    expect(trichter()).toEqual([["/api/simulation/trichter", "start", { scenarioId: "sim-coaching-morgan" }]]);
    expect((await start({ weg: "singen" })).status).toBe(400);
  });

  it("ein abgewiesener Start zählt nicht", async () => {
    h.startedToday.mockResolvedValue(6);
    expect((await start({ weg: "sprechen" })).status).toBe(429);
    expect(trichter()).toEqual([]);
  });

  it("C13 und liveAvailable: die Antwort trägt die Pausenfelder der Uhr und sagt, ob Sprechen geht", async () => {
    let json = await (await start()).json();
    expect(json.simulation).toMatchObject({ createdAt: "2026-11-12T08:00:00.000Z", pausedMs: 0, pauseSince: null, liveAvailable: false });

    process.env.COACH_LIVE = "sim-coaching-morgan,ws-anderes";
    json = await (await start()).json();
    expect(json.simulation.liveAvailable).toBe(true);

    process.env.COACH_LIVE = "ws-anderes";
    json = await (await start()).json();
    expect(json.simulation.liveAvailable).toBe(false);
  });
});
