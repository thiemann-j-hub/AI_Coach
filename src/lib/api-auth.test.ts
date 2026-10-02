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
  // PulseNorth-Konten sind ohne Geheimnis aus — der Ausgangszustand aller Tests hier.
  delete process.env.PN_SERVICE_SECRET;
  delete process.env.PN_SERVICE_AUTH;
});

afterEach(() => {
  delete process.env.REQUIRE_VALID_LOGIN;
  delete process.env.PN_SERVICE_SECRET;
  delete process.env.PN_SERVICE_AUTH;
  delete process.env.MAIL_LINK_PN_ONLY;
});

describe("requireAuth — Sitzung aus einem Mail-Link", () => {
  it("zählt mit einer Microsoft-Kennung nicht: 401, Register nicht gefragt", async () => {
    authMock.mockResolvedValue({ user: { id: OID, email: "a@example.com", oid: OID, provider: "magic-link" } });
    const res = await requireAuth(req());
    expect((res as Response).status).toBe(401);
    expect((await body(res)).code).toBe("UNAUTHORIZED");
    expect(stateMock).not.toHaveBeenCalled();
  });

  it("hat einen Rückweg (MAIL_LINK_PN_ONLY=off): dann wie eine Microsoft-Sitzung", async () => {
    process.env.MAIL_LINK_PN_ONLY = "off";
    authMock.mockResolvedValue({ user: { id: OID, email: "a@example.com", oid: OID, provider: "magic-link" } });
    stateMock.mockResolvedValue(info());
    const res = await requireAuth(req());
    expect(res).toMatchObject({ uid: OID, oid: OID });
  });

  it("gilt nicht für Microsoft-Sitzungen ohne Anmeldeweg und nicht für ml:-Kennungen", async () => {
    stateMock.mockResolvedValue(info());
    expect(await requireAuth(req())).toMatchObject({ oid: OID });
    process.env.PN_SERVICE_SECRET = "test-dienst-geheimnis-0123456789-abcdef";
    authMock.mockResolvedValue({ user: { id: "ml:konto-1", email: "a@example.com", oid: "ml:konto-1", provider: "magic-link" } });
    expect(await requireAuth(req())).toMatchObject({ uid: "ml:konto-1", oid: "ml:konto-1" });
  });
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

/**
 * Anmeldung-Umbau Schritt 2c (02.10.2026): PulseNorth-Konten (Anmeldung ohne Microsoft,
 * Kennung "ml:…") gehen durch dasselbe zentrale Tor — aber nie fail-soft. Hinein kommt nur,
 * wem das Register es ausdrücklich bestätigt. Schalter aus = die alte Abweisung (B12).
 */
const SECRET = "s3cr3t-".padEnd(40, "x");
const PN_ID = "ml:0b1c2d3e-0000-4000-8000-000000000001";
/** So stellt der Hub die Sitzung aus: uid = oid = Kennung. */
const pnSession = (over: Record<string, unknown> = {}) => ({
  user: { id: PN_ID, oid: PN_ID, email: "sandra@example.com", name: "Sandra", ...over },
});

async function refusal(res: unknown) {
  expect(res).toBeInstanceOf(Response);
  return { status: (res as Response).status, body: await body(res) };
}

describe("requireAuth — PulseNorth-Konto", () => {
  beforeEach(() => {
    process.env.PN_SERVICE_SECRET = SECRET;
    authMock.mockResolvedValue(pnSession());
  });

  it("register confirms member, active, Coach enabled → passes with the ml: id as uid and oid", async () => {
    stateMock.mockResolvedValue(info({ apps: ["jobmap", "coach"] }));
    const res = await requireAuth(req());
    expect(res).toMatchObject({ uid: PN_ID, oid: PN_ID, email: "sandra@example.com" });
    expect(stateMock).toHaveBeenCalledTimes(1);
    expect(stateMock).toHaveBeenCalledWith(PN_ID);
    // Das Geheimnis verlässt den Server nie über das Tor.
    expect(JSON.stringify(res)).not.toContain(SECRET);
  });

  it("without Coach → 403 APP_NOT_ENABLED, word for word like a Microsoft member without Coach", async () => {
    stateMock.mockResolvedValue(info({ apps: ["jobmap"] }));
    const pn = await refusal(await requireAuth(req()));
    expect(pn.status).toBe(403);
    expect(pn.body.code).toBe("APP_NOT_ENABLED");

    authMock.mockResolvedValue(session());
    const microsoft = await refusal(await requireAuth(req()));
    expect(pn).toEqual(microsoft);
  });

  it("no app at all (\"none\") or an empty list → 403; an empty list never means „all apps“ here", async () => {
    for (const apps of [["none"], [], ["studio", "jobmap"], ["Coach"], ["coach "]]) {
      stateMock.mockResolvedValue(info({ apps }));
      const r = await refusal(await requireAuth(req()));
      expect(r.status).toBe(403);
      expect(r.body.code).toBe("APP_NOT_ENABLED");
    }
  });

  it("deactivated → 403 ACCOUNT_DISABLED, word for word like a Microsoft member", async () => {
    stateMock.mockResolvedValue(info({ disabled: true }));
    const pn = await refusal(await requireAuth(req()));
    expect(pn.status).toBe(403);
    expect(pn.body.code).toBe("ACCOUNT_DISABLED");

    authMock.mockResolvedValue(session());
    const microsoft = await refusal(await requireAuth(req()));
    expect(pn).toEqual(microsoft);
  });

  it("register does not know the account (401 → denied) → 403, and no „neu anmelden“", async () => {
    stateMock.mockResolvedValue({ kind: "denied" });
    const r = await refusal(await requireAuth(req()));
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("APP_NOT_ENABLED");
  });

  it("register not reachable → 503 CENTRAL_UNAVAILABLE (fail closed), whatever the options say", async () => {
    stateMock.mockResolvedValue({ kind: "unavailable" });
    const r = await refusal(await requireAuth(req()));
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("CENTRAL_UNAVAILABLE");

    expect((await refusal(await requireAuth(req(), { allowExpiredLogin: true }))).status).toBe(503);
    process.env.REQUIRE_VALID_LOGIN = "off";
    expect((await refusal(await requireAuth(req()))).status).toBe(503);
    expect((await refusal(await requireAuth(req(), { allowExpiredLogin: true }))).status).toBe(503);
  });

  it("no credential for the lookup (login-required) → 403, never CENTRAL_REAUTH and never let in", async () => {
    stateMock.mockResolvedValue({ kind: "login-required" });
    for (const opts of [{}, { allowExpiredLogin: true }]) {
      const r = await refusal(await requireAuth(req(), opts));
      expect(r.status).toBe(403);
      expect(r.body.code).toBe("APP_NOT_ENABLED");
    }
    process.env.REQUIRE_VALID_LOGIN = "off";
    const r = await refusal(await requireAuth(req(), { allowExpiredLogin: true }));
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("APP_NOT_ENABLED");
  });

  it("Rückweg: switch off, no secret or a short secret → the old rejection, register not asked", async () => {
    stateMock.mockResolvedValue(info());

    process.env.PN_SERVICE_AUTH = "off";
    const off = await refusal(await requireAuth(req()));
    expect(off.status).toBe(403);
    expect(off.body.code).toBe("APP_NOT_ENABLED");

    delete process.env.PN_SERVICE_AUTH;
    delete process.env.PN_SERVICE_SECRET;
    expect(await refusal(await requireAuth(req()))).toEqual(off);

    process.env.PN_SERVICE_SECRET = "too-short";
    expect(await refusal(await requireAuth(req()))).toEqual(off);

    expect(stateMock).not.toHaveBeenCalled();
  });

  it("the session must carry the ONE valid id in uid and oid — otherwise 403, register not asked", async () => {
    stateMock.mockResolvedValue(info());
    const other = "ml:ffffffff-0000-4000-8000-00000000000f";
    const broken: Array<Record<string, unknown>> = [
      { id: PN_ID, oid: OID }, // uid PulseNorth, oid Microsoft
      { id: "sub-1", oid: PN_ID }, // uid Microsoft, oid PulseNorth
      { id: PN_ID, oid: undefined }, // keine oid
      { id: PN_ID, oid: other }, // zwei verschiedene Kennungen
      { id: "ml:", oid: "ml:" }, // nur das Präfix
      { id: "ml:a b", oid: "ml:a b" }, // Leerzeichen
      { id: "ml:" + "a".repeat(78), oid: "ml:" + "a".repeat(78) }, // zu lang
    ];
    for (const over of broken) {
      authMock.mockResolvedValue(pnSession(over));
      const r = await refusal(await requireAuth(req()));
      expect(r.status).toBe(403);
      expect(r.body.code).toBe("APP_NOT_ENABLED");
    }
    expect(stateMock).not.toHaveBeenCalled();
  });

  it("what the Hub froze into the JWT at login never counts (mlRole, mlApps, mlWorkspaceId)", async () => {
    authMock.mockResolvedValue(
      pnSession({ provider: "magic-link", mlRole: "admin", mlApps: ["coach"], mlWorkspaceId: "ws" })
    );

    stateMock.mockResolvedValue(info({ apps: ["none"], role: "member" }));
    expect((await refusal(await requireAuth(req()))).body.code).toBe("APP_NOT_ENABLED");

    stateMock.mockResolvedValue(info({ disabled: true }));
    expect((await refusal(await requireAuth(req()))).body.code).toBe("ACCOUNT_DISABLED");

    stateMock.mockResolvedValue({ kind: "unavailable" });
    expect((await refusal(await requireAuth(req()))).status).toBe(503);

    stateMock.mockResolvedValue({ kind: "denied" });
    expect((await refusal(await requireAuth(req()))).status).toBe(403);
  });
});

describe("requireAuth — Microsoft-Konto bleibt unverändert, wenn PulseNorth-Konten eingeschaltet sind", () => {
  beforeEach(() => {
    process.env.PN_SERVICE_SECRET = SECRET;
  });

  it("outage → still fail-soft; empty app list → still passes", async () => {
    stateMock.mockResolvedValue({ kind: "unavailable" });
    expect(await requireAuth(req())).toMatchObject({ uid: "sub-1", oid: OID });
    stateMock.mockResolvedValue(info({ apps: [] }));
    expect(await requireAuth(req())).toMatchObject({ uid: "sub-1", oid: OID });
    expect(stateMock).toHaveBeenCalledWith(OID);
  });

  it("login required → still 401 CENTRAL_REAUTH; allowExpiredLogin and the Rückweg still open the gate", async () => {
    stateMock.mockResolvedValue({ kind: "login-required" });
    const r = await refusal(await requireAuth(req()));
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("CENTRAL_REAUTH");
    expect(await requireAuth(req(), { allowExpiredLogin: true })).toMatchObject({ uid: "sub-1" });
    process.env.REQUIRE_VALID_LOGIN = "off";
    expect(await requireAuth(req())).toMatchObject({ uid: "sub-1" });
  });

  it("no oid in the session → passes without asking the register, as before", async () => {
    authMock.mockResolvedValue(session(null));
    expect(await requireAuth(req())).toMatchObject({ uid: "sub-1", oid: null });
    expect(stateMock).not.toHaveBeenCalled();
  });
});
