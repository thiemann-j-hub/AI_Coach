import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * requireAuth — das Tor aller Coach-API-Routen. Prüft B26 (02.10.2026): ohne gültiges
 * Entra-Token erst neu anmelden, statt das zentrale Tor zu überspringen.
 * auth() und die Register-Auskunft sind gemockt; getestet wird nur die Entscheidung.
 */
const authMock = vi.fn();
const stateMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/server/credits/member-info", () => ({
  getCentralMemberState: (oid: string) => stateMock(oid),
}));

import { requireAuth } from "./api-auth";
import { getDictionary } from "@/i18n/dictionaries";

const OID = "11111111-2222-4333-8444-555555555555";
const session = (oid: string | null = OID) => ({ user: { id: "sub-1", email: "a@example.com", oid } });
const req = (locale = "de") => new Request("https://app.pulsenorth.ai/coach/api/x", { headers: { "x-locale": locale } });
const info = (over: Record<string, unknown> = {}) => ({
  kind: "info",
  info: { workspaceId: "ws", role: "member", apps: ["coach"], disabled: false, avatarUrl: null, displayName: null, ...over },
});

async function body(res: unknown) {
  return (res as Response).json() as Promise<{ code?: string; error?: string }>;
}

beforeEach(() => {
  authMock.mockReset();
  stateMock.mockReset();
  authMock.mockResolvedValue(session());
});

afterEach(() => {
  delete process.env.REQUIRE_VALID_LOGIN;
});

describe("requireAuth", () => {
  it("no session → 401 UNAUTHORIZED", async () => {
    authMock.mockResolvedValue(null);
    const res = await requireAuth(req());
    expect((res as Response).status).toBe(401);
    expect((await body(res)).code).toBe("UNAUTHORIZED");
    expect(stateMock).not.toHaveBeenCalled();
  });

  it("login required → 401 CENTRAL_REAUTH with the localized text", async () => {
    stateMock.mockResolvedValue({ kind: "login-required" });
    const res = await requireAuth(req("de"));
    expect((res as Response).status).toBe(401);
    const b = await body(res);
    expect(b.code).toBe("CENTRAL_REAUTH");
    expect(b.error).toBe(getDictionary("de").api.sessionExpired);
    expect(b.error).toMatch(/^Sitzung abgelaufen/);

    const en = await requireAuth(req("en"));
    expect((await body(en)).error).toBe(getDictionary("en").api.sessionExpired);
  });

  it("login required, but the route reports the expiry itself (allowExpiredLogin) → passes", async () => {
    stateMock.mockResolvedValue({ kind: "login-required" });
    const res = await requireAuth(req(), { allowExpiredLogin: true });
    expect(res).toMatchObject({ uid: "sub-1", oid: OID });
  });

  it("Rückweg REQUIRE_VALID_LOGIN=off → old behaviour, the gate is skipped", async () => {
    process.env.REQUIRE_VALID_LOGIN = "off";
    stateMock.mockResolvedValue({ kind: "login-required" });
    expect(await requireAuth(req())).toMatchObject({ uid: "sub-1" });
  });

  it("outage (unavailable) → fail-soft, passes as before", async () => {
    stateMock.mockResolvedValue({ kind: "unavailable" });
    expect(await requireAuth(req())).toMatchObject({ uid: "sub-1" });
  });

  it("deactivated member → 403 ACCOUNT_DISABLED", async () => {
    stateMock.mockResolvedValue(info({ disabled: true }));
    const res = await requireAuth(req());
    expect((res as Response).status).toBe(403);
    expect((await body(res)).code).toBe("ACCOUNT_DISABLED");
  });

  it("Coach not enabled → 403 APP_NOT_ENABLED", async () => {
    stateMock.mockResolvedValue(info({ apps: ["jobmap"] }));
    const res = await requireAuth(req());
    expect((res as Response).status).toBe(403);
    expect((await body(res)).code).toBe("APP_NOT_ENABLED");
  });

  it("active member with Coach access → passes", async () => {
    stateMock.mockResolvedValue(info());
    expect(await requireAuth(req())).toMatchObject({ uid: "sub-1", oid: OID });
  });

  it("magic-link learner → 403 without asking the register", async () => {
    authMock.mockResolvedValue(session("ml:0b1c2d3e-0000-4000-8000-000000000001"));
    const res = await requireAuth(req());
    expect((res as Response).status).toBe(403);
    expect((await body(res)).code).toBe("APP_NOT_ENABLED");
    expect(stateMock).not.toHaveBeenCalled();
  });
});
