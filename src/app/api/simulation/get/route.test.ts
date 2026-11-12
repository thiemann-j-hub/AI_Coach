import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Paket 4, C13 (12.11.2026): Die Wiederaufnahme liefert die Pausenfelder der Uhr mit, damit der Browser mit
 * derselben Funktion rechnet wie der Server (`gespraechsZeitMs`).
 */
const db = await vi.hoisted(async () => (await import("@/test/sim-speicher")).neuerSimSpeicher());

vi.mock("@/lib/cosmos", () => db.cosmos);
vi.mock("@/lib/server/radar-emit", () => ({ deleteCoachMeasurement: async () => undefined }));
vi.mock("@/lib/api-auth", () => ({ requireAuth: async () => ({ uid: "u1", email: "a@example.com", oid: "oid-1" }) }));
vi.mock("@/lib/logger", () => ({ logger: { api: vi.fn(), apiError: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/server/scenario-store", async () => {
  const { getScenario } = await import("@/lib/simulation/scenarios");
  return { getScenarioForUser: async () => getScenario("sim-coaching-morgan") };
});

import { GET } from "./route";

const hole = async (simId = "sim-12345678") => {
  const res = await GET(new NextRequest(`http://localhost/api/simulation/get?simId=${simId}`));
  return { status: res.status, json: await res.json() };
};

beforeEach(() => {
  process.env.SIMULATION_ENABLED = "on";
  db.reset();
});

afterEach(() => {
  delete process.env.SIMULATION_ENABLED;
});

describe("GET /api/simulation/get — Pausenfelder der Uhr", () => {
  it("ein Lauf ohne Pause meldet 0 und null", async () => {
    db.seed({ createdAt: "2026-11-12T08:00:00.000Z" });
    const { status, json } = await hole();
    expect(status).toBe(200);
    expect(json.simulation).toMatchObject({ createdAt: "2026-11-12T08:00:00.000Z", pausedMs: 0, pauseSince: null });
  });

  it("abgeschlossene und laufende Pause kommen so an, wie sie am Lauf stehen", async () => {
    db.seed({ createdAt: "2026-11-12T08:00:00.000Z", pausedMs: 95_000, pauseSince: "2026-11-12T08:07:00.000Z" });
    const { json } = await hole();
    expect(json.simulation).toMatchObject({ pausedMs: 95_000, pauseSince: "2026-11-12T08:07:00.000Z" });
    // Die Rollen-DNA bleibt auf dem Server.
    expect(json.scenario).not.toHaveProperty("personaDna");
  });

  it("unbekannter Lauf: 404", async () => {
    expect((await hole()).status).toBe(404);
  });
});

describe("GET /api/simulation/get — liveAvailable (Live-Prüfung 12.11.2026)", () => {
  afterEach(() => {
    delete process.env.COACH_LIVE;
  });

  it("Live aus: false am Lauf und am Szenario", async () => {
    db.seed();
    const { json } = await hole();
    expect(json.simulation.liveAvailable).toBe(false);
    expect(json.scenario.liveAvailable).toBe(false);
  });

  it("Live für alle: true — wie in `start` und im Katalog", async () => {
    process.env.COACH_LIVE = "all";
    db.seed();
    const { json } = await hole();
    expect(json.simulation.liveAvailable).toBe(true);
    expect(json.scenario.liveAvailable).toBe(true);
  });

  it("Live nur für einzelne Szenarien: es zählt das Szenario des Laufs", async () => {
    process.env.COACH_LIVE = "sim-anderes";
    db.seed();
    expect((await hole()).json.simulation.liveAvailable).toBe(false);
    process.env.COACH_LIVE = "sim-anderes, sim-coaching-morgan";
    expect((await hole()).json.simulation.liveAvailable).toBe(true);
  });
});
