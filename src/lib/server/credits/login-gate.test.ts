import { afterEach, describe, expect, it, vi } from "vitest";
import { loginRequired, requireValidLoginEnabled } from "./login-gate";

afterEach(() => {
  delete process.env.REQUIRE_VALID_LOGIN;
  delete process.env.CREDITS_CENTRAL;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("login-gate (B26: ohne gültige Anmeldung erst neu anmelden)", () => {
  it("is on without a setting, off only for 'off'", () => {
    expect(requireValidLoginEnabled()).toBe(true);
    process.env.REQUIRE_VALID_LOGIN = "OFF";
    expect(requireValidLoginEnabled()).toBe(false);
    process.env.REQUIRE_VALID_LOGIN = "nein";
    expect(requireValidLoginEnabled()).toBe(true);
  });

  it("a valid token never requires a new login", () => {
    expect(loginRequired({ ok: true })).toBe(false);
  });

  it("a rejected or missing token requires a new login", () => {
    expect(loginRequired({ ok: false, reason: "refresh-failed" })).toBe(true);
    expect(loginRequired({ ok: false, reason: "no-token" })).toBe(true);
  });

  it("an outage (transient) does not — fail-soft stays", () => {
    expect(loginRequired({ ok: false, reason: "refresh-failed", transient: true })).toBe(false);
    expect(loginRequired({ ok: false, reason: "no-token", transient: true })).toBe(false);
  });
});

// ── getCentralMemberState: warum es keine Mitglieds-Info gibt ────────────────
describe("getCentralMemberState", () => {
  async function load(tok: unknown, fetchImpl?: () => Promise<unknown>) {
    vi.resetModules();
    process.env.CREDITS_CENTRAL = "on";
    vi.doMock("@/lib/server/credits/entra-token-store", () => ({
      getValid: vi.fn(async () => tok),
    }));
    if (fetchImpl) vi.stubGlobal("fetch", vi.fn(fetchImpl));
    return import("./member-info");
  }

  it("valid token + register answer → info", async () => {
    const m = await load({ ok: true, accessToken: "AT" }, async () => ({
      ok: true,
      json: async () => ({ workspaceId: "ws", role: "member", apps: ["coach"], disabled: true }),
    }));
    const s = await m.getCentralMemberState("oid-1");
    expect(s.kind).toBe("info");
    expect(s.kind === "info" && s.info.disabled).toBe(true);
    vi.unstubAllGlobals();
  });

  it("rejected token → login-required (vorher: Tor übersprungen)", async () => {
    const m = await load({ ok: false, reason: "refresh-failed" });
    expect((await m.getCentralMemberState("oid-2")).kind).toBe("login-required");
    expect(await m.getCentralMemberInfo("oid-2")).toBeNull();
  });

  it("no token on file → login-required", async () => {
    const m = await load({ ok: false, reason: "no-token" });
    expect((await m.getCentralMemberState("oid-3")).kind).toBe("login-required");
  });

  it("token store or Entra outage → unavailable (fail-soft)", async () => {
    const m = await load({ ok: false, reason: "no-token", transient: true });
    expect((await m.getCentralMemberState("oid-4")).kind).toBe("unavailable");
    const n = await load({ ok: false, reason: "refresh-failed", transient: true });
    expect((await n.getCentralMemberState("oid-5")).kind).toBe("unavailable");
  });

  it("register not reachable / not ok → unavailable (fail-soft)", async () => {
    const m = await load({ ok: true, accessToken: "AT" }, async () => ({ ok: false, status: 503 }));
    expect((await m.getCentralMemberState("oid-6")).kind).toBe("unavailable");
    vi.unstubAllGlobals();
    const n = await load({ ok: true, accessToken: "AT" }, async () => {
      throw new Error("network");
    });
    expect((await n.getCentralMemberState("oid-7")).kind).toBe("unavailable");
    vi.unstubAllGlobals();
  });

  it("central off → unavailable, never login-required", async () => {
    const m = await load({ ok: false, reason: "refresh-failed" });
    process.env.CREDITS_CENTRAL = "off";
    expect((await m.getCentralMemberState("oid-8")).kind).toBe("unavailable");
  });
});
