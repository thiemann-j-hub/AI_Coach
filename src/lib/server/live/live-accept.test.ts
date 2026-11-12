import { describe, expect, it, vi } from "vitest";

// Die echte Außenwelt (Anmeldung, Credit-Dienst, Datenbank) bleibt draußen: Die Tests reichen eigene `deps` herein.
vi.mock("@/lib/server/credits/entitlement", () => ({ KI_AUS_TEXT: "aus", kiSchalterAus: async () => false }));
vi.mock("@/lib/server/cost-cap", () => ({ checkAndConsumeBudget: async () => ({ allowed: true }), estimateTokens: () => 0 }));
vi.mock("@/lib/server/scenario-store", () => ({ getScenarioForUser: async () => null }));
vi.mock("@/lib/server/spielbuch/store", () => ({ ensureSpielbuch: async () => null }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), api: vi.fn(), apiError: vi.fn() } }));

import { getScenario } from "@/lib/simulation/scenarios";
import type { SimulationDoc } from "@/lib/server/simulation-store";
import { acceptLiveSocket } from "./live-accept";
import { WS_OPEN, type LiveDeps, type LiveSocket, type Upstream } from "./live-session";
import { liveTicketStore } from "./ticket-store";

/**
 * Paket 2, C36 (12.11.2026): Annahme eines frischen Sockets. Der error-Hörer steht vor dem ersten Warten
 * (ein kaputter Frame vor der Karte warf sonst im Prozess); ohne gültige Karte gibt es keine Sitzung.
 */
function fakeSocket() {
  const handlers: Record<string, Array<(...a: never[]) => void>> = { message: [], close: [], error: [] };
  const sent: string[] = [];
  let state = WS_OPEN;
  const ws: LiveSocket & { sent: string[]; handlers: typeof handlers; closedWith: Array<[number?, string?]>; emit(ev: string, ...a: unknown[]): void } = {
    sent,
    handlers,
    closedWith: [],
    get readyState() {
      return state;
    },
    send: (d) => void sent.push(String(d)),
    close: (code, reason) => {
      if (state !== WS_OPEN) return;
      state = 3;
      ws.closedWith.push([code, reason]);
      for (const h of handlers.close) (h as () => void)();
    },
    on: (ev: string, fn: (...a: never[]) => void) => void handlers[ev].push(fn),
    removeListener: (ev: string, fn: (...a: never[]) => void) => {
      handlers[ev] = handlers[ev].filter((h) => h !== fn);
    },
    emit: (ev, ...a) => {
      for (const h of [...handlers[ev]]) (h as (...x: unknown[]) => void)(...a);
    },
  };
  return ws;
}

function deps(): LiveDeps {
  const doc: SimulationDoc = {
    id: "sim-abcdefgh",
    sessionId: "sim:u1",
    docType: "simulation",
    uid: "u1",
    scenarioId: "sim-coaching-morgan",
    createdAt: new Date(1_000_000).toISOString(),
    updatedAt: new Date(1_000_000).toISOString(),
    status: "active",
    turns: [{ role: "persona", text: "Guten Morgen.", ts: new Date(1_000_000).toISOString() }],
  };
  const up: Upstream = { sendAudio: () => {}, sendText: () => {}, sendHistory: () => {}, close: () => {} };
  return {
    connect: async () => up,
    loadSim: async () => structuredClone(doc),
    updateSim: async () => structuredClone(doc),
    loadScenario: async (_u, id) => getScenario(id),
    budget: async () => ({ allowed: true }),
    now: () => 1_000_000 + 60_000,
    log: () => {},
    model: "gemini-3.8-live",
    sitzungen: new Map(),
  };
}

