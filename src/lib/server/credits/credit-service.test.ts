import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * credit-service mit zwei Ausweisen (Anmeldung-Umbau Schritt 2c, 02.10.2026): JEDER Abruf
 * des Credit-Dienstes im Namen des Nutzers — Workspace auflösen, verbrauchen, erstatten,
 * Saldo lesen — zeigt den Ausweis aus cs-credential. Ein PulseNorth-Konto (Kennung "ml:…")
 * den Dienst-Ausweis, ein Microsoft-Konto wie bisher sein Entra-Token.
 * auth(), Token-Speicher und fetch sind gemockt (kein Cosmos, kein Netz).
 */
const authMock = vi.fn();
const getValidMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/server/credits/entra-token-store", () => ({
  getValid: (oid: string) => getValidMock(oid),
}));

import { centralRefund, centralReserve, centralWalletStatus } from "./credit-service";

const SECRET = "s3cr3t-".padEnd(40, "x");
const PN_ID = "ml:0b1c2d3e-0000-4000-8000-000000000001";
const ENTRA_OID = "11111111-2222-4333-8444-555555555555";

type Reply = { status: number; body?: unknown };
type Call = { method: string; path: string; headers: Record<string, string>; body: unknown };

let fetchMock: ReturnType<typeof vi.fn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

