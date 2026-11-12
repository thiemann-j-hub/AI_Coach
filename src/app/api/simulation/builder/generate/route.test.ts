import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/**
 * Go-Live-Prüfung 12.11.2026, S3: Der Builder bucht 1 Credit je Entwurf und ruft dann den Generator (55 bis 170
 * Sekunden). Die Kennung der Buchung stand nirgends. Jetzt steht für diese Zeit ein Buchungsvermerk; bleibt er
 * stehen, listet ihn `scripts/credits-abgleich.mts`.
 * Echt sind die Route und der Buchungsvermerk; Cosmos ist ein Speicher im Arbeitsspeicher.
 */
const db = await vi.hoisted(async () => (await import("@/test/analyse-speicher")).neuerAnalyseSpeicher());
const h = vi.hoisted(() => ({
  uid: "person-0",
  reserve: vi.fn(),
  compensate: vi.fn(),
  generator: vi.fn(),
  speichern: vi.fn(),
}));
vi.mock("@/lib/cosmos", () => db.cosmos);
vi.mock("@/lib/api-auth", () => ({ requireAuth: async () => ({ uid: h.uid, email: "a@example.com", oid: "oid-1" }) }));
vi.mock("@/lib/server/scenario-admin", () => ({ requireWorkspaceAdmin: async () => ({ workspaceId: "ws-1" }) }));
vi.mock("@/lib/server/cost-cap", () => ({ checkAndConsumeBudget: async () => ({ allowed: true }), estimateTokens: () => 1 }));
vi.mock("@/lib/server/credits/entitlement", () => ({
  creditGateEnabled: () => true,
  reserveEntitlement: (...a: unknown[]) => h.reserve(...a),
  settleEntitlement: vi.fn(async () => undefined),
  compensateEntitlement: (...a: unknown[]) => h.compensate(...a),
}));
vi.mock("@/lib/logger", () => ({ logger: { api: vi.fn(), apiError: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/ai/flows/scenario-generator", () => ({
  draftIdFromBrief: () => "ws-neuer-entwurf-abc123",
  generateScenarioDraft: (...a: unknown[]) => h.generator(...a),
}));
vi.mock("@/lib/server/scenario-store", () => ({
  SCENARIO_DOC_TYPE: "sim_scenario",
  scenarioPartitionKey: (ws: string) => `simscn:${ws}`,
  listWorkspaceScenarioDocs: async () => [],
  upsertWorkspaceScenario: (...a: unknown[]) => h.speichern(...a),
}));

import { POST } from "./route";

const BODY = { brief: "Eine Führungskraft spricht mit einer Mitarbeiterin über wiederholt verpasste Fristen im Projekt." };
const erzeugen = async () => {
  const res = await POST(
    new NextRequest("http://localhost/api/simulation/builder/generate", { method: "POST", body: JSON.stringify(BODY), headers: { "content-type": "application/json", "x-locale": "de" } })
  );
  return { status: res.status, json: (await res.json()) as Record<string, any> };
};
const kennung = () => h.reserve.mock.calls[0][0].runId as string;

let nr = 0;
beforeEach(() => {
  process.env.SIMULATION_ENABLED = "on";
  db.reset();
  // Jede Prüfung als eigene Person: Die echte Begrenzung zählt je Person (S4), vier Entwürfe je Minute.
  h.uid = `person-${++nr}`;
  for (const m of [h.reserve, h.compensate, h.generator, h.speichern]) m.mockReset();
  h.reserve.mockImplementation(async ({ runId }: { runId: string }) => ({
    ok: true,
    grant: { runId, workspaceId: "ws-1", held: true, central: true, centralTxId: "tx-1" },
  }));
  h.compensate.mockImplementation(async () => ({ ok: true }));
  h.generator.mockImplementation(async ({ id }: { id: string }) => ({ id, title: "Entwurf" }));
  h.speichern.mockImplementation(async (_ws: string, scenario: { id: string }) => ({ id: scenario.id, status: "draft", scenario }));
});
afterEach(() => {
  delete process.env.SIMULATION_ENABLED;
});

describe("POST /api/simulation/builder/generate — Buchung mit Spur (S3)", () => {
  it("Fall 1, Prozess-Ende während des Generators: Der Vermerk steht mit Kennung, Buchungsnummer und Arbeitsbereich", async () => {
    let waehrend: Record<string, unknown>[] = [];
    h.generator.mockImplementation(async ({ id }: { id: string }) => {
      waehrend = db.vermerke();
      return { id, title: "Entwurf" };
    });
    const r = await erzeugen();
    expect(r).toMatchObject({ status: 200, json: { ok: true, item: { id: "ws-neuer-entwurf-abc123", status: "draft" } } });
    expect(waehrend).toHaveLength(1);
    expect(waehrend[0]).toMatchObject({ docType: "buchungsvermerk", art: "builder", uid: h.uid, kennung: kennung(), txId: "tx-1", workspaceId: "ws-1" });
    // Entwurf gespeichert: Der Vermerk ist ausgetragen.
    expect(db.vermerke()).toEqual([]);
    expect(h.compensate).not.toHaveBeenCalled();
  });

  it("Fall 2, Credit-Dienst antwortet nicht klar: 503 wie bisher, der Vermerk bleibt ohne Buchungsnummer", async () => {
    h.reserve.mockImplementation(async () => ({
      ok: false,
      unklar: true,
      response: NextResponse.json({ ok: false, code: "CENTRAL_UNAVAILABLE" }, { status: 503 }),
    }));
    expect((await erzeugen()).status).toBe(503);
    expect(h.generator).not.toHaveBeenCalled();
    const [v] = db.vermerke();
    expect(v).toMatchObject({ art: "builder", uid: h.uid, kennung: kennung() });
    expect(v).not.toHaveProperty("txId");
  });

  it("klare Ablehnung (kein Guthaben): 402 wie bisher, kein Vermerk", async () => {
    h.reserve.mockImplementation(async () => ({ ok: false, response: NextResponse.json({ ok: false, code: "INSUFFICIENT_CREDITS" }, { status: 402 }) }));
    expect((await erzeugen()).status).toBe(402);
    expect(db.vermerke()).toEqual([]);
  });

  it("Generator scheitert: Rückbuchung gelungen, kein Vermerk", async () => {
    h.generator.mockImplementation(async () => {
      throw new Error("Modell antwortet nicht");
    });
    expect((await erzeugen()).status).toBe(500);
    expect(h.compensate).toHaveBeenCalledTimes(1);
    expect(db.vermerke()).toEqual([]);
  });

  it("Fall 3, Rückbuchung scheitert: Der Vermerk bleibt mit Buchungsnummer und Zeitpunkt des Fehlschlags", async () => {
    h.generator.mockImplementation(async () => {
      throw new Error("Modell antwortet nicht");
    });
    h.compensate.mockImplementation(async () => ({ ok: false }));
    expect((await erzeugen()).status).toBe(500);
    const [v] = db.vermerke();
    expect(v).toMatchObject({ art: "builder", uid: h.uid, kennung: kennung(), txId: "tx-1", workspaceId: "ws-1" });
    expect(typeof v.refundFailedAt).toBe("string");
  });
});
