import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Paket 4, S24 (12.11.2026): Zählpunkte aus dem Browser. Genau eine Protokollzeile je Schritt, derselbe
 * Ereignisname wie in Start-Route, Zug-Route und Relais, ohne Nutzertext und ohne Kennung der Person.
 */
const h = vi.hoisted(() => ({ logApi: vi.fn(), rate: [] as Array<[string, number, number]> }));

vi.mock("@/lib/api-auth", () => ({ requireAuth: async () => ({ uid: "u1", email: "a@example.com", oid: "oid-1" }) }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (key: string, max: number, windowMs: number) => {
    h.rate.push([key, max, windowMs]);
    return null;
  },
}));
vi.mock("@/lib/server/get-request-locale", () => ({ getApiMessages: () => ({ rateLimited: "Zu viele Anfragen." }) }));
vi.mock("@/lib/logger", () => ({ logger: { api: h.logApi, apiError: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("server-only", () => ({}));

import { POST } from "./route";

const melde = (body: Record<string, unknown>) =>
  POST(new NextRequest("http://localhost/api/simulation/zaehlpunkt", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

beforeEach(() => {
  process.env.SIMULATION_ENABLED = "on";
  h.logApi.mockReset();
  h.rate.length = 0;
});

afterEach(() => {
  delete process.env.SIMULATION_ENABLED;
});

describe("POST /api/simulation/zaehlpunkt", () => {
  it("schreibt je Schritt genau eine Zeile unter dem gemeinsamen Ereignisnamen", async () => {
    for (const schritt of ["briefing", "mikro_ok", "mikro_verweigert"]) {
      const res = await melde({ schritt, scenarioId: "sim-coaching-morgan", weg: "sprechen" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }
    expect(h.logApi.mock.calls).toEqual([
      ["/api/simulation/trichter", "briefing", { scenarioId: "sim-coaching-morgan", weg: "sprechen" }],
      ["/api/simulation/trichter", "mikro_ok", { scenarioId: "sim-coaching-morgan", weg: "sprechen" }],
      ["/api/simulation/trichter", "mikro_verweigert", { scenarioId: "sim-coaching-morgan", weg: "sprechen" }],
    ]);
  });

  it("ohne Weg (Briefing vor der Wahl) fehlt das Feld; die Zeile nennt weder Person noch Text", async () => {
    await melde({ schritt: "briefing", scenarioId: "ws-mein-abc123" });
    expect(h.logApi.mock.calls).toEqual([["/api/simulation/trichter", "briefing", { scenarioId: "ws-mein-abc123" }]]);
    expect(JSON.stringify(h.logApi.mock.calls)).not.toContain("u1");
  });

  it("nimmt nur die drei Schritte des Browsers und keine freien Texte an", async () => {
    // `start` und `erstes_wort` schreibt der Server selbst.
    expect((await melde({ schritt: "start", scenarioId: "sim-coaching-morgan" })).status).toBe(400);
    expect((await melde({ schritt: "erstes_wort", scenarioId: "sim-coaching-morgan" })).status).toBe(400);
    expect((await melde({ schritt: "briefing", scenarioId: "Hallo, ich bin ein freier Text" })).status).toBe(400);
    expect((await melde({ schritt: "briefing", scenarioId: "sim-coaching-morgan", weg: "tanzen" })).status).toBe(400);
    expect((await melde({ schritt: "briefing" })).status).toBe(400);
    expect(h.logApi).not.toHaveBeenCalled();
  });

  it("höchstens 30 je Minute je Person; aus, wenn die Simulation aus ist", async () => {
    await melde({ schritt: "briefing", scenarioId: "sim-coaching-morgan" });
    expect(h.rate).toEqual([["sim-zaehlpunkt:u1", 30, 60_000]]);
    process.env.SIMULATION_ENABLED = "off";
    expect((await melde({ schritt: "briefing", scenarioId: "sim-coaching-morgan" })).status).toBe(503);
  });
});
