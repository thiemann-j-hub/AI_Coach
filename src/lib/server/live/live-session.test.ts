import { describe, expect, it, vi } from "vitest";
import { getScenario } from "@/lib/simulation/scenarios";
import type { SimulationDoc } from "@/lib/server/simulation-store";
import {
  decideTimeSignal,
  runLiveSession,
  type LiveDeps,
  type LiveSocket,
  type Upstream,
  type UpstreamConfig,
  type UpstreamEvents,
  WS_OPEN,
} from "./live-session";

/** Browser-Socket als Attrappe: sammelt, was der Server schickt, und kann Nachrichten „empfangen“. */
function fakeSocket() {
  const handlers: Record<string, Array<(...a: never[]) => void>> = { message: [], close: [], error: [] };
  const sent: Array<string | Buffer> = [];
  let state = WS_OPEN;
  const ws: LiveSocket & { sent: typeof sent; emit(ev: string, ...a: unknown[]): void; closedWith: Array<[number?, string?]> } = {
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
    emit: (ev, ...a) => {
      for (const h of handlers[ev]) (h as (...x: unknown[]) => void)(...a);
    },
  };
  return ws;
}

function fakeUpstream() {
  const calls: Array<{ k: string; v?: unknown }> = [];
  let events: UpstreamEvents | null = null;
  let cfg: UpstreamConfig | null = null;
  const up: Upstream = {
    sendAudio: (b) => void calls.push({ k: "audio", v: b.length }),
    sendText: (text, turnComplete) => void calls.push({ k: "text", v: { text, turnComplete } }),
    sendHistory: (turns) => void calls.push({ k: "history", v: turns.length }),
    close: () => void calls.push({ k: "close" }),
  };
  const connect: LiveDeps["connect"] = async (c, ev) => {
    cfg = c;
    events = ev;
    calls.push({ k: "connect", v: { voice: c.voice, resume: c.resumeHandle } });
    return up;
  };
  return { calls, connect, ev: () => events!, cfg: () => cfg! };
}

function doc(over: Partial<SimulationDoc> = {}): SimulationDoc {
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
    ...over,
  };
}

function deps(over: Partial<LiveDeps> = {}, d: SimulationDoc = doc()) {
  const up = fakeUpstream();
  const saved: SimulationDoc[] = [];
  const base: LiveDeps = {
    connect: up.connect,
    loadSim: async () => d,
    saveSim: async (x) => void saved.push(JSON.parse(JSON.stringify(x))),
    loadScenario: async (_u, id) => getScenario(id),
    budget: async () => ({ allowed: true }),
    now: () => 1_000_000 + 60_000,
    log: () => {},
    model: "gemini-3.8-live",
    idleMs: 60_000,
    ...over,
  };
  return { deps: base, up, saved, doc: d };
}