const hello = (ticket: string, mehr: Record<string, unknown> = {}) => Buffer.from(JSON.stringify({ t: "hello", ticket, ...mehr }));
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("Annahme der Live-Verbindung", () => {
  it("setzt den error-Hörer vor dem ersten Warten; ein Fehler vor der Karte wirft nicht", async () => {
    const ws = fakeSocket();
    const lauf = acceptLiveSocket(ws, deps());
    expect(ws.handlers.error).toHaveLength(1);
    expect(() => ws.emit("error", new Error("Invalid WebSocket frame: invalid opcode 3"))).not.toThrow();
    ws.close(1002);
    await lauf;
    expect(ws.sent).toEqual([]);
  });

  it("ohne gültige Karte: 4401, keine Sitzung", async () => {
    const ws = fakeSocket();
    const lauf = acceptLiveSocket(ws, deps());
    ws.emit("message", hello("gibt-es-nicht"), false);
    await lauf;
    expect(ws.closedWith[0]).toEqual([4401, "UNAUTHORIZED"]);
    expect(ws.sent).toEqual([]);
  });

  it("mit Karte läuft die Sitzung; die Karte gilt genau einmal", async () => {
    const karte = liveTicketStore().issue({ uid: "u1", email: null, oid: null, simId: "sim-abcdefgh" });
    const ws = fakeSocket();
    const lauf = acceptLiveSocket(ws, deps());
    ws.emit("message", hello(karte), false);
    await tick();
    expect(JSON.parse(ws.sent[0])).toMatchObject({ t: "ready", persona: "Alex Morgan" });
    ws.close(1000);
    await lauf;

    const zweiter = fakeSocket();
    const nochmal = acceptLiveSocket(zweiter, deps());
    zweiter.emit("message", hello(karte), false);
    await nochmal;
    expect(zweiter.closedWith[0]).toEqual([4401, "UNAUTHORIZED"]);
  });

  it("Paket 4, C36: der Hallo-Hörer hängt nach der Karte nicht mehr am Socket", async () => {
    const karte = liveTicketStore().issue({ uid: "u1", email: null, oid: null, simId: "sim-abcdefgh" });
    const ws = fakeSocket();
    const lauf = acceptLiveSocket(ws, deps());
    expect(ws.handlers.message).toHaveLength(1); // nur der Hallo-Hörer
    ws.emit("message", hello(karte), false);
    await tick();
    // Jetzt hört nur noch die Sitzung zu (vorher lief der Hallo-Hörer bei jedem Audio-Frame mit).
    expect(ws.handlers.message).toHaveLength(1);
    expect(ws.handlers.close).toHaveLength(1);
    ws.close(1000);
    await lauf;

    // Auch ohne gültige Karte bleibt kein Hörer zurück.
    const fremd = fakeSocket();
    const abgelehnt = acceptLiveSocket(fremd, deps());
    fremd.emit("message", Buffer.alloc(8), true);
    await abgelehnt;
    expect(fremd.handlers.message).toHaveLength(0);
    expect(fremd.closedWith[0]).toEqual([4401, "UNAUTHORIZED"]);
  });

  it("Paket 4, S1: der Wunsch nach der hörbaren Eröffnung kommt aus dem hello in der Sitzung an", async () => {
    const karte = liveTicketStore().issue({ uid: "u1", email: null, oid: null, simId: "sim-abcdefgh" });
    const ws = fakeSocket();
    const lauf = acceptLiveSocket(ws, deps());
    ws.emit("message", hello(karte, { eroeffnung: true }), false);
    await tick();
    expect(JSON.parse(ws.sent[0])).toMatchObject({ t: "ready", eroeffnung: true });
    ws.close(1000);
    await lauf;

    // Nur ein echtes `true` zählt.
    const karte2 = liveTicketStore().issue({ uid: "u1", email: null, oid: null, simId: "sim-abcdefgh" });
    const ws2 = fakeSocket();
    const lauf2 = acceptLiveSocket(ws2, deps());
    ws2.emit("message", hello(karte2, { eroeffnung: "ja" }), false);
    await tick();
    expect(JSON.parse(ws2.sent[0])).toMatchObject({ t: "ready", eroeffnung: false });
    ws2.close(1000);
    await lauf2;
  });
});

vi.mock("server-only", () => ({}));
