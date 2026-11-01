import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { sprachaufnahmeEinwilligungFehlt } from "./sprachaufnahme-gate";

/**
 * Einwilligung „Sprachaufnahme“ vor jedem Mikrofon-Weg (01.11.2026, Bewertung Teil 1, Owner-Ja).
 *
 * Seit der Fassung 2026-11-01 (Credit-Dienst 9fbef19) verlangt resolve-workspace die Einwilligung für JEDES
 * Unternehmen (einstellungen.einwilligungen.sprachaufnahme === true); wer nur der Fassung 2026-10-20
 * zugestimmt hat, willigt einmal neu ein. Geprüft wird die echte Kette: Antwort des Registers (fetch gemockt)
 * → member-info → sprachaufnahme-gate → Route. Gemockt sind nur Anmeldung, KI-Schalter, Rate-Limit,
 * Token-Speicher und die Live-Bausteine.
 *  - Sprach-Token: Die Einwilligung kommt VOR dem 503 stt_disabled und vor dem Rate-Limit. Auf beide Antworten
 *    nahm der Browser seine eigene Erkennung (Chrome schickt die Aufnahme an Google), ohne Einwilligung.
 *  - Live-Karte: dasselbe Tor, dieselbe Antwort.
 *  - Browser-Erkennung nur auf ausdrücklichen Rückweg: Nur SPEECH_INPUT=browser trägt mode "browser"; 503 ohne
 *    Schlüssel, 502 und 429 tragen keins — der Coach zeigt dann den Fehler statt der Browser-Erkennung.
 */
const FASSUNG = "2026-11-01";
const EINWILLIGUNG = { ok: false, error: "consent_required", code: "EINWILLIGUNG", url: "/einwilligung?typ=sprachaufnahme&zurueck=/coach/simulation" };

let oid = "";
let lauf = 0;
let rateLimit: Response | null = null;
let registerErreichbar = true;
let azureErreichbar = true;
let meine: Record<string, { fassung: string; am: string }> = {};

