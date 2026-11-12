import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Live-Prüfung 12.11.2026: Die Antwort des frisch vorbereiteten Gesprächs nennt `liveAvailable` wie der Katalog.
 * Ohne die Angabe bot das Briefing „Sprechen“ erst nach dem nächsten Laden der Seite an.
 * Echt ist die Route; gemockt sind Anmeldung, Begrenzung, Guthaben, Generator und Speicher.
 */
vi.mock("@/lib/api-auth", () => ({ requireAuth: async () => ({ uid: "u1", email: "a@example.com", oid: "oid-1" }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => null, rateLimitKey: () => "k" }));
vi.mock("@/lib/server/cost-cap", () => ({ checkAndConsumeBudget: async () => ({ allowed: true }), estimateTokens: () => 1 }));
vi.mock("@/lib/server/credits/entitlement", () => ({
  creditGateEnabled: () => false,
  reserveEntitlement: vi.fn(),
  settleEntitlement: vi.fn(),
  compensateEntitlement: vi.fn(),
  kiSchalterBlockt: async () => null,
}));
vi.mock("@/lib/logger", () => ({ logger: { api: vi.fn(), apiError: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/ai/flows/scenario-generator", async () => {
  const { getScenario } = await import("@/lib/simulation/scenarios");
  return { generateScenarioDraft: async ({ id }: { id: string }) => ({ ...getScenario("sim-coaching-morgan")!, id }) };
});
vi.mock("@/lib/server/scenario-store", () => ({
  PRIVATE_SCENARIO_PREFIX: "ws-mein-",
  listPrivateScenarioDocs: async () => [],
  deletePrivateScenario: vi.fn(),
  upsertPrivateScenario: async (_uid: string, scenario: { id: string }) => ({ id: scenario.id, scenario, expiresAt: "2026-12-12T00:00:00.000Z" }),
}));

const BODY = {
  anlass: "Ich muss einem Kollegen sagen, dass seine Zuarbeit wiederholt zu spät kommt.",
  gegenueber: "Er weicht aus und verweist auf andere Aufgaben, bleibt aber freundlich.",
  locale: "de",
};
const vorbereiten = async () => {
  const { POST } = await import("./route");
  const res = await POST(
    new NextRequest("http://localhost/api/simulation/vorbereiten", { method: "POST", body: JSON.stringify(BODY), headers: { "content-type": "application/json" } })
  );
  return { status: res.status, json: await res.json() };
};

beforeEach(() => {
  process.env.SIMULATION_ENABLED = "on";
});

afterEach(() => {
  delete process.env.SIMULATION_ENABLED;
  delete process.env.COACH_LIVE;
});

describe("POST /api/simulation/vorbereiten — liveAvailable", () => {
  it("Live für alle: das neue Gespräch trägt liveAvailable true; die Rollen-DNA bleibt auf dem Server", async () => {
    process.env.COACH_LIVE = "all";
    const { status, json } = await vorbereiten();
    expect(status).toBe(200);
    expect(json.scenario.id).toMatch(/^ws-mein-[0-9a-f]{8}$/);
    expect(json.scenario.liveAvailable).toBe(true);
    expect(json.scenario).not.toHaveProperty("personaDna");
    expect(json.expiresAt).toBe("2026-12-12T00:00:00.000Z");
  });

  it("Live aus oder nur für einzelne Szenarien des Katalogs: false", async () => {
    expect((await vorbereiten()).json.scenario.liveAvailable).toBe(false);
    process.env.COACH_LIVE = "sim-coaching-morgan";
    expect((await vorbereiten()).json.scenario.liveAvailable).toBe(false);
  });
});
