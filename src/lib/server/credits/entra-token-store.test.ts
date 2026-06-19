import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getValid,
  put,
  io,
  _reset,
  tokenEndpoint,
  type StoredEntraToken,
} from "./entra-token-store";

/**
 * Rotations-Test (Blueprint §7) — beweist den Fix OHNE 1-h-Warten:
 * RT0→RT1→RT2 schreitet fort, Single-Flight (genau ein Refresh-Call),
 * fail-closed, Persist-Fehler ueberlebt im Cache, no-token, Read-Fehler.
 *
 * Stubs: io.read/io.write → in-memory Map; globalThis.fetch → konfigurierbar.
 */

const OID = "oid-test-1";
const now = () => Date.now();

let store: Record<string, StoredEntraToken>;
let fetchBodies: URLSearchParams[];
const origFetch = globalThis.fetch;
const origRead = io.read;
const origWrite = io.write;

/** Setzt fetch so, dass es nacheinander die uebergebenen Antworten liefert. */
function setFetch(responses: Array<{ ok: boolean; status?: number; json?: any }>) {
  fetchBodies = []; // frische Body-Erfassung je setFetch (fetchBodies[0] = erster Refresh danach)
  let i = 0;
  globalThis.fetch = vi.fn(async (_url: any, init: any) => {
    fetchBodies.push(init?.body as URLSearchParams);
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 400),
      json: async () => r.json ?? {},
    } as any;
  }) as any;
}

beforeEach(() => {
  _reset();
  store = {};
  fetchBodies = [];
  io.read = async (oid: string) => store[oid] ?? null;
  io.write = async (oid: string, t: StoredEntraToken) => {
    store[oid] = { ...t };
  };
});

afterEach(() => {
  globalThis.fetch = origFetch;
  io.read = origRead;
  io.write = origWrite;
  vi.restoreAllMocks();
});

describe("entra-token-store: Rotation", () => {
  it("1) Rotation schreitet fort: RT0→RT1→RT2, jeder Refresh nutzt den NEUESTEN RT", async () => {
    // RT0 abgelaufen → Refresh loest RT0 ein, persistiert RT1
    store[OID] = { accessToken: "AT0", refreshToken: "RT0", accessTokenExpires: now() - 1000 };
    setFetch([{ ok: true, json: { access_token: "AT1", refresh_token: "RT1", expires_in: 3600 } }]);

    const r1 = await getValid(OID);
    expect(r1.ok && r1.accessToken).toBe("AT1");
    expect(fetchBodies[0].get("refresh_token")).toBe("RT0"); // RT0 eingeloest
    expect(store[OID].refreshToken).toBe("RT1"); // ROTATION persistiert

    // zweiter Refresh: Cache leeren, RT1 abgelaufen → nutzt RT1 (NICHT erneut RT0)
    _reset();
    store[OID] = { accessToken: "AT1", refreshToken: "RT1", accessTokenExpires: now() - 1000 };
    setFetch([{ ok: true, json: { access_token: "AT2", refresh_token: "RT2", expires_in: 3600 } }]);

    const r2 = await getValid(OID);
    expect(r2.ok && r2.accessToken).toBe("AT2");
    expect(fetchBodies[0].get("refresh_token")).toBe("RT1"); // RT1, nicht RT0
    expect(store[OID].refreshToken).toBe("RT2");
  });

  it("2) Single-Flight: zwei gleichzeitige getValid → GENAU ein Refresh-Call", async () => {
    store[OID] = { accessToken: "ATx", refreshToken: "RTx", accessTokenExpires: now() - 1000 };
    setFetch([{ ok: true, json: { access_token: "ATsf", refresh_token: "RTsf", expires_in: 3600 } }]);

    const [a, b] = await Promise.all([getValid(OID), getValid(OID)]);
    expect((globalThis.fetch as any).mock.calls.length).toBe(1); // KEIN RT-Doppel-Redeem
    expect(a.ok && a.accessToken).toBe("ATsf");
    expect(b.ok && b.accessToken).toBe("ATsf");
  });

  it("3) fail-closed: Refresh !ok → refresh-failed + error im Store, KEIN access_token", async () => {
    store[OID] = { accessToken: "AT", refreshToken: "RT", accessTokenExpires: now() - 1000 };
    setFetch([{ ok: false, status: 400, json: { error: "invalid_grant" } }]);

    const r = await getValid(OID);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("refresh-failed");
    expect(store[OID].error).toBe("refresh-failed");
    expect(store[OID].accessToken).toBe("");
  });

  it("4) Persist-Fehler ueberlebt im Cache: write wirft → trotzdem ok, Folge-getValid nutzt Cache", async () => {
    store[OID] = { accessToken: "AT", refreshToken: "RT", accessTokenExpires: now() - 1000 };
    setFetch([{ ok: true, json: { access_token: "AT1", refresh_token: "RT1", expires_in: 3600 } }]);
    io.write = async () => {
      throw new Error("cosmos down");
    };

    const r1 = await getValid(OID);
    expect(r1.ok && r1.accessToken).toBe("AT1"); // Refresh ok trotz Persist-Fehler

    // Folge-Aufruf: Cache haelt AT1 → KEIN erneuter Refresh (kein RT0-Re-Redeem)
    const callsBefore = (globalThis.fetch as any).mock.calls.length;
    const r2 = await getValid(OID);
    expect(r2.ok && r2.accessToken).toBe("AT1");
    expect((globalThis.fetch as any).mock.calls.length).toBe(callsBefore); // kein zusaetzlicher Call
  });

  it("5) no-token: kein Doc → no-token, KEIN Refresh-Call", async () => {
    setFetch([{ ok: true, json: { access_token: "X" } }]);
    const r = await getValid(OID);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("no-token");
    expect((globalThis.fetch as any).mock.calls.length).toBe(0);
  });

  it("6) Store-Read wirft → no-token (fail-open, kein Crash)", async () => {
    io.read = async () => {
      throw new Error("cosmos read error");
    };
    setFetch([{ ok: true, json: { access_token: "X" } }]);
    const r = await getValid(OID);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("no-token");
  });

  it("7) tokenEndpoint() leitet /oauth2/v2.0/token aus dem Issuer ab (kein hartes /common)", () => {
    const prev = process.env.ENTRA_ISSUER;
    process.env.ENTRA_ISSUER = "https://login.microsoftonline.com/my-tenant-id/v2.0";
    expect(tokenEndpoint()).toBe(
      "https://login.microsoftonline.com/my-tenant-id/oauth2/v2.0/token"
    );
    if (prev === undefined) delete process.env.ENTRA_ISSUER;
    else process.env.ENTRA_ISSUER = prev;
  });

  it("8) Cache-Fast-Path: gueltiges Token im Cache → KEIN Refresh, KEIN Store-Read", async () => {
    setFetch([{ ok: true, json: { access_token: "NOPE" } }]);
    let reads = 0;
    io.read = async (oid: string) => {
      reads++;
      return store[oid] ?? null;
    };
    // put seedet Cache mit gueltigem Token
    await put(OID, { accessToken: "ATfresh", refreshToken: "RTfresh", accessTokenExpires: now() + 3600_000 });
    const readsAfterPut = reads;

    const r = await getValid(OID);
    expect(r.ok && r.accessToken).toBe("ATfresh");
    expect((globalThis.fetch as any).mock.calls.length).toBe(0); // kein Refresh
    expect(reads).toBe(readsAfterPut); // kein Store-Read (Fast-Path)
  });
});