const ticket = { uid: "u1", email: null, oid: null, simId: "sim-abcdefgh" };
const json = (ws: ReturnType<typeof fakeSocket>) => ws.sent.filter((s) => typeof s === "string").map((s) => JSON.parse(s as string));
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("Sprachmodus Live — Kern des Relais", () => {
  it("verbindet mit Stimme und Verlauf und meldet ready", async () => {
    const ws = fakeSocket();
    const { deps: dp, up } = deps();
    const run = runLiveSession(ws, ticket, dp);
    await tick();
    expect(up.cfg().voice).toBe("Aoede"); // Alex Morgan spricht mit Seraphina → live Aoede
    expect(up.cfg().languageCode).toBe("de-DE");
    expect(up.cfg().systemInstruction).toContain("GESPROCHENES GESPRÄCH");
    expect(up.calls.find((c) => c.k === "history")?.v).toBe(1);
    expect(json(ws)[0]).toEqual({ t: "ready", persona: "Alex Morgan", voice: "Aoede" });
    ws.close(1000);
    await run;
  });

  it("macht aus den Mitschriften Gesprächszüge und leitet Audio durch", async () => {
    const ws = fakeSocket();
    const { deps: dp, up, saved, doc: d } = deps();
    const run = runLiveSession(ws, ticket, dp);
    await tick();
    ws.emit("message", Buffer.alloc(3200), true);
    expect(up.calls.find((c) => c.k === "audio")?.v).toBe(3200);
    up.ev().onInputText("Guten Morgen, ");
    up.ev().onInputText("haben Sie kurz Zeit?");
    up.ev().onAudio(Buffer.from([1, 2, 3]));
    up.ev().onOutputText("Ja, aber nicht lange.");
    up.ev().onTurnComplete();
    await tick();
    await tick();
    const msgs = json(ws);
    expect(msgs.find((m) => m.t === "you")?.text).toBe("Guten Morgen, ");
    expect(ws.sent.some((s) => Buffer.isBuffer(s) && s.length === 3)).toBe(true);
    const turn = msgs.find((m) => m.t === "turn");
    expect(turn).toMatchObject({ user: "Guten Morgen, haben Sie kurz Zeit?", persona: "Ja, aber nicht lange.", timeUp: false });
    expect(d.turns.map((t) => t.role)).toEqual(["persona", "user", "persona"]);
    expect(saved.length).toBe(1);
    ws.close(1000);
    await run;
  });

  it("gibt die Zeit-Regie als Notiz weiter und schließt nach der Verabschiedung", async () => {
    const ws = fakeSocket();
    const d = doc();
    const durationMs = getScenario("sim-coaching-morgan")!.durationMin * 60_000;
    let now = 1_000_000 + durationMs * 0.85; // 85 % → „muss gleich los“
    const { deps: dp, up, doc: dd } = deps({ now: () => now }, d);
    const run = runLiveSession(ws, ticket, dp);
    await tick();
    const note = up.calls.find((c) => c.k === "text")?.v as { text: string; turnComplete: boolean };
    expect(note.text).toContain("REGIE");
    expect(note.turnComplete).toBe(false);
    expect(dd.timeWarned).toBe(true);

    now = 1_000_000 + durationMs + 1; // Zeit um → Verabschiedung anweisen
    up.ev().onInputText("Noch eine Frage.");
    up.ev().onOutputText("Gern.");
    up.ev().onTurnComplete();
    await tick();
    await tick();
    const farewell = up.calls.filter((c) => c.k === "text").at(-1)?.v as { text: string; turnComplete: boolean };
    expect(farewell.text).toMatch(/Zeit ist um/);
    expect(farewell.turnComplete).toBe(true);

    up.ev().onOutputText("Ich muss los, bis nächste Woche.");
    up.ev().onTurnComplete();
    await tick();
    await tick();
    expect(dd.closedByTime).toBe(true);
    const msgs = json(ws);
    expect(msgs.filter((m) => m.t === "turn").at(-1)).toMatchObject({ timeUp: true });
    expect(msgs.at(-1)).toEqual({ t: "bye", reason: "time_up" });
    await new Promise((r) => setTimeout(r, 350));
    expect(ws.closedWith[0]?.[0]).toBe(1000);
    await run;
  });

  it("lehnt einen beendeten Lauf ab", async () => {
    const ws = fakeSocket();
    const { deps: dp } = deps({}, doc({ status: "finished" }));
    await runLiveSession(ws, ticket, dp);
    expect(json(ws)[0]).toEqual({ t: "error", code: "ALREADY_FINISHED" });
    expect(ws.closedWith[0]?.[0]).toBe(4409);
  });

  it("verbindet nach einem Abriss mit der Wiederaufnahme-Marke neu", async () => {
    const ws = fakeSocket();
    const { deps: dp, up } = deps();
    const run = runLiveSession(ws, ticket, dp);
    await tick();
    up.ev().onResumptionHandle("marke-1");
    up.ev().onClose("1011 Sitzungsgrenze");
    await tick();
    const connects = up.calls.filter((c) => c.k === "connect");
    expect(connects.length).toBe(2);
    expect(connects[1].v).toEqual({ voice: "Aoede", resume: "marke-1" });
    expect(up.calls.filter((c) => c.k === "history").length).toBe(1); // Verlauf nur beim ersten Mal
    ws.close(1000);
    await run;
  });

  it("endet bei erschöpftem Budget", async () => {
    const ws = fakeSocket();
    const { deps: dp, up } = deps({ budget: async () => ({ allowed: false }) });
    const run = runLiveSession(ws, ticket, dp);
    await tick();
    up.ev().onInputText("Hallo");
    up.ev().onOutputText("Hallo zurück");
    up.ev().onTurnComplete();
    await tick();
    await tick();
    expect(json(ws).at(-1)).toEqual({ t: "bye", reason: "budget" });
    await new Promise((r) => setTimeout(r, 350));
    await run;
  });

  it("speichert Angefangenes, wenn der Browser mitten im Zug auflegt", async () => {
    const ws = fakeSocket();
    const { deps: dp, up, doc: d } = deps();
    const run = runLiveSession(ws, ticket, dp);
    await tick();
    up.ev().onInputText("Ich wollte noch sagen");
    ws.close(1001);
    await run;
    expect(d.turns.at(-1)).toMatchObject({ role: "user", text: "Ich wollte noch sagen" });
    expect(up.calls.at(-1)?.k).toBe("close");
  });
});

describe("decideTimeSignal", () => {
  const createdAt = new Date(0).toISOString();
  it("folgt der Turn-Route: 80 % → closing (einmal), 100 % → farewell", () => {
    expect(decideTimeSignal({ createdAt, now: 5 * 60_000, durationMin: 10, timeWarned: false })).toBeUndefined();
    expect(decideTimeSignal({ createdAt, now: 8 * 60_000, durationMin: 10, timeWarned: false })).toBe("closing");
    expect(decideTimeSignal({ createdAt, now: 8 * 60_000, durationMin: 10, timeWarned: true })).toBeUndefined();
    expect(decideTimeSignal({ createdAt, now: 10 * 60_000, durationMin: 10, timeWarned: true })).toBe("farewell");
  });
});

vi.mock("server-only", () => ({}));
