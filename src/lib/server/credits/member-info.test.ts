import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * member-info mit zwei Ausweisen (Anmeldung-Umbau Schritt 2c, 02.10.2026).
 *
 * Ein PulseNorth-Konto (Kennung "ml:…") fragt das Register mit dem Dienst-Ausweis, ein
 * Microsoft-Konto wie bisher mit seinem Entra-Token. Geprüft wird hier die Auskunft selbst;
 * was das Tor daraus macht, steht in api-auth.test.ts. Die Microsoft-Fälle von B26 stehen
 * unverändert in login-gate.test.ts.
 * Token-Speicher und fetch sind gemockt (kein Cosmos, kein Netz).
 */
const SECRET = "s3cr3t-".padEnd(40, "x");
const PN_ID = "ml:0b1c2d3e-0000-4000-8000-000000000001";
const ENTRA_OID = "11111111-2222-4333-8444-555555555555";

type FetchCall = { url: string; init: RequestInit & { headers: Record<string, string> } };

let getValidMock: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

function calls(): FetchCall[] {
  return fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), init: init as FetchCall["init"] }));
}

function headerNames(c: FetchCall): string[] {
  return Object.keys(c.init.headers).map((k) => k.toLowerCase());
}

/** Lädt member-info frisch (leerer 60-s-Cache) mit gemocktem Token-Speicher und fetch. */
async function load(fetchImpl: (url: string, init: RequestInit) => Promise<unknown>) {
  vi.resetModules();
  process.env.CREDITS_CENTRAL = "on";
  getValidMock = vi.fn(async () => ({ ok: true, accessToken: "AT" }));
  vi.doMock("@/lib/server/credits/entra-token-store", () => ({ getValid: getValidMock }));
  fetchMock = vi.fn(fetchImpl);
  vi.stubGlobal("fetch", fetchMock);
  return import("./member-info");
}

const answer = (body: unknown) => async () => ({ ok: true, status: 200, json: async () => body });
const status = (code: number) => async () => ({ ok: false, status: code, json: async () => ({}) });

