import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A4 (Prüfung Sichtbarkeit, 31.10.2026): KI-Schalter des Unternehmens — der Kern für eine Kennung
 * (kiSchalterAus, auch für die Live-Sitzung) und die Antwort der API-Routen (kiSchalterBlockt).
 * Register-Auskunft, Sitzung und Protokoll sind gemockt; kiErlaubt ist die echte Regel aus member-info.
 */
const stateMock = vi.fn();
const authMock = vi.fn();
const warn = vi.fn();
const apiError = vi.fn();
let central = true;

vi.mock("@/lib/server/credits/credit-service", () => ({
  creditsCentralEnabled: () => central,
  centralReserve: vi.fn(),
  centralRefund: vi.fn(),
  centralWalletStatus: vi.fn(),
}));
vi.mock("@/lib/server/credits/member-info", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./member-info")>()),
  getCentralMemberState: (oid: string) => stateMock(oid),
}));
vi.mock("@/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/logger", () => ({
  logger: { warn: (...a: unknown[]) => warn(...a), apiError: (...a: unknown[]) => apiError(...a), api: vi.fn() },
}));

import { KI_AUS_TEXT, kiSchalterAus, kiSchalterBlockt } from "./entitlement";

const OID = "11111111-2222-4333-8444-555555555555";
const info = (ki: { gesamt?: boolean; funktionen?: Record<string, boolean> } = {}) => ({
  kind: "info",
  info: {
    workspaceId: "ws-1",
    role: "member",
    apps: ["coach"],
    disabled: false,
    einstellungen: { ki: { gesamt: ki.gesamt ?? true, funktionen: ki.funktionen ?? {} }, datenschutz: { mindestgruppe: 5 }, einwilligungen: {} },
  },
});

beforeEach(() => {
  central = true;
  stateMock.mockReset();
  authMock.mockReset();
  warn.mockReset();
  apiError.mockReset();
  delete process.env.KI_GATE;
});

afterEach(() => {
  delete process.env.KI_GATE;
});

describe("kiSchalterAus — Schalter des Unternehmens für eine Kennung", () => {
  it("„Rollenspiele und Gesprächsanalyse (Coach)“ aus → aus", async () => {
    stateMock.mockResolvedValue(info({ funktionen: { rollenspiele: false } }));
    expect(await kiSchalterAus(OID)).toBe(true);
    expect(stateMock).toHaveBeenCalledWith(OID);
  });

  it("Hauptschalter „Alle KI-Funktionen … ausschalten“ → aus, auch wenn die Zeile an ist", async () => {
    stateMock.mockResolvedValue(info({ gesamt: false, funktionen: { rollenspiele: true } }));
    expect(await kiSchalterAus(OID)).toBe(true);
  });

  it("an bleibt an — ein anderer Schalter (z. B. Assistent) zählt hier nicht", async () => {
    stateMock.mockResolvedValue(info({ funktionen: { assistent: false, interviews: false } }));
    expect(await kiSchalterAus(OID)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("Rückweg KI_GATE=off: nie aus", async () => {
    process.env.KI_GATE = "off";
    stateMock.mockResolvedValue(info({ gesamt: false }));
    expect(await kiSchalterAus(OID)).toBe(false);
  });

  it.each(["unavailable", "login-required", "denied"])(
    "Einstellungen nicht lesbar (%s): KI bleibt an wie bisher, aber mit Warnung (Ort, Grund, ohne Kennung)",
    async (kind) => {
      stateMock.mockResolvedValue({ kind });
      expect(await kiSchalterAus(OID, "/api/simulation/turn")).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][1]).toEqual({ ort: "/api/simulation/turn", grund: kind });
      expect(JSON.stringify(warn.mock.calls)).not.toContain(OID);
    }
  );

  it("Fehler beim Lesen: KI bleibt an, Warnung mit Grund „fehler“", async () => {
    stateMock.mockRejectedValue(new Error("register down"));
    expect(await kiSchalterAus(OID, "live")).toBe(false);
    expect(warn.mock.calls[0][1]).toMatchObject({ ort: "live", grund: "fehler", err: "register down" });
  });

  it("Zentrale aus (lokal): keine Einstellungen, also auch keine Warnung", async () => {
    central = false;
    stateMock.mockResolvedValue({ kind: "unavailable" });
    expect(await kiSchalterAus(OID)).toBe(false);
    expect(await kiSchalterAus(null)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("ohne Kennung: KI bleibt an, das Register wird nicht gefragt, Warnung bei eingeschalteter Zentrale", async () => {
    expect(await kiSchalterAus(null, "/api/tts")).toBe(false);
    expect(await kiSchalterAus(undefined, "/api/tts")).toBe(false);
    expect(stateMock).not.toHaveBeenCalled();
    expect(warn.mock.calls.map((c) => c[1])).toEqual([
      { ort: "/api/tts", grund: "ohne-kennung" },
      { ort: "/api/tts", grund: "ohne-kennung" },
    ]);
  });
});

describe("kiSchalterBlockt — Antwort der API-Routen", () => {
  it("liest die Kennung aus der Sitzung; aus → 403 KI_AUS mit dem bekannten Satz", async () => {
    authMock.mockResolvedValue({ user: { oid: OID } });
    stateMock.mockResolvedValue(info({ funktionen: { rollenspiele: false } }));
    const res = await kiSchalterBlockt("/api/simulation/turn");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    expect(await res!.json()).toEqual({ ok: false, code: "KI_AUS", error: KI_AUS_TEXT });
    expect(stateMock).toHaveBeenCalledWith(OID);
  });

  it("an → kein Block", async () => {
    authMock.mockResolvedValue({ user: { oid: OID } });
    stateMock.mockResolvedValue(info());
    expect(await kiSchalterBlockt()).toBeNull();
  });

  it("Register nicht lesbar → kein Block, Warnung mit dem Ort der Route", async () => {
    authMock.mockResolvedValue({ user: { oid: OID } });
    stateMock.mockResolvedValue({ kind: "unavailable" });
    expect(await kiSchalterBlockt("/api/speech-token")).toBeNull();
    expect(warn.mock.calls[0][1]).toEqual({ ort: "/api/speech-token", grund: "unavailable" });
  });

  it("Sitzung nicht lesbar → kein Block wie bisher (Fehler im Protokoll)", async () => {
    authMock.mockRejectedValue(new Error("session"));
    expect(await kiSchalterBlockt()).toBeNull();
    expect(apiError).toHaveBeenCalledTimes(1);
    expect(stateMock).not.toHaveBeenCalled();
  });
});
