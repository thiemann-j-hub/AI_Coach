import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { InterviewDoc } from "@/lib/server/interview-store";

/**
 * 12.11.2026: Das Interview bucht je Versuch mit eigener Kennung. Vorher war die Kennung fest (`intv:<id>`): Nach
 * einem technischen Fehler mit Rückbuchung traf der zweite Versuch die alte, schon erstattete Buchung wieder, und
 * das Interview schloss ohne Credit ab. Der echte `interview-store` läuft gegen einen Speicher im Arbeitsspeicher.
 */
const h = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  speichernScheitert: 0,
  kennungen: [] as string[],
  rueckbuchungen: [] as string[],
  rueckbuchungOk: true,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cosmos", () => ({
  runsContainer: () => ({}),
  readItem: async (_c: unknown, id: string) => {
    const d = h.docs.get(id);
    return d ? structuredClone(d) : null;
  },
  upsertItem: async (_c: unknown, doc: Record<string, unknown>) => {
    if (h.speichernScheitert > 0) {
      h.speichernScheitert -= 1;
      throw new Error("Speicher nicht erreichbar");
    }
    h.docs.set(String(doc.id), structuredClone(doc));
  },
  deleteItem: async () => undefined,
  queryItems: async () => [],
}));
vi.mock("@/lib/api-auth", () => ({ requireAuth: async () => ({ uid: "u1", email: "a@example.com", oid: "oid-1" }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => null, rateLimitKey: () => "k" }));
vi.mock("@/lib/server/scenario-store", () => ({ resolveWorkspaceIdForScenarios: async () => "ws-1" }));
vi.mock("@/lib/logger", () => ({ logger: { api: vi.fn(), apiError: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/server/credits/entitlement", () => ({
  creditGateEnabled: () => true,
  reserveEntitlement: async (o: { runId: string }) => {
    h.kennungen.push(o.runId);
    return { ok: true, grant: { runId: o.runId, workspaceId: "ws-1", held: true, central: true, centralTxId: `tx-${o.runId}` } };
  },
  settleEntitlement: async () => undefined,
  compensateEntitlement: async (g: { runId: string }) => {
    h.rueckbuchungen.push(g.runId);
    return { ok: h.rueckbuchungOk };
  },
}));

import { POST } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const antwort = (text: string) => ({ role: "person", text, at: "2026-11-12T10:00:00.000Z" });
function seed(extra: Partial<InterviewDoc> = {}) {
  h.docs.set(ID, {
    id: ID,
    sessionId: "intv:ws-1",
    docType: "interview",
    workspaceId: "ws-1",
    uid: "u1",
    definitionId: "def-1",
    kurs: { id: "kurs-1", titel: "Kurs" },
    locale: "de",
    status: "active",
    turns: [antwort("eins"), antwort("zwei"), antwort("drei")],
    frageNr: 3,
    nachfragen: 0,
    fertig: true,
    createdAt: "2026-11-12T09:50:00.000Z",
    updatedAt: "2026-11-12T10:00:00.000Z",
    ...extra,
  });
}
const finish = () =>
  POST(new NextRequest("http://localhost/api/interview/finish", { method: "POST", body: JSON.stringify({ id: ID }), headers: { "content-type": "application/json" } }));
const doc = () => h.docs.get(ID) as unknown as InterviewDoc;

beforeEach(() => {
  h.docs.clear();
  h.speichernScheitert = 0;
  h.kennungen.length = 0;
  h.rueckbuchungen.length = 0;
  h.rueckbuchungOk = true;
});

describe("POST /api/interview/finish: Buchung je Versuch", () => {
  it("erster Versuch bucht mit der alten Kennung und schließt ab", async () => {
    seed();
    const res = await finish();
    expect(res.status).toBe(200);
    expect(h.kennungen).toEqual([`intv:${ID}`]);
    expect(doc().status).toBe("finished");
    expect(doc().centralSpendTxId).toBe(`tx-intv:${ID}`);
  });

  it("scheitert das Speichern, kommt der Credit zurück und der nächste Versuch bucht neu", async () => {
    seed();
    h.speichernScheitert = 1;
    const erster = await finish();
    expect(erster.status).toBe(500);
    expect(h.rueckbuchungen).toEqual([`intv:${ID}`]);
    expect(doc().status).toBe("active");
    expect(doc().chargeRefunds).toBe(1);

    const zweiter = await finish();
    expect(zweiter.status).toBe(200);
    expect(h.kennungen).toEqual([`intv:${ID}`, `intv:${ID}:1`]);
    expect(doc().status).toBe("finished");
  });

  it("scheitert auch die Rückbuchung, bleibt die Kennung: der Credit ist noch gebucht", async () => {
    seed();
    h.speichernScheitert = 1;
    h.rueckbuchungOk = false;
    expect((await finish()).status).toBe(500);
    expect(doc().chargeRefunds).toBeUndefined();

    expect((await finish()).status).toBe(200);
    expect(h.kennungen).toEqual([`intv:${ID}`, `intv:${ID}`]);
  });

  it("ein schon abgeschlossenes Interview bucht nicht", async () => {
    seed({ status: "finished" });
    const res = await finish();
    expect(await res.json()).toEqual({ ok: true, already: true });
    expect(h.kennungen).toEqual([]);
  });
});
