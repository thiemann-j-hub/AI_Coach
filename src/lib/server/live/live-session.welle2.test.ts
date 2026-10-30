import { describe, expect, it } from "vitest";
import { getScenario } from "@/lib/simulation/scenarios";
import type { SimulationDoc } from "@/lib/server/simulation-store";
import {
  ENDE_WERKZEUG,
  latencyStats,
  liveAddendum,
  parseEndeCall,
  runLiveSession,
  type LiveDeps,
  type LiveSocket,
  type Upstream,
  type UpstreamConfig,
  type UpstreamEvents,
  WS_OPEN,
} from "./live-session";

/** Kleine Attrappen wie im Haupttest — hier nur das, was Welle 2 braucht. */
function fakeSocket() {
  const handlers: Record<string, Array<(...a: never[]) => void>> = { message: [], close: [], error: [] };
  const sent: Array<string | Buffer> = [];
  let state = WS_OPEN;
  const ws: LiveSocket & { sent: typeof sent; emit(ev: string, ...a: unknown[]): void } = {
    sent,
    get readyState() {
      return state;
    },
    send: (d) => void sent.push(d),
    close: () => {
      if (state !== WS_OPEN) return;
      state = 3;
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
    sendAudio: () => void calls.push({ k: "audio" }),
    sendText: (text, turnComplete) => void calls.push({ k: "text", v: { text, turnComplete } }),
    sendHistory: () => void calls.push({ k: "history" }),
    sendToolResponse: (r) => void calls.push({ k: "tool", v: r }),
    close: () => void calls.push({ k: "close" }),
  };
  const connect: LiveDeps["connect"] = async (c, ev) => {
    cfg = c;
    events = ev;
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
    turns: [{ role: "persona", text: "Hi!", ts: new Date(1_000_000).toISOString() }],
    convoLocale: "de",
    ...over,
  };
}

const ticket = { uid: "u1", email: null, oid: null, simId: "sim-abcdefgh" };
const json = (ws: ReturnType<typeof fakeSocket>) => ws.sent.filter((s) => typeof s === "string").map((s) => JSON.parse(s as string));
const tick = () => new Promise((r) => setTimeout(r, 0));

function deps(up: ReturnType<typeof fakeUpstream>, d: SimulationDoc, over: Partial<LiveDeps> = {}) {
  const saved: SimulationDoc[] = [];
  let now = 1_000_000 + 60_000;
  const base: LiveDeps = {
    connect: up.connect,
    loadSim: async () => d,
    saveSim: async (x) => void saved.push(JSON.parse(JSON.stringify(x))),
    loadScenario: async (_u, id) => getScenario(id),
    budget: async () => ({ allowed: true }),
    now: () => now,
    log: () => {},
    model: "gemini-3.8-live",
    idleMs: 60_000,
    ...over,
  };
  return { deps: base, saved, advance: (ms: number) => (now += ms) };
}

describe("Sprachmodus Live — Welle 2", () => {
  it("bietet das Ende-Werkzeug an und erklärt es in der Anweisung", async () => {
    const ws = fakeSocket();
    const up = fakeUpstream();
    const { deps: d } = deps(up, doc());
    const run = runLiveSession(ws, ticket, d);
    await tick();
    expect(up.cfg().endeWerkzeug).toBe(true);
    expect(up.cfg().systemInstruction).toContain(ENDE_WERKZEUG);
    expect(up.cfg().systemInstruction).toContain("GESPRÄCHSENDE");
    expect(up.cfg().systemInstruction).toContain("FREIGABE-REGEL");
    ws.emit("close");
    await run;
  });

  it("schließt den Lauf, wenn die Rolle das Werkzeug ruft: Antwort ans Modell, ended an den Browser, Doc markiert", async () => {
    const ws = fakeSocket();
    const up = fakeUpstream();
    const d0 = doc();
    const { deps: d, saved } = deps(up, d0);
    const run = runLiveSession(ws, ticket, d);
    await tick();
    up.ev().onInputText("Dann machen wir das so, bis Freitag.");
    up.ev().onOutputText("Passt. Danke dir, ich muss rüber in den Call.");
    up.ev().onToolCall([{ id: "c1", name: ENDE_WERKZEUG, args: { grund: "Termin vereinbart.", ergebnis: "ziel" } }]);
    up.ev().onTurnComplete();
    await tick();
    await tick();
    const tool = up.calls.find((c) => c.k === "tool");
    expect(tool?.v).toEqual([{ id: "c1", name: ENDE_WERKZEUG, response: { ok: true } }]);
    const msgs = json(ws);
    expect(msgs.find((m) => m.t === "turn")?.ended).toBe(true);
    expect(msgs.find((m) => m.t === "ended")).toEqual({ t: "ended", grund: "Termin vereinbart.", ergebnis: "ziel" });
    expect(msgs.find((m) => m.t === "bye")?.reason).toBe("ended_by_persona");
    expect(saved.at(-1)?.closedByPersona?.ergebnis).toBe("ziel");
    ws.emit("close");
    await run;
  });

  it("lehnt einen von der Rolle beendeten Lauf ab", async () => {
    const ws = fakeSocket();
    const up = fakeUpstream();
    const { deps: d } = deps(up, doc({ closedByPersona: { grund: "x", ergebnis: "ziel", at: "t" } }));
    await runLiveSession(ws, ticket, d);
    expect(json(ws)[0]).toEqual({ t: "error", code: "ENDED" });
  });

  it("gibt die Regie-Notiz des Beobachters nach einem Zug der lernenden Person weiter", async () => {
    const ws = fakeSocket();
    const up = fakeUpstream();
    const d0 = doc();
    const { deps: d, saved } = deps(up, d0, {
      regie: async () => ({ stufe: 1, erfuellt: ["Anerkennung kam"], eskaliert: false, notiz: "Du stehst jetzt auf Stufe 1.", turn: 3, ts: "t" }),
    });
    const run = runLiveSession(ws, ticket, d);
    await tick();
    up.ev().onInputText("Ich sehe, wie viel du leistest.");
    up.ev().onOutputText("Danke.");
    up.ev().onTurnComplete();
    await tick();
    await tick();
    await tick();
    const note = up.calls.find((c) => c.k === "text" && String((c.v as { text: string }).text).includes("REGIE"));
    expect(note).toBeTruthy();
    expect((note!.v as { turnComplete: boolean }).turnComplete).toBe(false);
    expect(saved.at(-1)?.regie?.[0]?.stufe).toBe(1);
    ws.emit("close");
    await run;
  });

  it("warnt vor dem Stille-Abbruch und misst die Antwortzeit", async () => {
    const ws = fakeSocket();
    const up = fakeUpstream();
    const d0 = doc();
    const { deps: d, saved, advance } = deps(up, d0, { idleMs: 50, idleWarnMs: 30 });
    const run = runLiveSession(ws, ticket, d);
    await tick();
    up.ev().onInputText("Hallo.");
    advance(1_200);
    up.ev().onAudio(Buffer.alloc(10));
    up.ev().onOutputText("Hallo zurück.");
    up.ev().onTurnComplete();
    await new Promise((r) => setTimeout(r, 70));
    const msgs = json(ws);
    expect(msgs.find((m) => m.t === "idle_warn")).toBeTruthy();
    expect(msgs.find((m) => m.t === "bye")?.reason).toBe("idle");
    await run;
    expect(saved.at(-1)?.liveStats).toEqual({ antworten: 1, p50Ms: 1200, p95Ms: 1200, maxMs: 1200 });
  });
});

describe("Welle 2 — reine Helfer", () => {
  it("latencyStats rechnet p50/p95/max", () => {
    expect(latencyStats([])).toBeNull();
    expect(latencyStats([300, 900, 1500, 2100])).toEqual({ antworten: 4, p50Ms: 900, p95Ms: 2100, maxMs: 2100 });
  });
  it("parseEndeCall liest nur das Ende-Werkzeug und normalisiert das Ergebnis", () => {
    expect(parseEndeCall({ name: "andere", args: {} })).toBeNull();
    expect(parseEndeCall({ name: ENDE_WERKZEUG, args: { grund: "x", ergebnis: "ABBRUCH" } })).toEqual({ grund: "x", ergebnis: "abbruch" });
    expect(parseEndeCall({ name: ENDE_WERKZEUG, args: {} })).toEqual({ grund: "", ergebnis: "verabschiedung" });
  });
  it("liveAddendum nennt das Werkzeug nur, wenn es angeboten wird", () => {
    expect(liveAddendum("de")).not.toContain(ENDE_WERKZEUG);
    expect(liveAddendum("de", true)).toContain(ENDE_WERKZEUG);
    expect(liveAddendum("en", true)).toContain("ENDING");
  });
});