/** fetch liefert der Reihe nach die Antworten; die letzte gilt für alle weiteren Abrufe. */
function setFetch(...replies: Array<Reply | Error>) {
  let i = 0;
  fetchMock = vi.fn(async () => {
    const r = replies[Math.min(i, replies.length - 1)];
    i++;
    if (r instanceof Error) throw r;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body ?? {},
      text: async () => JSON.stringify(r.body ?? {}),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
}

function calls(): Call[] {
  return fetchMock.mock.calls.map(([url, init]) => {
    const i = init as { method: string; headers: Record<string, string>; body?: string };
    return {
      method: i.method,
      path: String(url).replace(/^https?:\/\/[^/]+(\/api)?/, ""),
      headers: i.headers,
      body: i.body ? JSON.parse(i.body) : undefined,
    };
  });
}

const names = (c: Call) => Object.keys(c.headers).map((k) => k.toLowerCase());

function expectServiceCredential(c: Call) {
  expect(c.headers["x-pn-service-secret"]).toBe(SECRET);
  expect(c.headers["x-pn-subject"]).toBe(PN_ID);
  expect(names(c)).not.toContain("authorization");
}

function expectBearer(c: Call) {
  expect(c.headers.Authorization).toBe("Bearer AT");
  expect(names(c)).not.toContain("x-pn-service-secret");
  expect(names(c)).not.toContain("x-pn-subject");
}

const logged = () => errorSpy.mock.calls.map((args) => args.map(String).join(" ")).join("\n");

const asPn = () => authMock.mockResolvedValue({ user: { id: PN_ID, oid: PN_ID, email: "s@example.com" } });
const asMicrosoft = () =>
  authMock.mockResolvedValue({ user: { id: "sub-1", oid: ENTRA_OID, email: "a@example.com" } });

beforeEach(() => {
  authMock.mockReset();
  getValidMock.mockReset();
  getValidMock.mockResolvedValue({ ok: true, accessToken: "AT" });
  process.env.PN_SERVICE_SECRET = SECRET;
  delete process.env.PN_SERVICE_AUTH;
  delete process.env.REQUIRE_VALID_LOGIN;
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.PN_SERVICE_SECRET;
  delete process.env.PN_SERVICE_AUTH;
  delete process.env.REQUIRE_VALID_LOGIN;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PulseNorth-Konto — jeder Abruf mit dem Dienst-Ausweis", () => {
  beforeEach(asPn);

  it("centralReserve: resolve + spend carry the service headers, never a Bearer", async () => {
    // Eigenes Unternehmen eines PulseNorth-Kontos: der Workspace trägt die Kennung selbst.
    setFetch({ status: 200, body: { workspaceId: PN_ID } }, { status: 200, body: { transactionId: "tx-1", balance: 4 } });
    const r = await centralReserve({ runId: "run-12345678" });
    expect(r).toEqual({ ok: true, workspaceId: PN_ID, transactionId: "tx-1", balance: 4 });

    const [resolve, spend] = calls();
    expect(resolve).toMatchObject({ method: "GET", path: "/resolve-workspace" });
    expect(spend.method).toBe("POST");
    // Der Doppelpunkt der Kennung steht kodiert im Pfad.
    expect(spend.path).toBe(`/workspaces/${encodeURIComponent(PN_ID)}/credits/spend`);
    expect(spend.path).toContain("ml%3A");
    expect(spend.headers["Idempotency-Key"]).toBe("spend:run-12345678");
    expect(spend.body).toEqual({ amount: 1, description: "coach:consume:run-12345678" });
    expectServiceCredential(resolve);
    expectServiceCredential(spend);
    expect(getValidMock).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it("centralReserve: 402 → insufficient (paywall), as for Microsoft accounts", async () => {
    setFetch({ status: 200, body: { workspaceId: "ws-1" } }, { status: 402, body: { error: "insufficient" } });
    expect(await centralReserve({ runId: "run-12345678" })).toEqual({
      ok: false,
      reason: "insufficient",
      workspaceId: "ws-1",
    });
  });

  it("centralRefund: resolve + refund carry the service headers", async () => {
    setFetch({ status: 200, body: { workspaceId: "ws-1" } }, { status: 200, body: { balance: 5 } });
    const r = await centralRefund({
      amount: 1,
      description: "coach:refund_user_delete",
      spendTransactionId: "tx-1",
      idempotencyKey: "refund:run-12345678",
    });
    expect(r).toEqual({ ok: true });

    const [resolve, refund] = calls();
    expect(refund).toMatchObject({ method: "POST", path: "/workspaces/ws-1/credits/refund" });
    expect(refund.body).toEqual({ amount: 1, description: "coach:refund_user_delete", spendTransactionId: "tx-1" });
    expectServiceCredential(resolve);
    expectServiceCredential(refund);
    expect(getValidMock).not.toHaveBeenCalled();
  });

  it("centralWalletStatus: resolve + balance carry the service headers", async () => {
    setFetch({ status: 200, body: { workspaceId: "ws-1" } }, { status: 200, body: { credits: 12 } });
    expect(await centralWalletStatus()).toEqual({ state: "active", workspaceId: "ws-1", credits: 12 });

    const [resolve, balance] = calls();
    expect(balance).toMatchObject({ method: "GET", path: "/workspaces/ws-1/credits" });
    expectServiceCredential(resolve);
    expectServiceCredential(balance);
    expect(getValidMock).not.toHaveBeenCalled();
  });

  it("centralWalletStatus: 401 → inert, never „Sitzung abgelaufen“", async () => {
    setFetch({ status: 401, body: { error: "unauthorized" } });
    expect(await centralWalletStatus()).toEqual({ state: "inert" });
  });

  it("switched off → no request, no token store, and never „Sitzung abgelaufen“", async () => {
    setFetch({ status: 200, body: { workspaceId: "ws-1" } });
    process.env.PN_SERVICE_AUTH = "off";
    expect(await centralWalletStatus()).toEqual({ state: "inert" });
    expect(await centralReserve({ runId: "run-12345678" })).toEqual({ ok: false, reason: "no_token" });
    expect(
      await centralRefund({ amount: 1, description: "d", spendTransactionId: "tx", idempotencyKey: "k" })
    ).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getValidMock).not.toHaveBeenCalled();
  });

  it("failures are logged and returned without the secret", async () => {
    // Dienst antwortet mit 500 und gibt (schlimmster Fall) die Kopfzeilen NICHT zurück.
    setFetch({ status: 500, body: { error: "internal_error" } });
    const a = await centralReserve({ runId: "run-12345678" });
    expect(a).toEqual({ ok: false, reason: "error", status: 500 });

    // Netzfehler beim Abruf.
    setFetch(new Error("ECONNRESET"));
    const b = await centralReserve({ runId: "run-12345678" });
    expect(b).toEqual({ ok: false, reason: "error", status: undefined });
    const c = await centralRefund({ amount: 1, description: "d", spendTransactionId: "tx", idempotencyKey: "k" });
    expect(c).toEqual({ ok: false });
    expect(await centralWalletStatus()).toEqual({ state: "inert" });

    expect(errorSpy).toHaveBeenCalled();
    expect(logged()).toContain("credit-service/centralReserve/resolve");
    expect(logged()).not.toContain(SECRET);
    expect(JSON.stringify([a, b, c])).not.toContain(SECRET);
  });
});

describe("Microsoft-Konto — unverändert mit dem Entra-Token", () => {
  beforeEach(asMicrosoft);

  it("centralReserve / centralRefund / centralWalletStatus: Bearer on every call, never the service headers", async () => {
    const expectAllBearer = (count: number) => {
      expect(calls()).toHaveLength(count);
      for (const c of calls()) {
        expectBearer(c);
        expect(JSON.stringify(c.headers)).not.toContain(SECRET);
      }
    };

    setFetch({ status: 200, body: { workspaceId: "ws-9" } }, { status: 200, body: { transactionId: "tx-9", balance: 1 } });
    expect(await centralReserve({ runId: "run-12345678" })).toEqual({
      ok: true,
      workspaceId: "ws-9",
      transactionId: "tx-9",
      balance: 1,
    });
    expectAllBearer(2);

    setFetch({ status: 200, body: { workspaceId: "ws-9" } }, { status: 200, body: {} });
    expect(
      await centralRefund({ amount: 1, description: "d", spendTransactionId: "tx-9", idempotencyKey: "refund:run" })
    ).toEqual({ ok: true });
    expectAllBearer(2);

    setFetch({ status: 200, body: { workspaceId: "ws-9" } }, { status: 200, body: { credits: 3 } });
    expect(await centralWalletStatus()).toEqual({ state: "active", workspaceId: "ws-9", credits: 3 });
    expectAllBearer(2);

    expect(getValidMock).toHaveBeenCalledWith(ENTRA_OID);
    expect(getValidMock).toHaveBeenCalledTimes(3);
  });

  it("centralWalletStatus: 401 → expired (Neu anmelden), as before", async () => {
    setFetch({ status: 401, body: { error: "unauthorized" } });
    expect(await centralWalletStatus()).toEqual({ state: "expired" });
  });

  it("no usable token → expired; an outage of the token store → inert (B26, as before)", async () => {
    setFetch({ status: 200, body: { workspaceId: "ws-9" } });
    getValidMock.mockResolvedValue({ ok: false, reason: "refresh-failed" });
    expect(await centralWalletStatus()).toEqual({ state: "expired" });
    expect(await centralReserve({ runId: "run-12345678" })).toEqual({ ok: false, reason: "no_token" });

    getValidMock.mockResolvedValue({ ok: false, reason: "no-token" });
    expect(await centralWalletStatus()).toEqual({ state: "expired" });

    getValidMock.mockResolvedValue({ ok: false, reason: "no-token", transient: true });
    expect(await centralWalletStatus()).toEqual({ state: "inert" });

    // Rückweg REQUIRE_VALID_LOGIN=off: nur ein abgelehntes Token gilt als abgelaufen.
    process.env.REQUIRE_VALID_LOGIN = "off";
    getValidMock.mockResolvedValue({ ok: false, reason: "no-token" });
    expect(await centralWalletStatus()).toEqual({ state: "inert" });
    getValidMock.mockResolvedValue({ ok: false, reason: "refresh-failed" });
    expect(await centralWalletStatus()).toEqual({ state: "expired" });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("ohne Sitzung", () => {
  it("no session / auth() throws → no request", async () => {
    setFetch({ status: 200, body: { workspaceId: "ws-1" } });
    authMock.mockResolvedValue(null);
    expect(await centralReserve({ runId: "run-12345678" })).toEqual({ ok: false, reason: "no_token" });
    authMock.mockRejectedValue(new Error("no request scope"));
    expect(await centralReserve({ runId: "run-12345678" })).toEqual({ ok: false, reason: "no_token" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getValidMock).not.toHaveBeenCalled();
  });
});