vi.mock("@/lib/api-auth", () => ({ requireAuth: async () => ({ uid: "u1", email: "a@example.com", oid }) }));
vi.mock("@/lib/server/credits/entitlement", () => ({ kiSchalterBlockt: async () => null }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => rateLimit }));
vi.mock("@/lib/logger", () => ({ logger: { api: vi.fn(), apiError: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/server/credits/entra-token-store", () => ({ getValid: async () => ({ ok: true, accessToken: "AT" }) }));

// Live-Karte: ein laufendes Gespräch, Live konfiguriert
const issue = vi.fn(() => "karte");
vi.mock("@/lib/server/live/live-accept", () => ({ liveConfigured: () => true, registerLiveAccept: vi.fn() }));
vi.mock("@/lib/server/live/ticket-store", () => ({ liveTicketStore: () => ({ issue }) }));
vi.mock("@/lib/server/simulation-store", () => ({
  SIM_MAX_USER_TURNS: 30,
  countUserTurns: () => 0,
  getSimulation: async () => ({ scenarioId: "sc-1", status: "active", closedByTime: false, turns: [] }),
}));
vi.mock("@/lib/server/scenario-store", () => ({ getScenarioForUser: async () => ({ id: "sc-1", persona: { name: "Katja Brenner" } }) }));

/** Antwort von resolve-workspace ab der Fassung 2026-11-01: Sprechen verlangt jedes Unternehmen (fest, nicht wählbar). */
function registerAntwort() {
  return {
    workspaceId: "ws-1",
    role: "member",
    apps: ["coach"],
    disabled: false,
    einstellungen: {
      ki: { gesamt: true, funktionen: {} },
      datenschutz: { mindestgruppe: 5 },
      einwilligungen: { allgemein: true, ki: true, sprachaufnahme: true, interview: true, interviewEinwilligung: false },
    },
    einwilligungFassungen: { allgemein: FASSUNG, ki: FASSUNG, sprachaufnahme: FASSUNG, interview: FASSUNG, interviewEinwilligung: FASSUNG },
    meineEinwilligungen: meine,
  };
}

const fetchMock = vi.fn(async (url: string | URL | Request) => {
  const u = String(url);
  if (u.endsWith("/resolve-workspace")) {
    return registerErreichbar
      ? new Response(JSON.stringify(registerAntwort()), { status: 200, headers: { "content-type": "application/json" } })
      : new Response("", { status: 503 });
  }
  if (u.includes("/sts/v1.0/issueToken")) return azureErreichbar ? new Response("speech-token", { status: 200 }) : new Response("", { status: 500 });
  throw new Error(`unerwarteter Abruf: ${u}`);
});
const azureAbrufe = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("/sts/v1.0/issueToken")).length;

const eingewilligt = (fassung = FASSUNG) => {
  meine = { sprachaufnahme: { fassung, am: "2026-11-01T09:00:00.000Z" } };
};
const tokenHolen = async () => (await import("@/app/api/speech-token/route")).GET(new NextRequest("http://localhost/api/speech-token"));
const karteHolen = async () =>
  (await import("@/app/api/simulation/live/ticket/route")).POST(
    new NextRequest("http://localhost/api/simulation/live/ticket", {
      method: "POST",
      body: JSON.stringify({ simId: "sim-abcdefgh" }),
      headers: { "content-type": "application/json" },
    })
  );

const ENV = ["CREDITS_CENTRAL", "SIMULATION_ENABLED", "COACH_LIVE", "AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION", "SPEECH_INPUT", "CONSENT_GATE"];

beforeEach(() => {
  // Frische Kennung je Test: member-info merkt sich die Auskunft 60 s je Kennung.
  oid = `oid-${++lauf}`;
  meine = {};
  rateLimit = null;
  registerErreichbar = true;
  azureErreichbar = true;
  process.env.CREDITS_CENTRAL = "on";
  process.env.SIMULATION_ENABLED = "on";
  process.env.COACH_LIVE = "all";
  process.env.AZURE_SPEECH_KEY = "key";
  process.env.AZURE_SPEECH_REGION = "westeurope";
  delete process.env.SPEECH_INPUT;
  delete process.env.CONSENT_GATE;
  issue.mockClear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  for (const k of ENV) delete process.env[k];
  vi.unstubAllGlobals();
});

describe("Tor sprachaufnahmeEinwilligungFehlt — Register ab Fassung 2026-11-01", () => {
  it("keine Einwilligung → fehlt (jedes Unternehmen verlangt sie)", async () => {
    expect(await sprachaufnahmeEinwilligungFehlt(oid)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("nur die alte Fassung 2026-10-20 → fehlt: jede Person willigt einmal neu ein", async () => {
    eingewilligt("2026-10-20");
    expect(await sprachaufnahmeEinwilligungFehlt(oid)).toBe(true);
  });

  it("Einwilligung in der Fassung 2026-11-01 → frei", async () => {
    eingewilligt();
    expect(await sprachaufnahmeEinwilligungFehlt(oid)).toBe(false);
  });

  it("Rückweg CONSENT_GATE=off → keine Prüfung, kein Abruf", async () => {
    process.env.CONSENT_GATE = "off";
    expect(await sprachaufnahmeEinwilligungFehlt(oid)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Register gestört → durchlassen (fail-soft wie bisher, Verfügbarkeit vor Strenge)", async () => {
    registerErreichbar = false;
    expect(await sprachaufnahmeEinwilligungFehlt(oid)).toBe(false);
  });
});

describe("Sprach-Token /api/speech-token — Einwilligung vor dem 503", () => {
  it("Einwilligung fehlt + Spracherkennung aus → 403 EINWILLIGUNG statt 503 (sonst nähme der Browser seine eigene Erkennung)", async () => {
    process.env.SPEECH_INPUT = "browser";
    const res = await tokenHolen();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(EINWILLIGUNG);

    delete process.env.SPEECH_INPUT;
    delete process.env.AZURE_SPEECH_KEY; // nicht konfiguriert: ebenfalls 403, nicht 503
    expect((await tokenHolen()).status).toBe(403);
    expect(azureAbrufe()).toBe(0);
  });

  it("Einwilligung erteilt + Rückweg SPEECH_INPUT=browser → 503 mit mode „browser“ (nur dann Browser-Erkennung)", async () => {
    eingewilligt();
    process.env.SPEECH_INPUT = "browser";
    const res = await tokenHolen();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "stt_disabled", mode: "browser" });
    expect(azureAbrufe()).toBe(0);
  });

  it("Einwilligung fehlt + Rate-Limit erreicht → 403 EINWILLIGUNG, nicht 429", async () => {
    rateLimit = NextResponse.json({ ok: false, error: "Zu viele Anfragen. Bitte kurz warten." }, { status: 429 });
    const res = await tokenHolen();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(EINWILLIGUNG);
  });

  it("nur die alte Fassung 2026-10-20 → 403, kein Token", async () => {
    eingewilligt("2026-10-20");
    expect((await tokenHolen()).status).toBe(403);
    expect(azureAbrufe()).toBe(0);
  });

  it("Einwilligung erteilt + Spracherkennung an → Token wie bisher", async () => {
    eingewilligt();
    const res = await tokenHolen();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, token: "speech-token", region: "westeurope" });
    expect(azureAbrufe()).toBe(1);
  });
});

describe("Sprach-Token — Browser-Erkennung nur auf ausdrücklichen Rückweg", () => {
  const ohneMode = async (res: Response, status: number) => {
    expect(res.status).toBe(status);
    expect(await res.json()).not.toHaveProperty("mode");
  };

  it("Schlüssel oder Region fehlt → 503 OHNE mode: Fehler im Coach, keine Browser-Erkennung", async () => {
    eingewilligt();
    delete process.env.AZURE_SPEECH_KEY;
    await ohneMode(await tokenHolen(), 503);
    process.env.AZURE_SPEECH_KEY = "key";
    delete process.env.AZURE_SPEECH_REGION;
    await ohneMode(await tokenHolen(), 503);
  });

  it("Azure gestört → 502 ohne mode", async () => {
    eingewilligt();
    azureErreichbar = false;
    await ohneMode(await tokenHolen(), 502);
  });

  it("Rate-Limit (mit Einwilligung) → 429 ohne mode", async () => {
    eingewilligt();
    rateLimit = NextResponse.json({ ok: false, error: "Zu viele Anfragen. Bitte kurz warten." }, { status: 429 });
    await ohneMode(await tokenHolen(), 429);
  });
});

describe("Live-Karte /api/simulation/live/ticket — dieselbe Regel", () => {
  it("nur die alte Fassung 2026-10-20 → 403 EINWILLIGUNG, keine Karte, dieselbe Antwort wie beim Sprach-Token", async () => {
    eingewilligt("2026-10-20");
    const res = await karteHolen();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual(EINWILLIGUNG);
    expect(issue).not.toHaveBeenCalled();
    expect(await (await tokenHolen()).json()).toEqual(body);
  });

  it("Einwilligung in der Fassung 2026-11-01 → Karte", async () => {
    eingewilligt();
    const res = await karteHolen();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, ticket: "karte", persona: "Katja Brenner" });
    expect(issue).toHaveBeenCalledTimes(1);
  });

  it("Live aus (404 LIVE_OFF): die Kaskade fragt das Sprach-Token — ohne Einwilligung 403, auch bei Spracherkennung aus", async () => {
    process.env.COACH_LIVE = "off";
    process.env.SPEECH_INPUT = "browser";
    const karte = await karteHolen();
    expect(karte.status).toBe(404);
    expect(await karte.json()).toEqual({ ok: false, code: "LIVE_OFF" });
    const token = await tokenHolen();
    expect(token.status).toBe(403);
    expect(await token.json()).toEqual(EINWILLIGUNG);
  });
});
