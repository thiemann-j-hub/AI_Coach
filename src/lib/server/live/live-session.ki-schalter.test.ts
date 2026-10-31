import { describe, expect, it, vi } from "vitest";
import { getScenario } from "@/lib/simulation/scenarios";
import type { SimulationDoc } from "@/lib/server/simulation-store";
import {
  runLiveSession,
  type LiveDeps,
  type LiveSocket,
  type Upstream,
  type UpstreamEvents,
  WS_OPEN,
} from "./live-session";

/**
 * A4 (Prüfung Sichtbarkeit, 31.10.2026): Der KI-Schalter des Unternehmens gilt auch in der laufenden
 * Live-Sitzung — vor dem Verbinden, nach jedem Zug und im Takt (das Mikrofon-Audio fließt auch ohne Zug).
 * Attrappen wie im Haupttest (live-session.test.ts).
 */
function fakeSocket() {
  const handlers: Record<string, Array<(...a: never[]) => void>> = { message: [], close: [], error: [] };
  const sent: Array<string | Buffer> = [];
  let state = WS_OPEN;
  const ws: LiveSocket & { sent: typeof sent; closedWith: Array<[number?, string?]> } = {
    sent,
    closedWith: [],
    get readyState() {
      return state;
    },
    send: (d) => void sent.push(d),
    close: (code, reason) => {
      if (state !== WS_OPEN) return;
      state = 3;
      ws.closedWith.push([code, reason]);
      for (const h of handlers.close) (h as () => void)();
    },
    on: (ev: string, fn: (...a: never[]) => void) => void handlers[ev].push(fn),
  };
  return ws;
}

function fakeUpstream() {
  const calls: Array<{ k: string }> = [];
  let events: UpstreamEvents | null = null;
  const up: Upstream = {
    sendAudio: () => void calls.push({ k: "audio" }),
    sendText: () => void calls.push({ k: "text" }),
    sendHistory: () => void calls.push({ k: "history" }),
    close: () => void calls.push({ k: "close" }),
  };
  const connect: LiveDeps["connect"] = async (_c, ev) => {
    events = ev;
    calls.push({ k: "connect" });
    return up;
  };
  return { calls, connect, ev: () => events! };
}

function doc(): SimulationDoc {
  return {
    id: "sim-abcdefgh",
    sessionId: "sim:u1",
    docType: "simulation",
    uid: "u1",
    scenarioId: "sim-coaching-morgan",
    createdAt: new Date(1_000_000).toISOString(),
    updatedAt: new Date(1_000_000).toISOString(),
    status: "active",
    turns: [{ role: "persona", text: "Guten Morgen.", ts: new Date(1_000_000).toISOString() }],
    convoLocale: "de",
  };
}

function deps(over: Partial<LiveDeps> = {}) {
  const up = fakeUpstream();
  const d = doc();
  const base: LiveDeps = {
    connect: up.connect,
    loadSim: async () => d,
    saveSim: async () => {},
    loadScenario: async (_u, id) => getScenario(id),
    budget: vi.fn(async () => ({ allowed: true })),
    now: () => 1_000_000 + 60_000,
    log: () => {},
    model: "gemini-3.8-live",
    idleMs: 60_000,
    ...over,
  };
  return { deps: base, up, doc: d };
}

