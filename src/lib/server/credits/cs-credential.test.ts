import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * cs-credential — der EINE Ausweis-Helfer für den Credit-Dienst (Anmeldung-Umbau Schritt 2c,
 * 02.10.2026). Geprüft werden die Kennungs-Regel, der Rückweg-Schalter, das Geheimnis, die
 * Form der Kopfzeilen und die Trennung der beiden Ausweise:
 *   - eine "ml:"-Kennung bekommt nie ein Bearer-Token und erreicht nie den Token-Speicher,
 *   - eine andere Kennung bekommt nie die Dienst-Kopfzeilen.
 * Der Token-Speicher ist gemockt (kein Cosmos, kein Netz).
 */
const getValidMock = vi.fn();
vi.mock("@/lib/server/credits/entra-token-store", () => ({
  getValid: (oid: string) => getValidMock(oid),
}));

import {
  PN_MEMBER_PREFIX,
  csAuthHeaders,
  csCredentialFor,
  isPnMemberId,
  pnAccountsEnabled,
  pnServiceSecret,
} from "./cs-credential";
import { isMagicLinkOid } from "@/lib/magic-link-oid";

const SECRET = "s3cr3t-".padEnd(40, "x"); // 40 Zeichen, nur sichtbares ASCII
const PN_ID = "ml:0b1c2d3e-0000-4000-8000-000000000001";
const ENTRA_OID = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  getValidMock.mockReset();
  delete process.env.PN_SERVICE_SECRET;
  delete process.env.PN_SERVICE_AUTH;
});

afterEach(() => {
  delete process.env.PN_SERVICE_SECRET;
  delete process.env.PN_SERVICE_AUTH;
});

describe("isPnMemberId — Kennung eines PulseNorth-Kontos", () => {
  it("accepts the ids the credit service issues (ml:<uuid>)", () => {
    expect(isPnMemberId(PN_ID)).toBe(true);
    expect(isPnMemberId("ml:a")).toBe(true);
  });

  it("rejects Microsoft ids and look-alikes", () => {
    expect(isPnMemberId(ENTRA_OID)).toBe(false);
    expect(isPnMemberId("xml:abc")).toBe(false);
    expect(isPnMemberId("ML:abc")).toBe(false);
    expect(isPnMemberId(" ml:abc")).toBe(false);
  });

  it("rejects empty, bare prefix, whitespace, too long and non-strings", () => {
    expect(isPnMemberId("")).toBe(false);
    expect(isPnMemberId("ml:")).toBe(false);
    expect(isPnMemberId("ml:a b")).toBe(false);
    expect(isPnMemberId("ml:abc\n")).toBe(false);
    expect(isPnMemberId("ml:abc\tdef")).toBe(false);
    expect(isPnMemberId("ml:" + "a".repeat(77))).toBe(true); // genau 80 Zeichen
    expect(isPnMemberId("ml:" + "a".repeat(78))).toBe(false); // 81 Zeichen
    expect(isPnMemberId(null)).toBe(false);
    expect(isPnMemberId(undefined)).toBe(false);
    expect(isPnMemberId(42)).toBe(false);
    expect(isPnMemberId({ id: PN_ID })).toBe(false);
  });

  it("uses the same prefix as the client-safe check (magic-link-oid)", () => {
    expect(PN_MEMBER_PREFIX).toBe("ml:");
    expect(isMagicLinkOid(PN_MEMBER_PREFIX + "x")).toBe(true);
    // Alles, was die strenge Regel annimmt, erkennt auch die Präfix-Prüfung des Tors.
    expect(isMagicLinkOid(PN_ID)).toBe(true);
  });
});

describe("pnServiceSecret / pnAccountsEnabled — Schalter und Geheimnis", () => {
  it("is off without a secret (behaviour as before the change)", () => {
    expect(pnServiceSecret()).toBeNull();
    expect(pnAccountsEnabled()).toBe(false);
  });

  it("needs at least 32 characters", () => {
    process.env.PN_SERVICE_SECRET = "x".repeat(31);
    expect(pnServiceSecret()).toBeNull();
    expect(pnAccountsEnabled()).toBe(false);
    process.env.PN_SERVICE_SECRET = "x".repeat(32);
    expect(pnServiceSecret()).toBe("x".repeat(32));
    expect(pnAccountsEnabled()).toBe(true);
  });

  it("Rückweg PN_SERVICE_AUTH=off wins over a valid secret", () => {
    process.env.PN_SERVICE_SECRET = SECRET;
    expect(pnAccountsEnabled()).toBe(true);
    process.env.PN_SERVICE_AUTH = "off";
    expect(pnServiceSecret()).toBeNull();
    expect(pnAccountsEnabled()).toBe(false);
    process.env.PN_SERVICE_AUTH = "OFF";
    expect(pnAccountsEnabled()).toBe(false);
    process.env.PN_SERVICE_AUTH = "on";
    expect(pnAccountsEnabled()).toBe(true);
  });

  it("treats a secret that fetch would refuse as a header as not set", () => {
    // fetch nennt einen abgelehnten Kopfzeilen-Wert in seiner Fehlermeldung — so ein
    // Geheimnis darf gar nicht erst in eine Kopfzeile gelangen.
    for (const bad of [
      "a".repeat(20) + "\n" + "b".repeat(20),
      "a".repeat(40) + "\n",
      "a".repeat(20) + " " + "b".repeat(20),
      "a".repeat(20) + "\u0000" + "b".repeat(20),
      "a".repeat(20) + "€" + "b".repeat(20),
      "ä".repeat(40),
    ]) {
      process.env.PN_SERVICE_SECRET = bad;
      expect(pnServiceSecret()).toBeNull();
      expect(pnAccountsEnabled()).toBe(false);
    }
  });
});

