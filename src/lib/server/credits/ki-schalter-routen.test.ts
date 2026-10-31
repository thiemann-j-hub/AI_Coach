import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/**
 * A4 (Prüfung Sichtbarkeit, 31.10.2026): Jeder KI-Einstieg im laufenden Gespräch fragt den KI-Schalter
 * des Unternehmens (kiSchalterBlockt). Ist er aus, antwortet die Route 403 KI_AUS, BEVOR sie Daten lädt
 * oder die KI ruft — und vor den 503-Antworten, auf die der Browser mit eigener Erkennung/Stimme ausweicht.
 * Ist er an, läuft die Route weiter wie bisher. Alles außer den Routen selbst ist gemockt.
 */
const kiBlock = vi.fn();
vi.mock("@/lib/server/credits/entitlement", () => ({ kiSchalterBlockt: (ort?: string) => kiBlock(ort) }));
vi.mock("@/lib/api-auth", () => ({ requireAuth: async () => ({ uid: "u1", email: "a@example.com", oid: "oid-1" }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => null, rateLimitKey: () => "k" }));
vi.mock("@/lib/logger", () => ({ logger: { api: vi.fn(), apiError: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/server/cost-cap", () => ({ checkAndConsumeBudget: vi.fn(async () => ({ allowed: true })), estimateTokens: () => 1 }));

// Gesprächszug und Time-out-Tipp
const getSimulation = vi.fn(async (..._a: unknown[]) => null);
vi.mock("@/lib/server/simulation-store", () => ({
  SIM_MAX_TURN_CHARS: 2000,
  SIM_MAX_USER_TURNS: 30,
  SIM_TIME_WARN_FRACTION: 0.8,
  SIM_MAX_TIMEOUTS: 3,
  countUserTurns: () => 0,
  getSimulation: (...a: unknown[]) => getSimulation(...a),
  saveSimulation: vi.fn(),
}));
vi.mock("@/lib/server/scenario-store", () => ({
  getScenarioForUser: vi.fn(async () => null),
  resolveWorkspaceIdForScenarios: vi.fn(async () => "ws-1"),
}));
const runPersonaTurn = vi.fn();
vi.mock("@/ai/flows/simulation-persona", () => ({ runPersonaTurn: (...a: unknown[]) => runPersonaTurn(...a) }));
const beobachteRegie = vi.fn();
vi.mock("@/ai/flows/simulation-regie", () => ({
  beobachteRegie: (...a: unknown[]) => beobachteRegie(...a),
  offeneRegieNotiz: vi.fn(),
  regieStageNote: vi.fn(),
}));
const ensureSpielbuch = vi.fn();
vi.mock("@/lib/server/spielbuch/store", () => ({ ensureSpielbuch: (...a: unknown[]) => ensureSpielbuch(...a) }));
const runCoachTimeout = vi.fn();
vi.mock("@/ai/flows/simulation-coach", () => ({ runCoachTimeout: (...a: unknown[]) => runCoachTimeout(...a) }));

// Live-Karte
const issue = vi.fn(() => "karte");
vi.mock("@/lib/server/live/live-accept", () => ({ liveConfigured: () => true, registerLiveAccept: vi.fn() }));
vi.mock("@/lib/server/live/ticket-store", () => ({ liveTicketStore: () => ({ issue }) }));
vi.mock("@/lib/server/live/sprachaufnahme-gate", () => ({ sprachaufnahmeEinwilligungFehlt: async () => false }));

// Vorlesen
let ttsConfigured = true;
const synthesize = vi.fn(async (..._a: unknown[]) => new ArrayBuffer(4));
vi.mock("@/lib/server/azure-tts", () => ({
  AzureTtsError: class AzureTtsError extends Error {
    status = 502;
  },
  TTS_MAX_CHARS: 1000,
  azureTtsConfigured: () => ttsConfigured,
  isPersonaVoice: () => false,
  synthesizeTtsMp3: (...a: unknown[]) => synthesize(...a),
}));

// Sprach-Token (Einwilligungs-Tor hier aus — es hat eigene Tests)
vi.mock("@/lib/server/credits/member-info", () => ({ consentGateOn: () => false }));

// Interview
const readInterview = vi.fn(async (..._a: unknown[]) => null);
vi.mock("@/lib/server/interview-store", () => ({ readInterview: (...a: unknown[]) => readInterview(...a), saveInterview: vi.fn() }));
const naechsterSchritt = vi.fn();
vi.mock("@/ai/flows/interview-fuehrung", () => ({ naechsterSchritt: (...a: unknown[]) => naechsterSchritt(...a) }));

const KI_AUS = { ok: false, code: "KI_AUS", error: "Rollenspiele und Gesprächsanalyse sind für Euer Unternehmen ausgeschaltet." };
const aus = () => kiBlock.mockImplementation(async () => NextResponse.json(KI_AUS, { status: 403 }));
const an = () => kiBlock.mockImplementation(async () => null);
const post = (path: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

async function erwarteKiAus(res: Response, ort: string) {
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual(KI_AUS);
  expect(kiBlock).toHaveBeenCalledWith(ort);
}

const fetchMock = vi.fn();

beforeEach(() => {
  process.env.SIMULATION_ENABLED = "on";
  process.env.AZURE_SPEECH_KEY = "key";
  process.env.AZURE_SPEECH_REGION = "westeurope";
  delete process.env.SPEECH_INPUT;
  ttsConfigured = true;
  for (const m of [kiBlock, getSimulation, runPersonaTurn, beobachteRegie, ensureSpielbuch, runCoachTimeout, issue, synthesize, readInterview, naechsterSchritt, fetchMock]) {
    m.mockClear();
  }
  fetchMock.mockImplementation(async () => new Response("speech-token", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  delete process.env.SIMULATION_ENABLED;
  delete process.env.AZURE_SPEECH_KEY;
  delete process.env.AZURE_SPEECH_REGION;
  delete process.env.SPEECH_INPUT;
  vi.unstubAllGlobals();
});

const SIM = { simId: "sim-abcdefgh" };

describe("Gesprächszug /api/simulation/turn", () => {
  it("Schalter aus: 403 KI_AUS, kein Lauf geladen, keine Rolle, kein Beobachter", async () => {
    aus();
    const { POST } = await import("@/app/api/simulation/turn/route");
    await erwarteKiAus(await POST(post("/api/simulation/turn", { ...SIM, message: "Hallo" })), "/api/simulation/turn");
    expect(getSimulation).not.toHaveBeenCalled();
    expect(runPersonaTurn).not.toHaveBeenCalled();
    expect(beobachteRegie).not.toHaveBeenCalled();
    expect(ensureSpielbuch).not.toHaveBeenCalled();
  });

  it("Schalter an: die Route läuft weiter (hier bis zum fehlenden Lauf)", async () => {
    an();
    const { POST } = await import("@/app/api/simulation/turn/route");
    const res = await POST(post("/api/simulation/turn", { ...SIM, message: "Hallo" }));
    expect(res.status).toBe(404);
    expect(getSimulation).toHaveBeenCalledTimes(1);
  });
});

describe("Time-out-Tipp /api/simulation/timeout", () => {
  it("Schalter aus: 403 KI_AUS, kein Coach-Tipp", async () => {
    aus();
    const { POST } = await import("@/app/api/simulation/timeout/route");
    await erwarteKiAus(await POST(post("/api/simulation/timeout", SIM)), "/api/simulation/timeout");
    expect(getSimulation).not.toHaveBeenCalled();
    expect(runCoachTimeout).not.toHaveBeenCalled();
  });

  it("Schalter an: die Route läuft weiter", async () => {
    an();
    const { POST } = await import("@/app/api/simulation/timeout/route");
    expect((await POST(post("/api/simulation/timeout", SIM))).status).toBe(404);
    expect(getSimulation).toHaveBeenCalledTimes(1);
  });
});

describe("Live-Karte /api/simulation/live/ticket", () => {
  it("Schalter aus: 403 KI_AUS (nicht LIVE_OFF/503, sonst nähme der Browser die Kaskade), keine Karte", async () => {
    aus();
    const { POST } = await import("@/app/api/simulation/live/ticket/route");
    await erwarteKiAus(await POST(post("/api/simulation/live/ticket", SIM)), "/api/simulation/live/ticket");
    expect(getSimulation).not.toHaveBeenCalled();
    expect(issue).not.toHaveBeenCalled();
  });

  it("Schalter an: die Route läuft weiter", async () => {
    an();
    const { POST } = await import("@/app/api/simulation/live/ticket/route");
    expect((await POST(post("/api/simulation/live/ticket", SIM))).status).toBe(404);
    expect(getSimulation).toHaveBeenCalledTimes(1);
  });
});

describe("Vorlesen /api/tts", () => {
  it("Schalter aus: 403 KI_AUS, keine Sprachausgabe — auch vor dem 503, auf den der Browser selbst vorliest", async () => {
    aus();
    const { POST } = await import("@/app/api/tts/route");
    await erwarteKiAus(await POST(post("/api/tts", { text: "Guten Morgen." })), "/api/tts");
    expect(synthesize).not.toHaveBeenCalled();
    ttsConfigured = false;
    expect((await POST(post("/api/tts", { text: "Guten Morgen." }))).status).toBe(403);
  });

  it("Schalter an: Sprachausgabe wie bisher", async () => {
    an();
    const { POST } = await import("@/app/api/tts/route");
    const res = await POST(post("/api/tts", { text: "Guten Morgen." }));
    expect(res.status).toBe(200);
    expect(synthesize).toHaveBeenCalledTimes(1);
  });
});

describe("Sprach-Token /api/speech-token", () => {
  it("Schalter aus: 403 KI_AUS, kein Token — auch vor dem 503, auf den der Browser mit eigener Erkennung ausweicht", async () => {
    aus();
    const { GET } = await import("@/app/api/speech-token/route");
    await erwarteKiAus(await GET(new NextRequest("http://localhost/api/speech-token")), "/api/speech-token");
    expect(fetchMock).not.toHaveBeenCalled();
    process.env.SPEECH_INPUT = "browser";
    expect((await GET(new NextRequest("http://localhost/api/speech-token"))).status).toBe(403);
  });

  it("Schalter an: Token wie bisher", async () => {
    an();
    const { GET } = await import("@/app/api/speech-token/route");
    const res = await GET(new NextRequest("http://localhost/api/speech-token"));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("Interview-Zug /api/interview/turn", () => {
  const BODY = { id: "0b1c2d3e-0000-4000-8000-000000000001", text: "Die Übungen waren gut." };

  it("Schalter aus: 403 KI_AUS, kein Interview geladen, kein Interviewer", async () => {
    aus();
    const { POST } = await import("@/app/api/interview/turn/route");
    await erwarteKiAus(await POST(post("/api/interview/turn", BODY)), "/api/interview/turn");
    expect(readInterview).not.toHaveBeenCalled();
    expect(naechsterSchritt).not.toHaveBeenCalled();
  });

  it("Schalter an: die Route läuft weiter", async () => {
    an();
    const { POST } = await import("@/app/api/interview/turn/route");
    expect((await POST(post("/api/interview/turn", BODY))).status).toBe(404);
    expect(readInterview).toHaveBeenCalledTimes(1);
  });
});