const MELDUNG = "Rollenspiele und Gesprächsanalyse sind für Euer Unternehmen ausgeschaltet.";
const ticket = { uid: "u1", email: null, oid: "oid-1", simId: "sim-abcdefgh" };
const json = (ws: ReturnType<typeof fakeSocket>) => ws.sent.filter((s) => typeof s === "string").map((s) => JSON.parse(s as string));
const tick = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Sprachmodus Live — KI-Schalter des Unternehmens (A4)", () => {
  it("aus beim Start: Meldung, Code 4403, keine Verbindung zum Live-Modell, kein Spielbuch", async () => {
    const ws = fakeSocket();
    const kiAusMeldung = vi.fn(async () => MELDUNG);
    const loadSpielbuch = vi.fn(async () => null);
    const { deps: dp, up } = deps({ kiAusMeldung, loadSpielbuch });
    await runLiveSession(ws, ticket, dp);
    expect(kiAusMeldung).toHaveBeenCalledWith("oid-1");
    expect(json(ws)).toEqual([{ t: "error", code: "KI_AUS", message: MELDUNG }]);
    expect(ws.closedWith[0]?.[0]).toBe(4403);
    expect(up.calls.some((c) => c.k === "connect")).toBe(false);
    expect(loadSpielbuch).not.toHaveBeenCalled();
  });

  it("geht während des Gesprächs aus: der Zug wird gespeichert, dann Meldung und Ende — kein Budget, kein Beobachter", async () => {
    const ws = fakeSocket();
    let meldung: string | null = null;
    const regie = vi.fn(async () => null);
    const { deps: dp, up, doc: d } = deps({ kiAusMeldung: async () => meldung, regie });
    const run = runLiveSession(ws, ticket, dp);
    await tick();
    expect(json(ws)[0]).toMatchObject({ t: "ready" });
    meldung = MELDUNG; // Admin schaltet im Hub aus
    up.ev().onInputText("Haben Sie kurz Zeit?");
    up.ev().onOutputText("Ja, kurz.");
    up.ev().onTurnComplete();
    await tick();
    await tick();
    const msgs = json(ws);
    expect(msgs.find((m) => m.t === "turn")).toMatchObject({ user: "Haben Sie kurz Zeit?", persona: "Ja, kurz." });
    expect(msgs.slice(-2)).toEqual([
      { t: "error", code: "KI_AUS", message: MELDUNG },
      { t: "bye", reason: "ki_aus" },
    ]);
    expect(d.turns.map((t) => t.role)).toEqual(["persona", "user", "persona"]);
    expect(dp.budget).not.toHaveBeenCalled();
    expect(regie).not.toHaveBeenCalled();
    expect(up.calls.at(-1)?.k).toBe("close");
    await run; // der Socket schließt nach dem bye-Frame
    expect(ws.closedWith[0]?.[0]).toBe(1000);
  });

  it("Takt-Prüfung: auch ohne fertigen Zug endet die Sitzung, sobald der Schalter aus ist", async () => {
    const ws = fakeSocket();
    let meldung: string | null = null;
    const { deps: dp, up } = deps({ kiAusMeldung: async () => meldung, kiPruefMs: 15 });
    const run = runLiveSession(ws, ticket, dp);
    await tick();
    await sleep(40);
    expect(json(ws).some((m) => m.t === "error")).toBe(false); // an: Sitzung läuft
    meldung = MELDUNG;
    await sleep(40);
    expect(json(ws).slice(-2)).toEqual([
      { t: "error", code: "KI_AUS", message: MELDUNG },
      { t: "bye", reason: "ki_aus" },
    ]);
    expect(up.calls.at(-1)?.k).toBe("close");
    await run;
  });

  it("an: die Takt-Prüfung endet mit der Verbindung", async () => {
    const ws = fakeSocket();
    const kiAusMeldung = vi.fn(async () => null);
    const { deps: dp } = deps({ kiAusMeldung, kiPruefMs: 10 });
    const run = runLiveSession(ws, ticket, dp);
    await tick();
    await sleep(35);
    ws.close(1000);
    await run;
    const nachDemEnde = kiAusMeldung.mock.calls.length;
    expect(nachDemEnde).toBeGreaterThan(1); // Start + Takt
    await sleep(35);
    expect(kiAusMeldung.mock.calls.length).toBe(nachDemEnde);
    expect(json(ws).some((m) => m.t === "error" || m.t === "bye")).toBe(false);
  });
});

vi.mock("server-only", () => ({}));