describe("csCredentialFor — welcher Ausweis zu welcher Kennung", () => {
  it("no id → no-token, the token store is not asked", async () => {
    expect(await csCredentialFor(null)).toEqual({ ok: false, reason: "no-token" });
    expect(await csCredentialFor(undefined)).toEqual({ ok: false, reason: "no-token" });
    expect(await csCredentialFor("")).toEqual({ ok: false, reason: "no-token" });
    expect(await csCredentialFor(42 as unknown as string)).toEqual({ ok: false, reason: "no-token" });
    expect(getValidMock).not.toHaveBeenCalled();
  });

  it("PulseNorth id, switched on → service credential WITHOUT the secret in it", async () => {
    process.env.PN_SERVICE_SECRET = SECRET;
    const r = await csCredentialFor(PN_ID);
    expect(r).toEqual({ ok: true, credential: { kind: "pn", memberId: PN_ID } });
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(getValidMock).not.toHaveBeenCalled();
  });

  it("PulseNorth id, switched off / no secret / short secret → no-token, never the token store", async () => {
    expect(await csCredentialFor(PN_ID)).toEqual({ ok: false, reason: "no-token" });
    process.env.PN_SERVICE_SECRET = "too-short";
    expect(await csCredentialFor(PN_ID)).toEqual({ ok: false, reason: "no-token" });
    process.env.PN_SERVICE_SECRET = SECRET;
    process.env.PN_SERVICE_AUTH = "off";
    expect(await csCredentialFor(PN_ID)).toEqual({ ok: false, reason: "no-token" });
    expect(getValidMock).not.toHaveBeenCalled();
  });

  it("anything starting with ml: that is not a valid id → no-token, never the token store", async () => {
    process.env.PN_SERVICE_SECRET = SECRET;
    getValidMock.mockResolvedValue({ ok: true, accessToken: "AT" });
    for (const bad of ["ml:", "ml:a b", "ml:abc\n", "ml:" + "a".repeat(78)]) {
      expect(await csCredentialFor(bad)).toEqual({ ok: false, reason: "no-token" });
    }
    expect(getValidMock).not.toHaveBeenCalled();
  });

  it("Microsoft id → Entra token from the store, also when PulseNorth accounts are on", async () => {
    getValidMock.mockResolvedValue({ ok: true, accessToken: "AT" });
    expect(await csCredentialFor(ENTRA_OID)).toEqual({
      ok: true,
      credential: { kind: "entra", accessToken: "AT" },
    });
    process.env.PN_SERVICE_SECRET = SECRET;
    expect(await csCredentialFor(ENTRA_OID)).toEqual({
      ok: true,
      credential: { kind: "entra", accessToken: "AT" },
    });
    expect(getValidMock).toHaveBeenCalledTimes(2);
    expect(getValidMock).toHaveBeenCalledWith(ENTRA_OID);
  });

  it("Microsoft id → failures of the token store pass through, including transient", async () => {
    getValidMock.mockResolvedValueOnce({ ok: false, reason: "refresh-failed" });
    expect(await csCredentialFor(ENTRA_OID)).toEqual({ ok: false, reason: "refresh-failed" });
    getValidMock.mockResolvedValueOnce({ ok: false, reason: "no-token" });
    expect(await csCredentialFor(ENTRA_OID)).toEqual({ ok: false, reason: "no-token" });
    getValidMock.mockResolvedValueOnce({ ok: false, reason: "refresh-failed", transient: true });
    expect(await csCredentialFor(ENTRA_OID)).toEqual({
      ok: false,
      reason: "refresh-failed",
      transient: true,
    });
    getValidMock.mockResolvedValueOnce({ ok: false, reason: "no-token", transient: true });
    expect(await csCredentialFor(ENTRA_OID)).toEqual({ ok: false, reason: "no-token", transient: true });
  });
});