beforeEach(() => {
  process.env.PN_SERVICE_SECRET = SECRET;
  delete process.env.PN_SERVICE_AUTH;
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.PN_SERVICE_SECRET;
  delete process.env.PN_SERVICE_AUTH;
  delete process.env.CREDITS_CENTRAL;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("getCentralMemberState — PulseNorth-Konto (Dienst-Ausweis)", () => {
  it("asks the register with the service headers, never with a Bearer or the token store", async () => {
    const m = await load(
      answer({ workspaceId: "ws-1", role: "member", apps: ["coach"], disabled: false, displayName: "Sandra" })
    );
    const s = await m.getCentralMemberState(PN_ID);
    expect(s).toEqual({
      kind: "info",
      info: { workspaceId: "ws-1", role: "member", apps: ["coach"], disabled: false, avatarUrl: null, displayName: "Sandra" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [c] = calls();
    expect(c.url.endsWith("/resolve-workspace")).toBe(true);
    expect(c.init.headers["x-pn-service-secret"]).toBe(SECRET);
    expect(c.init.headers["x-pn-subject"]).toBe(PN_ID);
    expect(headerNames(c)).not.toContain("authorization");
    expect(getValidMock).not.toHaveBeenCalled();
    // Das Geheimnis steht nur in der Kopfzeile, nie in der Auskunft.
    expect(JSON.stringify(s)).not.toContain(SECRET);
  });

  it("keeps a positive answer for 60 s (the cache the app already had)", async () => {
    const m = await load(answer({ workspaceId: "ws-1", role: "admin", apps: ["coach", "jobmap"], disabled: false }));
    expect((await m.getCentralMemberState(PN_ID)).kind).toBe("info");
    expect((await m.getCentralMemberState(PN_ID)).kind).toBe("info");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes on what the register says about apps and deactivation", async () => {
    const m = await load(answer({ workspaceId: "ws-1", role: "member", apps: ["none"], disabled: true }));
    const s = await m.getCentralMemberState(PN_ID);
    expect(s.kind === "info" && s.info.apps).toEqual(["none"]);
    expect(s.kind === "info" && s.info.disabled).toBe(true);
  });

  it("401 from the register → denied, logged without the secret, not cached", async () => {
    const m = await load(status(401));
    expect(await m.getCentralMemberState(PN_ID)).toEqual({ kind: "denied" });
    expect(await m.getCentralMemberInfo(PN_ID)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2); // keine gemerkte Absage
    expect(getValidMock).not.toHaveBeenCalled();

    expect(errorSpy).toHaveBeenCalled();
    const logged = errorSpy.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
    expect(logged).toContain("member-info/resolve-workspace");
    expect(logged).not.toContain(SECRET);
  });

  it("register not reachable (5xx, network, unreadable answer) → unavailable, never info", async () => {
    const down = await load(status(503));
    expect(await down.getCentralMemberState(PN_ID)).toEqual({ kind: "unavailable" });

    const net = await load(async () => {
      throw new Error("ECONNRESET");
    });
    expect(await net.getCentralMemberState(PN_ID)).toEqual({ kind: "unavailable" });

    const garbled = await load(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("no json");
      },
    }));
    expect(await garbled.getCentralMemberState(PN_ID)).toEqual({ kind: "unavailable" });
    expect(await garbled.getCentralMemberInfo(PN_ID)).toBeNull();
  });

  it("an answer without apps is an answer without apps (the gate then refuses)", async () => {
    const m = await load(answer({ workspaceId: null, invited: false }));
    const s = await m.getCentralMemberState(PN_ID);
    expect(s.kind === "info" && s.info.apps).toEqual([]);
    expect(s.kind === "info" && s.info.workspaceId).toBeNull();
  });

  it("PulseNorth accounts switched off → no request at all, no token store", async () => {
    const m = await load(answer({ workspaceId: "ws-1", apps: ["coach"] }));
    process.env.PN_SERVICE_AUTH = "off";
    expect((await m.getCentralMemberState(PN_ID)).kind).not.toBe("info");
    delete process.env.PN_SERVICE_AUTH;
    delete process.env.PN_SERVICE_SECRET;
    expect((await m.getCentralMemberState(PN_ID)).kind).not.toBe("info");
    expect(await m.getCentralMemberInfo(PN_ID)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getValidMock).not.toHaveBeenCalled();
  });

  it("a malformed ml: id never reaches the register or the token store", async () => {
    const m = await load(answer({ workspaceId: "ws-1", apps: ["coach"] }));
    for (const bad of ["ml:", "ml:a b", "ml:" + "a".repeat(78)]) {
      expect((await m.getCentralMemberState(bad)).kind).not.toBe("info");
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getValidMock).not.toHaveBeenCalled();
  });

  it("central off → unavailable, no request", async () => {
    const m = await load(answer({ workspaceId: "ws-1", apps: ["coach"] }));
    process.env.CREDITS_CENTRAL = "off";
    expect(await m.getCentralMemberState(PN_ID)).toEqual({ kind: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getCentralMemberState — Microsoft-Konto (unverändert)", () => {
  it("asks with the Bearer token and never with the service headers, also when PulseNorth accounts are on", async () => {
    const m = await load(answer({ workspaceId: "ws-9", role: "admin", apps: [], disabled: false }));
    const s = await m.getCentralMemberState(ENTRA_OID);
    expect(s.kind).toBe("info");
    expect(getValidMock).toHaveBeenCalledWith(ENTRA_OID);

    const [c] = calls();
    expect(c.init.headers.Authorization).toBe("Bearer AT");
    expect(headerNames(c)).not.toContain("x-pn-service-secret");
    expect(headerNames(c)).not.toContain("x-pn-subject");
    expect(JSON.stringify(c.init.headers)).not.toContain(SECRET);
  });

  it("401 from the register stays unavailable (fail-soft), never denied", async () => {
    const m = await load(status(401));
    expect(await m.getCentralMemberState(ENTRA_OID)).toEqual({ kind: "unavailable" });
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("setCentralSelfProfile — Profil ins Register schreiben", () => {
  it("PulseNorth account → PUT /me/profile with the service headers", async () => {
    const m = await load(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    expect(await m.setCentralSelfProfile(PN_ID, { displayName: "Sandra" })).toBe(true);

    const [c] = calls();
    expect(c.url.endsWith("/me/profile")).toBe(true);
    expect(c.init.method).toBe("PUT");
    expect(c.init.headers["x-pn-service-secret"]).toBe(SECRET);
    expect(c.init.headers["x-pn-subject"]).toBe(PN_ID);
    expect(headerNames(c)).not.toContain("authorization");
    expect(c.init.body).toBe(JSON.stringify({ displayName: "Sandra" }));
    expect(getValidMock).not.toHaveBeenCalled();
  });

  it("Microsoft account → PUT /me/profile with the Bearer token (as before)", async () => {
    const m = await load(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    expect(await m.setCentralSelfProfile(ENTRA_OID, { avatarUrl: null })).toBe(true);

    const [c] = calls();
    expect(c.init.headers.Authorization).toBe("Bearer AT");
    expect(headerNames(c)).not.toContain("x-pn-service-secret");
    expect(headerNames(c)).not.toContain("x-pn-subject");
  });

  it("PulseNorth accounts switched off → false, no request", async () => {
    const m = await load(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    delete process.env.PN_SERVICE_SECRET;
    expect(await m.setCentralSelfProfile(PN_ID, { displayName: "Sandra" })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getValidMock).not.toHaveBeenCalled();
  });
});
