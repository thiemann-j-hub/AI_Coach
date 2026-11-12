import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Go-Live-Prüfung 12.11.2026, S4: Begrenzung je Person statt je Firmenadresse — an den Wegen der Transkript-Analyse,
 * an „Vorbereiten“ und am Builder (Rollenspiel-Start, Zug und Auswertung waren schon umgestellt).
 * Ablauf aus dem Befund: Zwölf Personen eines Kunden sitzen im Workshop hinter EINER Adresse. Ab der vierten in
 * derselben Minute antwortete „Vorbereiten“ mit 429 und dem englischen Standardsatz. Umgekehrt wechselte ein Skript
 * den Schlüssel mit einer selbst gesetzten Kopfzeile `x-forwarded-for`.
 * Echt sind die Routen und die Begrenzung. Jede Anfrage ist absichtlich ungültig (400), damit hinter der Begrenzung
 * nichts weiter läuft; alles Schwere ist gemockt.
 */
const h = vi.hoisted(() => ({ uid: "person-0" }));
vi.mock("@/lib/api-auth", () => ({ requireAuth: async () => ({ uid: h.uid, email: "a@example.com", oid: "oid-1" }) }));
vi.mock("@/lib/cosmos", async () => (await import("@/test/analyse-speicher")).neuerAnalyseSpeicher().cosmos);
vi.mock("@/ai/genkit", () => ({ GENKIT_MODEL_ID: "test-modell" }));
vi.mock("@/ai/flows/generate-dynamic-feedback", () => ({ generateDynamicFeedback: vi.fn() }));
vi.mock("@/ai/flows/score-competencies", () => ({ scoreCompetencies: vi.fn() }));
vi.mock("@/ai/flows/scenario-generator", () => ({ draftIdFromBrief: vi.fn(), generateScenarioDraft: vi.fn() }));
vi.mock("@/lib/server/cost-cap", () => ({ checkAndConsumeBudget: async () => ({ allowed: true }), estimateTokens: () => 1 }));
vi.mock("@/lib/server/credits/entitlement", () => ({
  creditGateEnabled: () => false,
  reserveEntitlement: vi.fn(),
  settleEntitlement: vi.fn(),
  compensateEntitlement: vi.fn(),
  kiSchalterBlockt: async () => null,
}));
vi.mock("@/lib/server/credits/credit-service", () => ({ creditsCentralEnabled: () => false, centralRefund: vi.fn() }));
vi.mock("@/lib/server/credits/workspace-store", () => ({ getWorkspaceIdForUser: async () => "ws-1" }));
vi.mock("@/lib/server/radar-emit", () => ({ deleteCoachMeasurement: vi.fn(), emitCoachMeasurement: vi.fn() }));
vi.mock("@/lib/server/scenario-admin", () => ({ requireWorkspaceAdmin: async () => ({ workspaceId: "ws-1" }) }));
vi.mock("@/lib/server/scenario-store", () => ({
  PRIVATE_SCENARIO_PREFIX: "ws-mein-",
  SCENARIO_DOC_TYPE: "sim_scenario",
  scenarioPartitionKey: (ws: string) => `simscn:${ws}`,
  listPrivateScenarioDocs: vi.fn(),
  deletePrivateScenario: vi.fn(),
  upsertPrivateScenario: vi.fn(),
  listWorkspaceScenarioDocs: vi.fn(),
  upsertWorkspaceScenario: vi.fn(),
  setWorkspaceScenarioStatus: vi.fn(),
  deleteWorkspaceScenario: vi.fn(),
  getScenarioForUser: vi.fn(),
  setWorkspaceScenarioVoice: vi.fn(),
}));
vi.mock("@/lib/server/spielbuch/store", () => ({ ensureSpielbuch: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { api: vi.fn(), apiError: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { getDictionary } from "@/i18n/dictionaries";
import { POST as analyze } from "./analyze/route";
import { POST as runsSave } from "./runs/save/route";
import { POST as runsDelete } from "./runs/delete/route";
import { POST as runsRate } from "./runs/rate/route";
import { GET as runsList } from "./runs/list/route";
import { GET as runsGet } from "./runs/get/route";
import { POST as vorbereiten } from "./simulation/vorbereiten/route";
import { POST as builderGenerate } from "./simulation/builder/generate/route";
import { POST as builderStatus } from "./simulation/builder/status/route";
import { POST as builderDelete } from "./simulation/builder/delete/route";
import { POST as builderVoice } from "./simulation/builder/voice/route";

type Route = (req: NextRequest) => Promise<Response>;
/** Ungültige Anfrage von einer Adresse: POST mit leerem Körper, GET ohne Angaben. */
const anfrage = (method: "POST" | "GET", ip: string) =>
  new NextRequest("http://localhost/api/x", {
    method,
    headers: { "content-type": "application/json", "x-locale": "de", "x-forwarded-for": ip },
    ...(method === "POST" ? { body: "{}" } : {}),
  });

/** Weg, Grenzwert je Minute (unverändert), Route, Methode. */
const WEGE: Array<[string, number, Route, "POST" | "GET"]> = [
  ["analyze", 10, analyze, "POST"],
  ["runs/save", 20, runsSave, "POST"],
  ["runs/delete", 20, runsDelete, "POST"],
  ["runs/rate", 20, runsRate, "POST"],
  ["runs/list", 30, runsList, "GET"],
  ["runs/get", 30, runsGet, "GET"],
  ["simulation/vorbereiten", 3, vorbereiten, "POST"],
  ["simulation/builder/generate", 4, builderGenerate, "POST"],
  ["simulation/builder/status", 10, builderStatus, "POST"],
  ["simulation/builder/delete", 10, builderDelete, "POST"],
  ["simulation/builder/voice", 20, builderVoice, "POST"],
];

beforeAll(() => {
  process.env.SIMULATION_ENABLED = "on";
});
afterAll(() => {
  delete process.env.SIMULATION_ENABLED;
});

describe("S4 Begrenzung je Person", () => {
  it.each(WEGE)("%s: mehr Personen als der Grenzwert hinter EINER Adresse, keine wird begrenzt", async (weg, grenze, route, method) => {
    for (let i = 0; i < grenze + 2; i++) {
      h.uid = `gruppe-${weg}-${i}`;
      const res = await route(anfrage(method, "203.0.113.7"));
      expect(res.status, `Person ${i + 1}`).toBe(400);
    }
  });

  it.each(WEGE)("%s: eine Person über dem Grenzwert bekommt 429 mit dem Satz aus dem Wörterbuch, auch mit wechselnder Adresse", async (weg, grenze, route, method) => {
    h.uid = `einzeln-${weg}`;
    for (let i = 0; i < grenze; i++) {
      expect((await route(anfrage(method, `198.51.100.${i}`))).status, `Aufruf ${i + 1}`).toBe(400);
    }
    const res = await route(anfrage(method, "198.51.100.250"));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ ok: false, code: "RATE_LIMITED", error: getDictionary("de").api.rateLimited });
  });
});
