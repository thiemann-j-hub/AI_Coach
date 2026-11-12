import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/**
 * Go-Live-Prüfung 12.11.2026: POST /api/analyze (bisher ohne Routen-Test).
 *   B1  Ohne `sessionId` oder mit der Sitzung einer anderen Person rechnete die Route, buchte zurück und lieferte das
 *       vollständige Ergebnis trotzdem aus: die bezahlte Leistung ohne Credit, beliebig oft.
 *   B3  Eine neue Sitzung legt nur dieser Weg an.
 *   S3  Die Buchung lief unter einer Kennung, die nirgends stand.
 * Echt sind die Route, der `runs-store`, der Buchungsvermerk und die Begrenzung. Cosmos ist ein Speicher im
 * Arbeitsspeicher; Anmeldung, Guthaben, Budget, Radar und die beiden KI-Aufrufe sind gemockt.
 */
const db = await vi.hoisted(async () => (await import("@/test/analyse-speicher")).neuerAnalyseSpeicher());
const h = vi.hoisted(() => ({
  uid: "person-0",
  gate: true,
  reserve: vi.fn(),
  compensate: vi.fn(),
  feedback: vi.fn(),
  competencies: vi.fn(),
  budget: vi.fn(),
  radar: vi.fn(async (..._a: unknown[]) => undefined),
}));
vi.mock("@/lib/cosmos", () => db.cosmos);
vi.mock("@/lib/api-auth", () => ({ requireAuth: async () => ({ uid: h.uid, email: "a@example.com", oid: "oid-1" }) }));
vi.mock("@/ai/genkit", () => ({ GENKIT_MODEL_ID: "test-modell" }));
vi.mock("@/ai/flows/generate-dynamic-feedback", () => ({ generateDynamicFeedback: (...a: unknown[]) => h.feedback(...a) }));
vi.mock("@/ai/flows/score-competencies", () => ({ scoreCompetencies: (...a: unknown[]) => h.competencies(...a) }));
vi.mock("@/lib/server/cost-cap", () => ({ checkAndConsumeBudget: (...a: unknown[]) => h.budget(...a), estimateTokens: () => 1 }));
vi.mock("@/lib/server/credits/entitlement", () => ({
  creditGateEnabled: () => h.gate,
  reserveEntitlement: (...a: unknown[]) => h.reserve(...a),
  settleEntitlement: vi.fn(async () => undefined),
  compensateEntitlement: (...a: unknown[]) => h.compensate(...a),
}));
vi.mock("@/lib/server/radar-emit", () => ({ emitCoachMeasurement: (...a: unknown[]) => h.radar(...a) }));
vi.mock("@/lib/logger", () => ({ logger: { api: vi.fn(), apiError: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { getDictionary } from "@/i18n/dictionaries";
import { POST } from "./route";

const SID = "sitzung-aaaa-1111";
const BODY = {
  conversationType: "feedback",
  conversationSubType: "mitarbeitendengespräch",
  transcriptText: "Führungskraft: Wie lief die Woche?\nMitarbeiter:in: Gut, danke.",
  lang: "de",
  leaderLabel: "Führungskraft",
  employeeLabel: "Mitarbeiter:in",
};
const analysiere = async (body: Record<string, unknown>) => {
  const res = await POST(
    new NextRequest("http://localhost/api/analyze", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-locale": "de" } })
  );
  return { status: res.status, json: (await res.json()) as Record<string, any> };
};
const laeufe = () => db.all("runs").filter((d) => d.docType === undefined);
const nichtsGebuchtNichtsGerechnet = () => {
  expect(h.reserve).not.toHaveBeenCalled();
  expect(h.feedback).not.toHaveBeenCalled();
  expect(h.competencies).not.toHaveBeenCalled();
  expect(h.budget).not.toHaveBeenCalled();
};

let nr = 0;
beforeEach(() => {
  db.reset();
  // Jede Prüfung als eigene Person: Die echte Begrenzung zählt je Person (S4).
  h.uid = `person-${++nr}`;
  h.gate = true;
  for (const m of [h.reserve, h.compensate, h.feedback, h.competencies, h.budget, h.radar]) m.mockReset();
  h.reserve.mockImplementation(async ({ runId }: { runId: string }) => ({
    ok: true,
    grant: { runId, workspaceId: "ws-1", held: true, central: true, centralTxId: "tx-1" },
  }));
  h.compensate.mockImplementation(async () => ({ ok: true }));
  h.feedback.mockImplementation(async () => ({ summary: "Kurzfassung der Analyse", strengths: ["klar"], improvements: [], rewrites: [], riskFlags: [], scores: { overall: 72 } }));
  h.competencies.mockImplementation(async () => ({}));
  h.budget.mockImplementation(async () => ({ allowed: true }));
  h.radar.mockImplementation(async () => undefined);
});

describe("B1 Analyse ohne Credit", () => {
  it("Ablauf aus dem Befund, Weg 1a: ohne sessionId gibt es 400, kein Ergebnis, keine Buchung, keinen KI-Aufruf", async () => {
    const r = await analysiere(BODY);
    expect(r.status).toBe(400);
    expect(r.json).not.toHaveProperty("result");
    nichtsGebuchtNichtsGerechnet();
  });

  it("Ablauf aus dem Befund, Weg 1b: Sitzung einer anderen Person gibt 403, kein Ergebnis, keine Buchung, keinen KI-Aufruf", async () => {
    db.sitzung(SID, "andere-person");
    const r = await analysiere({ ...BODY, sessionId: SID });
    expect(r.status).toBe(403);
    expect(r.json).not.toHaveProperty("result");
    // Die Analyse-Seite zeigt nur zu einer KI-Fehlerart einen Satz: `ai_general` steht deshalb neben FORBIDDEN.
    expect(r.json).toMatchObject({ ok: false, code: "FORBIDDEN", aiCode: "ai_general", error: getDictionary("de").api.accessDenied });
    nichtsGebuchtNichtsGerechnet();
    expect(db.get("sessions", SID, SID)).toMatchObject({ uid: "andere-person" });
    expect(laeufe()).toEqual([]);
  });

  it("die feste Partition der Spielbücher ist keine Sitzung (B3): 403, nichts angelegt", async () => {
    const r = await analysiere({ ...BODY, sessionId: "spielbuch" });
    expect(r.status).toBe(403);
    nichtsGebuchtNichtsGerechnet();
    expect(db.all("sessions")).toEqual([]);
  });

  it("lässt sich der Lauf nicht speichern, wird zurückgebucht und es gibt einen Fehler statt des Ergebnisses", async () => {
    db.stoere((vorgang, container, doc) => {
      if (vorgang === "upsert" && container === "runs" && doc.docType === undefined) throw new Error("Datenbank nicht erreichbar");
    });
    const r = await analysiere({ ...BODY, sessionId: SID });
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(r.json).not.toHaveProperty("result");
    expect(r.json).not.toHaveProperty("runId");
    // Der Client zeigt den Satz zu dieser KI-Fehlerart samt Fehler-Nr.
    expect(r.json).toMatchObject({ ok: false, code: "AI_ERROR" });
    expect(typeof r.json.aiCode).toBe("string");
    expect(h.feedback).toHaveBeenCalledTimes(1);
    expect(h.compensate).toHaveBeenCalledTimes(1);
    expect(h.compensate.mock.calls[0][0]).toMatchObject({ centralTxId: "tx-1" });
    expect(laeufe()).toEqual([]);
    expect(db.vermerke()).toEqual([]);
  });

  it("gehört die Lauf-Kennung schon einer anderen Person, gilt dasselbe: Rückbuchung, kein Ergebnis", async () => {
    // Die Kennung erzeugt der Server; hier liegt unter genau ihr schon ein fremder Lauf.
    h.reserve.mockImplementation(async ({ runId }: { runId: string }) => {
      db.put("runs", { id: runId, sessionId: SID, uid: "andere-person", createdAt: "2026-11-01T08:00:00.000Z" });
      return { ok: true, grant: { runId, workspaceId: "ws-1", held: true, central: true, centralTxId: "tx-1" } };
    });
    const r = await analysiere({ ...BODY, sessionId: SID });
    expect(r.status).toBe(500);
    expect(r.json).not.toHaveProperty("result");
    expect(h.compensate).toHaveBeenCalledTimes(1);
    expect(laeufe()).toHaveLength(1);
    expect(laeufe()[0]).toMatchObject({ uid: "andere-person" });
  });
});

describe("Erfolg: Credit verbraucht, Lauf gespeichert", () => {
  it("erste Analyse einer neuen Sitzung: legt Sitzung und Schatten-Lauf an und liefert Ergebnis und Lauf-Kennung", async () => {
    const r = await analysiere({ ...BODY, sessionId: SID });
    expect(r.status).toBe(200);
    expect(r.json.result).toMatchObject({ summary: "Kurzfassung der Analyse", model: "test-modell" });
    expect(db.get("sessions", SID, SID)).toMatchObject({ uid: h.uid });
    const [lauf] = laeufe();
    expect(lauf).toMatchObject({ id: r.json.runId, sessionId: SID, uid: h.uid, workspaceId: "ws-1", centralSpendTxId: "tx-1", transcriptText: null, summary: "Kurzfassung der Analyse" });
    expect(h.reserve).toHaveBeenCalledTimes(1);
    expect(h.reserve.mock.calls[0][0]).toMatchObject({ runId: r.json.runId });
    expect(h.compensate).not.toHaveBeenCalled();
    expect(db.vermerke()).toEqual([]);
    expect(h.radar).toHaveBeenCalledTimes(1);
  });

  it("weitere Analyse in der eigenen Sitzung: die Sitzung bleibt, ein zweiter Lauf kommt dazu", async () => {
    await analysiere({ ...BODY, sessionId: SID });
    const r = await analysiere({ ...BODY, sessionId: SID });
    expect(r.status).toBe(200);
    expect(laeufe()).toHaveLength(2);
    expect(db.all("sessions")).toHaveLength(1);
  });

  it("ohne Bezahlsystem: kein Schatten-Lauf und keine Buchung, aber die Sitzung steht für das Speichern bereit", async () => {
    h.gate = false;
    const r = await analysiere({ ...BODY, sessionId: SID });
    expect(r.status).toBe(200);
    expect(typeof r.json.runId).toBe("string");
    expect(h.reserve).not.toHaveBeenCalled();
    expect(laeufe()).toEqual([]);
    expect(db.get("sessions", SID, SID)).toMatchObject({ uid: h.uid });
  });
});

describe("S3 Buchung mit Spur", () => {
  it("Fall 1, Prozess-Ende während der Rechnung: Der Vermerk steht mit Kennung, Buchungsnummer und Arbeitsbereich", async () => {
    let waehrend: Record<string, unknown>[] = [];
    h.feedback.mockImplementation(async () => {
      waehrend = db.vermerke();
      return { summary: "Kurzfassung der Analyse", scores: { overall: 72 } };
    });
    const r = await analysiere({ ...BODY, sessionId: SID });
    // Stünde der Prozess während des KI-Aufrufs still, bliebe genau dieser Vermerk und der Abgleich listet ihn.
    expect(waehrend).toHaveLength(1);
    expect(waehrend[0]).toMatchObject({ docType: "buchungsvermerk", art: "analyse", uid: h.uid, kennung: r.json.runId, txId: "tx-1", workspaceId: "ws-1" });
    expect(db.vermerke()).toEqual([]);
  });

  it("Fall 2, Credit-Dienst antwortet nicht klar: 503 wie bisher, der Vermerk bleibt ohne Buchungsnummer", async () => {
    h.reserve.mockImplementation(async () => ({
      ok: false,
      unklar: true,
      response: NextResponse.json({ ok: false, code: "CENTRAL_UNAVAILABLE" }, { status: 503 }),
    }));
    const r = await analysiere({ ...BODY, sessionId: SID });
    expect(r).toMatchObject({ status: 503, json: { code: "CENTRAL_UNAVAILABLE" } });
    expect(h.feedback).not.toHaveBeenCalled();
    const [v] = db.vermerke();
    expect(v).toMatchObject({ art: "analyse", uid: h.uid, kennung: h.reserve.mock.calls[0][0].runId });
    expect(v).not.toHaveProperty("txId");
  });

  it("klare Ablehnung (kein Guthaben): 402 wie bisher, kein Vermerk", async () => {
    h.reserve.mockImplementation(async () => ({ ok: false, response: NextResponse.json({ ok: false, code: "INSUFFICIENT_CREDITS" }, { status: 402 }) }));
    const r = await analysiere({ ...BODY, sessionId: SID });
    expect(r.status).toBe(402);
    expect(h.feedback).not.toHaveBeenCalled();
    expect(db.vermerke()).toEqual([]);
  });

  it("KI-Fehler: Rückbuchung gelungen, kein Vermerk, kein Lauf", async () => {
    h.feedback.mockImplementation(async () => {
      throw new Error("Modell antwortet nicht");
    });
    const r = await analysiere({ ...BODY, sessionId: SID });
    expect(r.status).toBe(500);
    expect(r.json).not.toHaveProperty("result");
    expect(h.compensate).toHaveBeenCalledTimes(1);
    expect(db.vermerke()).toEqual([]);
    expect(laeufe()).toEqual([]);
  });

  it("Fall 3, Rückbuchung scheitert: Der Vermerk bleibt mit Buchungsnummer und Zeitpunkt des Fehlschlags", async () => {
    h.feedback.mockImplementation(async () => {
      throw new Error("Modell antwortet nicht");
    });
    h.compensate.mockImplementation(async () => ({ ok: false }));
    const r = await analysiere({ ...BODY, sessionId: SID });
    expect(r.status).toBe(500);
    const [v] = db.vermerke();
    expect(v).toMatchObject({ art: "analyse", uid: h.uid, txId: "tx-1", workspaceId: "ws-1" });
    expect(typeof v.refundFailedAt).toBe("string");
  });

  it("fail-soft: Lässt sich der Vermerk nicht schreiben, läuft die Analyse wie bisher", async () => {
    db.stoere((vorgang, container, doc) => {
      if (vorgang === "upsert" && container === "runs" && doc.docType === "buchungsvermerk") throw new Error("Datenbank nicht erreichbar");
    });
    const r = await analysiere({ ...BODY, sessionId: SID });
    expect(r.status).toBe(200);
    expect(laeufe()).toHaveLength(1);
  });
});
