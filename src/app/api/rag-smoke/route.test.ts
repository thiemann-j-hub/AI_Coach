import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/**
 * Paket 2, C20 (12.11.2026): `/api/rag-smoke` gab jeder angemeldeten Person mit draft=1 und großem topK die ganze
 * Kartenbibliothek samt Entwürfen. Jetzt: nur mit Dienst-Ausweis oder für Plattform-Admins, sonst 404; topK ≤ 10.
 */
const h = vi.hoisted(() => ({ auth: vi.fn(), search: vi.fn() }));

vi.mock("@/lib/api-auth", () => ({ requireAuth: (...a: unknown[]) => h.auth(...a) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => null, rateLimitKey: () => "k" }));
vi.mock("@/lib/server/cost-cap", () => ({ isCostCapAdmin: (email?: string | null) => email === "admin@example.com" }));
vi.mock("@/lib/server/credits/cs-credential", () => ({
  serviceRequestOk: (req: { headers: { get(n: string): string | null } }) => req.headers.get("x-pn-service-secret") === "dienst-geheimnis",
}));
vi.mock("@/lib/cosmos-cards", () => ({ searchCards: (a: unknown) => h.search(a) }));

import { GET } from "./route";

const abruf = (query: string, headers: Record<string, string> = {}) => GET(new NextRequest(`http://localhost/api/rag-smoke?${query}`, { headers }));
const alsMitglied = () => h.auth.mockResolvedValue({ uid: "u1", email: "mitglied@example.com", oid: "oid-1" });
const alsAdmin = () => h.auth.mockResolvedValue({ uid: "u2", email: "admin@example.com", oid: "oid-2" });
const unangemeldet = () => h.auth.mockResolvedValue(NextResponse.json({ ok: false }, { status: 401 }));

beforeEach(() => {
  h.auth.mockReset();
  h.search.mockReset();
  h.search.mockResolvedValue({ count: 1, results: [{ id: "c1" }] });
});

describe("/api/rag-smoke (C20)", () => {
  it("angemeldetes Mitglied ohne Admin-Recht: 404, keine Suche — auch nicht mit draft=1", async () => {
    alsMitglied();
    const res = await abruf("text=delegieren&draft=1&topK=500");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(h.search).not.toHaveBeenCalled();
  });

  it("unangemeldet und ohne Dienst-Ausweis: 404 (nicht 401), keine Suche", async () => {
    unangemeldet();
    expect((await abruf("text=delegieren")).status).toBe(404);
    expect((await abruf("text=delegieren", { "x-pn-service-secret": "falsch" })).status).toBe(404);
    expect(h.search).not.toHaveBeenCalled();
  });

  it("Plattform-Admin: Suche läuft, topK ist auf 10 gedeckelt, draft geht durch", async () => {
    alsAdmin();
    const res = await abruf("text=delegieren&draft=1&topK=500");
    expect(res.status).toBe(200);
    expect(h.search).toHaveBeenCalledWith(expect.objectContaining({ text: "delegieren", topK: 10, includeDraft: true }));
    expect((await res.json()).query.topK).toBe(10);
  });

  it("Dienst-Ausweis: Suche läuft ohne Anmeldung", async () => {
    unangemeldet();
    const res = await abruf("text=delegieren&top_k=3", { "x-pn-service-secret": "dienst-geheimnis" });
    expect(res.status).toBe(200);
    expect(h.search).toHaveBeenCalledWith(expect.objectContaining({ topK: 3, includeDraft: false }));
    expect(h.auth).not.toHaveBeenCalled();
  });

  it("topK: ohne Angabe 8; Unsinn und Werte unter 1 fallen auf 8; Kommazahlen werden abgerundet", async () => {
    alsAdmin();
    const topK = async (q: string) => {
      h.search.mockClear();
      await abruf(`text=x${q}`);
      return (h.search.mock.calls[0][0] as { topK: number }).topK;
    };
    expect(await topK("")).toBe(8);
    expect(await topK("&topK=abc")).toBe(8);
    expect(await topK("&topK=0")).toBe(8);
    expect(await topK("&topK=-5")).toBe(8);
    expect(await topK("&topK=4.9")).toBe(4);
    expect(await topK("&topK=10")).toBe(10);
    expect(await topK("&topK=11")).toBe(10);
  });
});