describe("csAuthHeaders — die eine Stelle für die Ausweis-Kopfzeilen", () => {
  it("Microsoft → exactly a Bearer header, never the service headers", () => {
    process.env.PN_SERVICE_SECRET = SECRET;
    const h = csAuthHeaders({ kind: "entra", accessToken: "AT" });
    expect(h).toEqual({ Authorization: "Bearer AT" });
    expect(JSON.stringify(h)).not.toContain(SECRET);
  });

  it("PulseNorth → exactly the two service headers, never a Bearer", () => {
    process.env.PN_SERVICE_SECRET = SECRET;
    const h = csAuthHeaders({ kind: "pn", memberId: PN_ID });
    expect(h).toEqual({ "x-pn-service-secret": SECRET, "x-pn-subject": PN_ID });
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain("authorization");
  });

  it("PulseNorth without a usable secret → fixed error that names neither secret nor id", () => {
    const attempt = () => csAuthHeaders({ kind: "pn", memberId: PN_ID });
    expect(attempt).toThrowError("pn_service_auth_unavailable");

    process.env.PN_SERVICE_SECRET = SECRET;
    process.env.PN_SERVICE_AUTH = "off";
    let message = "";
    try {
      attempt();
    } catch (e) {
      message = String((e as Error).message) + String((e as Error).stack ?? "");
    }
    expect(message).toContain("pn_service_auth_unavailable");
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain(PN_ID);
  });

  it("a non-ml: id never gets the service headers, even inside a pn credential", () => {
    process.env.PN_SERVICE_SECRET = SECRET;
    expect(() => csAuthHeaders({ kind: "pn", memberId: ENTRA_OID })).toThrowError(
      "pn_service_auth_unavailable"
    );
    expect(() => csAuthHeaders({ kind: "pn", memberId: "ml:a b" })).toThrowError(
      "pn_service_auth_unavailable"
    );
    expect(() => csAuthHeaders({ kind: "pn", memberId: "" })).toThrowError(
      "pn_service_auth_unavailable"
    );
  });
});

// ── Leitplanken im Quelltext ─────────────────────────────────────────────────
// Die Trennung der Ausweise hält nur, wenn JEDER Abruf des Credit-Dienstes über diesen
// Helfer läuft. Diese Prüfungen lesen den Quelltext und schlagen an, sobald jemand am
// Helfer vorbei ein Token holt, eine Ausweis-Kopfzeile baut oder das Geheimnis liest.
describe("Leitplanken: ein Helfer, ein Ort für Token und Geheimnis", () => {
  const SRC = path.join(process.cwd(), "src");
  const HELPER = "lib/server/credits/cs-credential.ts";
  const TOKEN_STORE = "lib/server/credits/entra-token-store.ts";

  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
    });
  }

  /** Kommentare entfernen — erwähnen darf man alles, nur nicht benutzen. */
  const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

  const files = walk(SRC).map((full) => {
    const text = readFileSync(full, "utf8");
    return {
      rel: path.relative(SRC, full).split(path.sep).join("/"),
      text,
      code: stripComments(text),
    };
  });
  const filesWith = (re: RegExp) => files.filter((f) => re.test(f.code)).map((f) => f.rel).sort();

  it("finds the source files", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.rel === HELPER)).toBe(true);
    expect(files.some((f) => f.rel === TOKEN_STORE)).toBe(true);
  });

  it("the Entra token store is only asked by the helper", () => {
    expect(filesWith(/\bgetValid\b/)).toEqual([HELPER, TOKEN_STORE].sort());
  });

  it("the secret is only read in the helper", () => {
    expect(filesWith(/PN_SERVICE_SECRET/)).toEqual([HELPER]);
    expect(filesWith(/PN_SERVICE_AUTH/)).toEqual([HELPER]);
  });

  it("credential headers are only built in the helper", () => {
    expect(filesWith(/x-pn-service-secret|x-pn-subject/i)).toEqual([HELPER]);
    expect(filesWith(/["'`]Bearer\s/)).toEqual([HELPER]);
  });

  it("the helper is server-only and no client file imports it", () => {
    const helper = files.find((f) => f.rel === HELPER)!;
    // `server-only` lässt den Build scheitern, sobald eine Client-Datei den Helfer lädt.
    expect(helper.text.startsWith('import "server-only";')).toBe(true);
    const importers = files.filter((f) => f.rel !== HELPER && /cs-credential["']/.test(f.code));
    expect(importers.length).toBeGreaterThan(0);
    for (const f of importers) {
      expect(/^\s*["']use client["']/.test(f.text), `${f.rel} ist eine Client-Datei`).toBe(false);
    }
  });

  it("what the Hub froze into the JWT (mlRole, mlApps, mlWorkspaceId) is never used", () => {
    expect(filesWith(/\b(mlRole|mlApps|mlWorkspaceId)\b/)).toEqual([]);
    // Die Herkunft der Sitzung („provider") öffnet hier nie etwas — nur die Kennung zählt.
    // Genau zwei Stellen dürfen sie lesen, und beide nur, um ABZUWEISEN: auth.ts reicht sie
    // durch, api-auth.ts lehnt eine Mail-Link-Sitzung mit Microsoft-Kennung ab (02.10.2026).
    expect(filesWith(/["']magic-link["']/)).toEqual(["auth.ts", "lib/api-auth.ts"]);
  });
});
