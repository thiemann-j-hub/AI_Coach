import { describe, expect, it, vi } from "vitest";
import { getScenario } from "@/lib/simulation/scenarios";
import type { SimulationDoc } from "@/lib/server/simulation-store";
import { PAUSE_MAX_GESAMT_MS } from "@/lib/simulation/zeit";
import {
  decideTimeSignal,
  eroeffnungsNote,
  liveKennzahlen,
  runLiveSession,
  type LiveDeps,
  type LiveSessionOptions,
  type LiveSocket,
  type Upstream,
  type UpstreamConfig,
  type UpstreamEvents,
  WS_OPEN,
} from "./live-session";

/**
 * Paket 4 (12.11.2026, „Sprechen nach vorn“): Relais-Kern über `LiveDeps`. Den Sprachweg kann niemand mit einem
 * echten Mikrofon testen; umso genauer stehen hier Coach-Pause (C13), hörbare Eröffnung (S1), „nur Gehörtes in den
 * Verlauf“ (S31), Zustand und Verbindung (C15), Rückstau (C36), Zählpunkt (S24) und Kennzahlen (S22).
 */
function fakeSocket() {
  const handlers: Record<string, Array<(...a: never[]) => void>> = { message: [], close: [], error: [] };
  const sent: Array<string | Buffer> = [];
  let state = WS_OPEN;
  const ws: LiveSocket & { sent: typeof sent; gestaut: number; emit(ev: string, ...a: unknown[]): void } = {
    sent,
    gestaut: 0,
    get readyState() {
      return state;
    },
    get bufferedAmount() {
      return ws.gestaut;
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

type Verbindung = { cfg: UpstreamConfig; ev: UpstreamEvents; calls: Array<{ k: string; v?: unknown }>; zu: boolean };

/** Jede Verbindung zur KI ist eine eigene Attrappe: So zeigt sich, welche trägt und welche abgelöst ist. */
function verbindungen() {
  const liste: Verbindung[] = [];
  const naechste: Array<{ fehler?: Error; warte?: Promise<void> }> = [];
  const connect: LiveDeps["connect"] = async (cfg, ev) => {
    const plan = naechste.shift();
    if (plan?.warte) await plan.warte;
    if (plan?.fehler) throw plan.fehler;
    const v: Verbindung = { cfg, ev, calls: [], zu: false };
    const up: Upstream = {
      sendAudio: (b) => void v.calls.push({ k: "audio", v: b.length }),
      sendText: (text, turnComplete) => void v.calls.push({ k: "text", v: { text, turnComplete } }),
      sendHistory: (turns) => void v.calls.push({ k: "history", v: turns }),
      close: () => {
        v.zu = true;
      },
    };
    liste.push(v);
    return up;
  };
  return {
    liste,
    connect,
    /** Der nächste Verbindungsversuch scheitert. */
    scheitert: (fehler: Error) => void naechste.push({ fehler }),
    /** Der nächste Verbindungsversuch wartet, bis die zurückgegebene Funktion gerufen wird. */
    haelt: () => {
      let los: () => void = () => {};
      naechste.push({ warte: new Promise<void>((r) => (los = r)) });
      return () => los();
    },
  };
}

const T0 = 1_000_000;
const MIN = 60_000;
const MORGAN_MS = getScenario("sim-coaching-morgan")!.durationMin * MIN;
const ERSTER_SATZ = "Guten Morgen. Du wolltest mich sprechen?";

function doc(over: Partial<SimulationDoc> = {}): SimulationDoc {
  return {
    id: "sim-abcdefgh",
    sessionId: "sim:u1",
    docType: "simulation",
    uid: "u1",
    scenarioId: "sim-coaching-morgan",
    createdAt: new Date(T0).toISOString(),
    updatedAt: new Date(T0).toISOString(),
    status: "active",
    turns: [{ role: "persona", text: ERSTER_SATZ, ts: new Date(T0).toISOString() }],
    convoLocale: "de",
    ...over,
  };
}

const ticket = { uid: "u1", email: null, oid: null, simId: "sim-abcdefgh" };
const tick = () => new Promise((r) => setTimeout(r, 0));
const warte = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ruhe = async () => {
  for (let i = 0; i < 4; i++) await tick();
};
const frame = (m: Record<string, unknown>) => Buffer.from(JSON.stringify(m));
/** Ton der Rolle für `ms` Millisekunden (PCM 24 kHz, 16 Bit, Mono = 48 Bytes je Millisekunde). */
const ton = (ms: number) => Buffer.alloc(48 * ms);

function sitzung(d: SimulationDoc = doc(), over: Partial<LiveDeps> = {}, opts: LiveSessionOptions = {}) {
  const ws = fakeSocket();
  const ki = verbindungen();
  const saved: SimulationDoc[] = [];
  const zaehlpunkte: string[] = [];
  let now = T0 + MIN;
  const deps: LiveDeps = {
    connect: ki.connect,
    loadSim: async () => structuredClone(d),
    updateSim: async (_u, _s, mutate) => {
      const frisch = structuredClone(d);
      if (mutate(frisch) === false) return frisch;
      Object.assign(d, frisch);
      saved.push(structuredClone(d));
      return structuredClone(d);
    },
    loadScenario: async (_u, id) => getScenario(id),
    budget: async () => ({ allowed: true }),
    now: () => now,
    log: () => {},
    model: "gemini-3.8-live",
    idleMs: 60_000,
    sitzungen: new Map(),
    zaehlpunkt: (schritt, meta) => void zaehlpunkte.push(`${schritt}:${meta.scenarioId}:${meta.weg}`),
    ...over,
  };
  const run = runLiveSession(ws, ticket, deps, opts);
  const json = () => ws.sent.filter((s) => typeof s === "string").map((s) => JSON.parse(s as string));
  return {
    ws,
    ki,
    d,
    saved,
    zaehlpunkte,
    run,
    json,
    advance: (ms: number) => (now += ms),
    jetzt: () => now,
    /** Die Verbindung, die gerade trägt (die zuletzt aufgebaute). */
    v: () => ki.liste[ki.liste.length - 1],
    audioAnKi: () => ki.liste.flatMap((v) => v.calls).filter((c) => c.k === "audio").length,
    tonAnBrowser: () => ws.sent.filter((s) => Buffer.isBuffer(s)).length,
    ende: async () => {
      ws.close();
      await run;
    },
  };
}

describe("Coach-Pause im Relais (C13)", () => {
  it("in der Pause geht kein Mikrofon-Audio an die KI; die Pausenzeit steht am Lauf", async () => {
    const s = sitzung();
    await ruhe();
    s.ws.emit("message", Buffer.alloc(320), true);
    expect(s.audioAnKi()).toBe(1);

    s.ws.emit("message", frame({ t: "pause" }), false);
    await ruhe();
    expect(s.d.pauseSince).toBe(new Date(s.jetzt()).toISOString());
    s.ws.emit("message", Buffer.alloc(320), true);
    s.ws.emit("message", Buffer.alloc(320), true);
    expect(s.audioAnKi()).toBe(1);

    s.advance(90_000);
    s.ws.emit("message", frame({ t: "resume" }), false);
    await ruhe();
    expect(s.d).toMatchObject({ pausedMs: 90_000, pauseSince: null });
    s.ws.emit("message", Buffer.alloc(320), true);
    expect(s.audioAnKi()).toBe(2);
    await s.ende();
  });

  it("ready trägt die Pausenfelder des Laufs für die Uhr im Browser", async () => {
    const seit = new Date(T0 + 30_000).toISOString();
    // Mitten im Gespräch (die Person hat schon gesprochen): Eine Coach-Pause übersteht das Neuverbinden.
    const s = sitzung(doc({ pausedMs: 45_000, pauseSince: seit, turns: [
        { role: "persona", text: ERSTER_SATZ, ts: new Date(T0).toISOString() },
        { role: "user", text: "Ja, kurz.", ts: new Date(T0 + 5_000).toISOString() },
      ], }));
    await ruhe();
    expect(s.json()[0]).toMatchObject({ t: "ready", pausedMs: 45_000, pauseSince: seit });
    await s.ende();
  });

  it("Mikrofon-Check: Ein Lauf, der mit angehaltener Uhr beginnt, läuft ab dem Start des Sprachgesprächs", async () => {
    // Start mit „Sprechen“ setzt pauseSince; die Person hat noch nichts gesagt. Der Check dauerte 40 Sekunden.
    const s = sitzung(doc({ pauseSince: new Date(T0 + 20_000).toISOString() }));
    await ruhe();
    expect(s.d).toMatchObject({ pausedMs: 40_000, pauseSince: null });
    expect(s.json()[0]).toMatchObject({ t: "ready", pausedMs: 40_000, pauseSince: null });
    await s.ende();
  });

  it("die Stille-Uhr steht in der Pause und läuft danach neu an", async () => {
    const s = sitzung(doc(), { idleMs: 400, idleWarnMs: 200 });
    await ruhe();
    s.ws.emit("message", frame({ t: "pause" }), false);
    await warte(550);
    expect(s.json().some((m) => m.t === "idle_warn" || m.t === "bye")).toBe(false);
    s.ws.emit("message", frame({ t: "resume" }), false);
    await warte(550);
    expect(s.json().find((m) => m.t === "bye")?.reason).toBe("idle");
    await s.run;
  });

  it("eine Pause endet spätestens am Deckel von selbst", async () => {
    // Echte Uhr: vom Gesamtdeckel (15 Minuten) sind nur noch 300 ms übrig.
    const d = doc({ createdAt: new Date(Date.now() - MIN).toISOString(), pausedMs: PAUSE_MAX_GESAMT_MS - 300 });
    const s = sitzung(d, { now: () => Date.now() });
    await ruhe();
    s.ws.emit("message", frame({ t: "pause" }), false);
    await ruhe();
    expect(s.d.pauseSince).toBeTruthy();
    s.ws.emit("message", Buffer.alloc(320), true);
    expect(s.audioAnKi()).toBe(0);
    await warte(500);
    expect(s.d).toMatchObject({ pausedMs: PAUSE_MAX_GESAMT_MS, pauseSince: null });
    s.ws.emit("message", Buffer.alloc(320), true);
    expect(s.audioAnKi()).toBe(1); // das Mikrofon geht wieder an die KI
    await s.ende();
  });

  it("Zeit-Regie nach einer Pause: gezählt wird die Gesprächszeit ohne Pause", async () => {
    // 87 % der Zeit nach der Wanduhr, davon 3 Minuten Pause: 67 % Gesprächszeit, also noch kein Hinweis.
    const start = T0 + MIN - MORGAN_MS * 0.87;
    const d = doc({ createdAt: new Date(start).toISOString(), pausedMs: 3 * MIN, turns: [{ role: "persona", text: ERSTER_SATZ, ts: "t0" }] });
    const s = sitzung(d);
    await ruhe();
    expect(s.v().calls.some((c) => c.k === "text")).toBe(false);
    expect(s.d.timeWarned).toBeUndefined();

    // In der Sitzung noch einmal 4 Minuten Pause: Auch danach steht die Uhr bei 67 % plus Gesprochenem.
    s.ws.emit("message", frame({ t: "pause" }), false);
    await ruhe();
    s.advance(4 * MIN);
    s.ws.emit("message", frame({ t: "resume" }), false);
    await ruhe();
    s.v().ev.onInputText("Wo stehen wir?");
    s.v().ev.onOutputText("Mittendrin.");
    s.v().ev.onTurnComplete();
    await ruhe();
    expect(s.d.pausedMs).toBe(7 * MIN);
    expect(s.v().calls.some((c) => c.k === "text")).toBe(false);

    // Ohne Pause wäre der Hinweis längst fällig: Die Gegenprobe rechnet dieselben Zeiten ohne Abzug.
    expect(decideTimeSignal({ createdAt: d.createdAt, now: s.jetzt(), durationMin: MORGAN_MS / MIN, timeWarned: false })).toBe("farewell");
    expect(decideTimeSignal({ createdAt: d.createdAt, pausedMs: 7 * MIN, now: s.jetzt(), durationMin: MORGAN_MS / MIN, timeWarned: false })).toBeUndefined();
    await s.ende();
  });

  it("ein eigener Zug beendet eine Pause, die am Lauf offen geblieben ist", async () => {
    const d = doc({ pauseSince: new Date(T0 + 50_000).toISOString(), turns: [
        { role: "persona", text: ERSTER_SATZ, ts: new Date(T0).toISOString() },
        { role: "user", text: "Ja, kurz.", ts: new Date(T0 + 5_000).toISOString() },
      ], });
    const s = sitzung(d);
    await ruhe();
    s.advance(20_000); // die Pause läuft seit 30 Sekunden
    s.v().ev.onInputText("Ich bin wieder da.");
    s.v().ev.onOutputText("Gut.");
    s.v().ev.onTurnComplete();
    await ruhe();
    expect(s.d).toMatchObject({ pausedMs: 30_000, pauseSince: null });
    await s.ende();
  });

  it("im Prüfungsmodus gibt es keine Pause", async () => {
    const s = sitzung(doc({ mode: "check" }));
    await ruhe();
    s.ws.emit("message", frame({ t: "pause" }), false);
    await ruhe();
    s.ws.emit("message", Buffer.alloc(320), true);
    expect(s.audioAnKi()).toBe(1);
    expect(s.d.pauseSince).toBeUndefined();
    await s.ende();
  });
});

describe("Hörbare Eröffnung (S1)", () => {
  it("die Rolle spricht ihren gespeicherten Eröffnungssatz; er wird weder noch einmal gespeichert noch als Zug gemeldet", async () => {
    const s = sitzung(doc(), {}, { eroeffnung: true });
    await ruhe();
    expect(s.json()[0]).toMatchObject({ t: "ready", eroeffnung: true });
    // Kein Verlauf vorab: Der Satz entsteht gleich im Gespräch der KI. Der Auftrag nennt ihn wörtlich.
    expect(s.v().calls.some((c) => c.k === "history")).toBe(false);
    const auftrag = s.v().calls.find((c) => c.k === "text")?.v as { text: string; turnComplete: boolean };
    expect(auftrag.text).toBe(eroeffnungsNote("de", ERSTER_SATZ));
    expect(auftrag.text).toContain(`»${ERSTER_SATZ}«`);
    expect(auftrag.turnComplete).toBe(true);

    s.v().ev.onAudio(ton(300));
    s.v().ev.onOutputText("Guten Morgen. ");
    s.v().ev.onOutputText("Du wolltest mich sprechen?");
    s.v().ev.onTurnComplete();
    await ruhe();
    expect(s.tonAnBrowser()).toBe(1); // der Ton geht durch
    expect(s.json().some((m) => m.t === "persona" || m.t === "turn")).toBe(false);
    expect(s.saved).toHaveLength(0);
    expect(s.d.turns).toHaveLength(1);

    // Danach läuft das Gespräch wie immer.
    s.v().ev.onInputText("Ja, hast Du kurz Zeit?");
    s.v().ev.onAudio(ton(200));
    s.v().ev.onOutputText("Klar.");
    s.v().ev.onTurnComplete();
    await ruhe();
    expect(s.json().find((m) => m.t === "turn")).toMatchObject({ user: "Ja, hast Du kurz Zeit?", persona: "Klar." });
    expect(s.d.turns.map((t) => t.text)).toEqual([ERSTER_SATZ, "Ja, hast Du kurz Zeit?", "Klar."]);
    await s.ende();
  });

  it("fällt die Person der Eröffnung ins Wort, landet kein Rest der Eröffnung im Verlauf", async () => {
    const s = sitzung(doc(), {}, { eroeffnung: true });
    await ruhe();
    s.v().ev.onAudio(ton(300));
    s.v().ev.onOutputText("Guten Morgen. ");
    s.v().ev.onInterrupted();
    s.v().ev.onOutputText("Du wolltest mich sprechen?"); // Nachzügler der Mitschrift
    s.v().ev.onTurnComplete();
    await ruhe();
    expect(s.saved).toHaveLength(0);
    s.v().ev.onInputText("Entschuldige, ich bin spät.");
    s.v().ev.onOutputText("Kein Problem.");
    s.v().ev.onTurnComplete();
    await ruhe();
    expect(s.d.turns.map((t) => t.text)).toEqual([ERSTER_SATZ, "Entschuldige, ich bin spät.", "Kein Problem."]);
    await s.ende();
  });

  it("hat die Person schon etwas gesagt, eröffnet die Rolle nicht noch einmal", async () => {
    const d = doc({
      turns: [
        { role: "persona", text: ERSTER_SATZ, ts: "t0" },
        { role: "user", text: "Ja.", ts: "t1" },
        { role: "persona", text: "Worum geht es?", ts: "t1" },
      ],
    });
    const s = sitzung(d, {}, { eroeffnung: true });
    await ruhe();
    expect(s.json()[0]).toMatchObject({ t: "ready", eroeffnung: false });
    expect((s.v().calls.find((c) => c.k === "history")?.v as unknown[]).length).toBe(3);
    expect(s.v().calls.some((c) => c.k === "text")).toBe(false);
    await s.ende();
  });

  it("ohne Wunsch im hello bleibt alles wie bisher; ist die Zeit um, verabschiedet sich die Rolle statt zu eröffnen", async () => {
    const ohne = sitzung();
    await ruhe();
    expect(ohne.json()[0]).toMatchObject({ t: "ready", eroeffnung: false });
    expect(ohne.v().calls.map((c) => c.k)).toEqual(["history"]);
    await ohne.ende();

    const spaet = sitzung(doc({ createdAt: new Date(T0 + MIN - MORGAN_MS - 1).toISOString() }), {}, { eroeffnung: true });
    await ruhe();
    expect(spaet.json()[0]).toMatchObject({ t: "ready", eroeffnung: false });
    const notiz = spaet.v().calls.find((c) => c.k === "text")?.v as { text: string };
    expect(notiz.text).toMatch(/Zeit ist um/);
    await spaet.ende();
  });
});

describe("Nur Gehörtes in den Verlauf (S31)", () => {
  /** Eine Antwort in vier Stücken, zusammen 4 Sekunden Ton. */
  const antwort = (s: ReturnType<typeof sitzung>) => {
    s.v().ev.onInputText("Wie siehst Du das?");
    s.v().ev.onAudio(ton(400));
    s.v().ev.onOutputText("Das sehe ich anders.");
    s.v().ev.onAudio(ton(1_100));
    s.v().ev.onOutputText(" Ich habe drei Kunde");
    s.v().ev.onAudio(ton(1_100));
    s.v().ev.onOutputText("n gleichzeitig, ");
    s.v().ev.onAudio(ton(1_400));
    s.v().ev.onOutputText("und keiner wartet gern.");
  };
  const VOLL = "Das sehe ich anders. Ich habe drei Kunden gleichzeitig, und keiner wartet gern.";

  it("Unterbrechung früh: der Browser meldet 900 ms, gespeichert und gemeldet wird nur der erste Satz", async () => {
    const s = sitzung();
    await ruhe();
    antwort(s);
    s.v().ev.onInterrupted();
    s.ws.emit("message", frame({ t: "heard", ms: 900 }), false);
    s.v().ev.onTurnComplete();
    await ruhe();
    const msgs = s.json();
    expect(msgs.filter((m) => m.t === "persona").at(-1)?.text).toBe("Das sehe ich anders. …");
    expect(msgs.find((m) => m.t === "turn")).toMatchObject({ user: "Wie siehst Du das?", persona: "Das sehe ich anders. …" });
    expect(s.d.turns.at(-1)).toMatchObject({ role: "persona", text: "Das sehe ich anders. …" });
    expect(s.d.liveStats).toMatchObject({ unterbrechungen: 1, gekuerztZeichen: VOLL.length - 20 });
    await s.ende();
  });

  it("Unterbrechung spät: an der Wortgrenze gekürzt, mit „…“", async () => {
    const s = sitzung();
    await ruhe();
    antwort(s);
    s.v().ev.onInterrupted();
    s.ws.emit("message", frame({ t: "heard", ms: 3_000 }), false);
    s.v().ev.onTurnComplete();
    await ruhe();
    expect(s.d.turns.at(-1)?.text).toBe("Das sehe ich anders. Ich habe drei Kunden gleichzeitig…");
    await s.ende();
  });

  it("alles gehört: der Text bleibt unverändert, der Browser bekommt keinen zweiten Text", async () => {
    const s = sitzung();
    await ruhe();
    antwort(s);
    const vorher = s.json().filter((m) => m.t === "persona").length;
    s.v().ev.onInterrupted();
    s.ws.emit("message", frame({ t: "heard", ms: 4_000 }), false);
    s.v().ev.onTurnComplete();
    await ruhe();
    expect(s.d.turns.at(-1)?.text).toBe(VOLL);
    expect(s.json().filter((m) => m.t === "persona")).toHaveLength(vorher);
    expect(s.d.liveStats).toMatchObject({ unterbrechungen: 1, gekuerztZeichen: 0 });
    await s.ende();
  });

  it("ohne heard (alter Client): Schätzung aus der Zeit seit dem ersten Ton, nach kurzem Warten", async () => {
    const s = sitzung(doc(), { gehoertWarteMs: 250 });
    await ruhe();
    antwort(s);
    s.advance(1_600); // seit dem ersten Ton sind 1,6 Sekunden vergangen
    s.v().ev.onInterrupted();
    s.v().ev.onTurnComplete();
    await ruhe();
    expect(s.json().some((m) => m.t === "turn")).toBe(false); // das Relais wartet noch auf den Browser
    await warte(400);
    expect(s.json().find((m) => m.t === "turn")?.persona).toBe("Das sehe ich anders. Ich habe drei…");
    expect(s.d.turns.at(-1)?.text).toBe("Das sehe ich anders. Ich habe drei…");
    await s.ende();
  });

  it("nichts gehört: kein Zug der Rolle, der Browser leert die Mitschrift", async () => {
    const s = sitzung();
    await ruhe();
    antwort(s);
    s.v().ev.onInterrupted();
    s.ws.emit("message", frame({ t: "heard", ms: 0 }), false);
    s.v().ev.onTurnComplete();
    await ruhe();
    expect(s.json().filter((m) => m.t === "persona").at(-1)?.text).toBe("");
    expect(s.json().find((m) => m.t === "turn")).toMatchObject({ user: "Wie siehst Du das?", persona: null });
    expect(s.d.turns.map((t) => t.role)).toEqual(["persona", "user"]);
    await s.ende();
  });

  it("was die Person nach der Unterbrechung sagt, gehört zum nächsten Zug (auch wenn heard noch aussteht)", async () => {
    const s = sitzung(doc(), { gehoertWarteMs: 2_000 });
    await ruhe();
    antwort(s);
    s.v().ev.onInterrupted();
    s.v().ev.onOutputText(" Nachzügler."); // Mitschrift der abgebrochenen Antwort: zählt nicht mehr
    s.v().ev.onTurnComplete();
    s.v().ev.onInputText("Moment, das stimmt so nicht.");
    s.ws.emit("message", frame({ t: "heard", ms: 900 }), false);
    await ruhe();
    s.v().ev.onAudio(ton(300));
    s.v().ev.onOutputText("Dann erklär es mir.");
    s.v().ev.onTurnComplete();
    await ruhe();
    expect(s.json().filter((m) => m.t === "turn").map((m) => [m.user, m.persona])).toEqual([
      ["Wie siehst Du das?", "Das sehe ich anders. …"],
      ["Moment, das stimmt so nicht.", "Dann erklär es mir."],
    ]);
    expect(s.d.turns.map((t) => t.text)).toEqual([
      ERSTER_SATZ,
      "Wie siehst Du das?",
      "Das sehe ich anders. …",
      "Moment, das stimmt so nicht.",
      "Dann erklär es mir.",
    ]);
    await s.ende();
  });

  it("nach der hörbaren Eröffnung: ihr Ton steckt im heard des Browsers und wird herausgerechnet", async () => {
    // Die Eröffnung endet ohne `turn`; der Browser zählt seinen abgespielten Ton deshalb ab der Eröffnung.
    const s = sitzung(doc(), {}, { eroeffnung: true });
    await ruhe();
    s.v().ev.onAudio(ton(1_500));
    s.v().ev.onOutputText(ERSTER_SATZ);
    s.v().ev.onTurnComplete();
    await ruhe();
    antwort(s);
    s.v().ev.onInterrupted();
    s.ws.emit("message", frame({ t: "heard", ms: 1_500 + 900 }), false); // 1,5 s Eröffnung + 0,9 s dieser Antwort
    s.v().ev.onTurnComplete();
    await ruhe();
    expect(s.d.turns.at(-1)?.text).toBe("Das sehe ich anders. …");

    // Nach einem gemeldeten Zug zählt der Browser neu: Jetzt gilt sein Wert unverändert.
    antwort(s);
    s.v().ev.onInterrupted();
    s.ws.emit("message", frame({ t: "heard", ms: 1_600 }), false);
    s.v().ev.onTurnComplete();
    await ruhe();
    expect(s.d.turns.at(-1)?.text).toBe("Das sehe ich anders. Ich habe drei…");
    await s.ende();
  });

  it("legt der Browser während des Wartens auf, wird trotzdem nur das Gehörte gespeichert", async () => {
    const s = sitzung(doc(), { gehoertWarteMs: 5_000 });
    await ruhe();
    antwort(s);
    s.advance(500);
    s.v().ev.onInterrupted();
    await s.ende(); // hängt nicht an der Frist
    expect(s.d.turns.map((t) => t.text)).toEqual([ERSTER_SATZ, "Wie siehst Du das?", "Das sehe ich anders. …"]);
  });

  it("ohne Unterbrechung bleibt die Antwort unverändert", async () => {
    const s = sitzung();
    await ruhe();
    antwort(s);
    s.v().ev.onTurnComplete();
    await ruhe();
    expect(s.d.turns.at(-1)?.text).toBe(VOLL);
    expect(s.d.liveStats?.unterbrechungen).toBe(0);
    await s.ende();
  });
});

describe("Zustand „denkt nach“", () => {
  it("thinking, sobald nach der Mitschrift der Person nichts mehr kommt und noch kein Ton da ist", async () => {
    const s = sitzung(doc(), { denkStilleMs: 200 });
    await ruhe();
    s.v().ev.onInputText("Wie siehst ");
    await warte(120);
    s.v().ev.onInputText("Du das?"); // die Person spricht noch: die Frist beginnt neu
    await warte(120);
    expect(s.json().some((m) => m.t === "thinking")).toBe(false);
    await warte(250);
    expect(s.json().filter((m) => m.t === "thinking")).toHaveLength(1);
    await s.ende();
  });

  it("kein thinking, wenn die Antwort schon tönt, und keines in der Pause", async () => {
    const s = sitzung(doc(), { denkStilleMs: 40 });
    await ruhe();
    s.v().ev.onInputText("Hallo.");
    s.v().ev.onAudio(ton(100));
    await warte(120);
    s.v().ev.onInputText(" Bist Du da?"); // Mitschrift läuft dem Ton nach
    await warte(120);
    expect(s.json().some((m) => m.t === "thinking")).toBe(false);
    s.v().ev.onTurnComplete();
    await ruhe();

    s.v().ev.onInputText("Noch etwas.");
    s.ws.emit("message", frame({ t: "pause" }), false);
    await warte(120);
    expect(s.json().some((m) => m.t === "thinking")).toBe(false);
    await s.ende();
  });
});

describe("Verbindung zur KI hält länger (C15)", () => {
  it("Vorwarnung mit frischer Marke: vorab neu verbinden, ohne Lücke; die alte Verbindung zählt nicht mehr", async () => {
    const s = sitzung();
    await ruhe();
    const alt = s.v();
    alt.ev.onGoAway();
    await ruhe();
    expect(s.ki.liste).toHaveLength(1); // ohne Marke noch nicht
    alt.ev.onResumptionHandle("marke-1");
    await ruhe();
    expect(s.ki.liste).toHaveLength(2);
    expect(s.v().cfg.resumeHandle).toBe("marke-1");
    expect(s.v().calls.some((c) => c.k === "history")).toBe(false); // die Wiederaufnahme kennt das Gespräch
    expect(alt.zu).toBe(true);
    expect(s.json().some((m) => m.t === "reconnecting" || m.t === "bye")).toBe(false);

    // Was die abgelöste Verbindung noch schickt, wird verworfen, auch ihr Abriss.
    alt.ev.onInputText("Geisterstimme");
    alt.ev.onClose("1000");
    await ruhe();
    expect(s.json().some((m) => m.t === "you")).toBe(false);
    expect(s.ki.liste).toHaveLength(2);

    s.ws.emit("message", Buffer.alloc(320), true);
    expect(s.v().calls.filter((c) => c.k === "audio")).toHaveLength(1);
    s.v().ev.onInputText("Hallo?");
    expect(s.json().find((m) => m.t === "you")?.text).toBe("Hallo?");
    await s.ende();
  });

  it("Vorwarnung mitten in einer Antwort: gewechselt wird erst mit der nächsten Marke", async () => {
    const s = sitzung();
    await ruhe();
    const alt = s.v();
    alt.ev.onResumptionHandle("marke-1");
    alt.ev.onInputText("Eine Frage.");
    alt.ev.onAudio(ton(200));
    alt.ev.onOutputText("Moment, ich überlege");
    alt.ev.onGoAway();
    await ruhe();
    expect(s.ki.liste).toHaveLength(1);
    alt.ev.onOutputText(" noch.");
    alt.ev.onTurnComplete();
    await ruhe();
    expect(s.ki.liste).toHaveLength(1);
    alt.ev.onResumptionHandle("marke-2");
    await ruhe();
    expect(s.ki.liste).toHaveLength(2);
    expect(s.v().cfg.resumeHandle).toBe("marke-2");
    expect(s.d.turns.at(-1)?.text).toBe("Moment, ich überlege noch.");
    await s.ende();
  });

  it("Abriss ohne Marke: mit dem Verlauf neu aufsetzen statt mit Fehler zu enden; der Browser erfährt beides", async () => {
    const d = doc({ regie: [{ stufe: 1, erfuellt: [], eskaliert: false, notiz: "Du stehst jetzt auf Stufe 1.", turn: 1, ts: "t0" }] });
    const s = sitzung(d);
    await ruhe();
    s.v().ev.onInputText("Ich wollte gerade sagen");
    s.v().ev.onClose("1006");
    await ruhe();
    expect(s.ki.liste).toHaveLength(2);
    expect(s.v().cfg.resumeHandle).toBeUndefined();
    const verlauf = s.v().calls.find((c) => c.k === "history")?.v as Array<{ role: string; text: string }>;
    expect(verlauf.map((t) => t.text)).toEqual([ERSTER_SATZ, "Ich wollte gerade sagen"]); // samt dem gerade Mitgeschriebenen
    // Die letzte Regie-Notiz geht noch einmal an die Rolle (die neue Verbindung kennt sie nicht).
    expect(String((s.v().calls.find((c) => c.k === "text")?.v as { text: string }).text)).toContain("Stufe 1");
    const arten = s.json().map((m) => m.t);
    expect(arten.indexOf("reconnecting")).toBeGreaterThan(-1);
    expect(arten.indexOf("reconnected")).toBeGreaterThan(arten.indexOf("reconnecting"));
    expect(arten).not.toContain("bye");
    await s.ende();
  });

  it("gilt die Marke nicht mehr, setzt das Relais ohne sie neu auf", async () => {
    const s = sitzung();
    await ruhe();
    s.v().ev.onResumptionHandle("marke-alt");
    s.v().ev.onInputText("Hallo."); // seit der Marke ist gesprochen worden
    s.ki.scheitert(new Error("handle expired"));
    s.v().ev.onClose("1011");
    await ruhe();
    expect(s.ki.liste).toHaveLength(2);
    expect(s.v().cfg.resumeHandle).toBeUndefined();
    expect(s.v().calls.some((c) => c.k === "history")).toBe(true);
    expect(s.json().map((m) => m.t)).toContain("reconnected");
    await s.ende();
  });

  it("scheitert auch das Neuaufsetzen, endet die Sitzung mit bye upstream", async () => {
    const s = sitzung();
    await ruhe();
    s.ki.scheitert(new Error("nicht erreichbar"));
    s.v().ev.onClose("1006");
    await ruhe();
    expect(s.json().at(-1)).toEqual({ t: "bye", reason: "upstream" });
    await warte(350);
    await s.run;
  });

  it("während des Neuverbindens geht kein Ton an die abgerissene Verbindung", async () => {
    const s = sitzung();
    await ruhe();
    const alt = s.v();
    const los = s.ki.haelt();
    alt.ev.onClose("1006");
    await ruhe();
    s.ws.emit("message", Buffer.alloc(320), true);
    expect(s.audioAnKi()).toBe(0);
    expect(s.json().map((m) => m.t)).toContain("reconnecting");
    expect(s.json().map((m) => m.t)).not.toContain("reconnected");
    los();
    await ruhe();
    s.ws.emit("message", Buffer.alloc(320), true);
    expect(s.v().calls.filter((c) => c.k === "audio")).toHaveLength(1);
    expect(alt.calls.some((c) => c.k === "audio")).toBe(false);
    await s.ende();
  });

  it("der Zähler der Wiederaufnahmen beginnt nach einem gelungenen Zug neu; ohne Zug ist nach zwei Abrissen Schluss", async () => {
    const mitZuegen = sitzung();
    await ruhe();
    for (let i = 0; i < 4; i++) {
      mitZuegen.v().ev.onResumptionHandle(`marke-${i}`);
      mitZuegen.v().ev.onInputText("Weiter.");
      mitZuegen.v().ev.onOutputText("Gut.");
      mitZuegen.v().ev.onTurnComplete();
      await ruhe();
      mitZuegen.v().ev.onClose("1011 Sitzungsgrenze");
      await ruhe();
    }
    expect(mitZuegen.ki.liste).toHaveLength(5);
    expect(mitZuegen.json().some((m) => m.t === "bye")).toBe(false);
    await mitZuegen.ende();

    const ohneZug = sitzung();
    await ruhe();
    for (let i = 0; i < 3; i++) {
      ohneZug.v().ev.onClose("1011");
      await ruhe();
    }
    expect(ohneZug.ki.liste).toHaveLength(3); // Start und zwei Wiederaufnahmen
    expect(ohneZug.json().at(-1)).toEqual({ t: "bye", reason: "upstream" });
    await warte(350);
    await ohneZug.run;
  });
});

describe("Rückstau zum Browser (C36)", () => {
  it("staut sich der Ton, wird er verworfen statt gepuffert und zählt nicht als gespielt", async () => {
    const s = sitzung();
    await ruhe();
    s.v().ev.onInputText("Erzähl.");
    s.v().ev.onAudio(ton(500));
    s.v().ev.onOutputText("Also,");
    s.ws.gestaut = 2_000_000;
    s.v().ev.onAudio(ton(500));
    s.v().ev.onAudio(ton(500));
    s.v().ev.onOutputText(" das war so.");
    expect(s.tonAnBrowser()).toBe(1);
    s.ws.gestaut = 0;
    s.v().ev.onAudio(ton(500));
    expect(s.tonAnBrowser()).toBe(2);
    // Nur eine Sekunde Ton ging raus: Der Browser kann höchstens bis dorthin gehört haben.
    s.v().ev.onInterrupted();
    s.ws.emit("message", frame({ t: "heard", ms: 5_000 }), false);
    s.v().ev.onTurnComplete();
    await ruhe();
    expect(s.d.turns.at(-1)?.text).toBe("Also, das war so.");
    await s.ende();
  });
});

describe("Zählpunkt und Kennzahlen (S24, S22)", () => {
  it("erstes Wort im Sprechweg wird genau einmal gezählt", async () => {
    const s = sitzung();
    await ruhe();
    for (const satz of ["Guten Morgen.", "Ich habe ein Anliegen."]) {
      s.v().ev.onInputText(satz);
      s.v().ev.onOutputText("Ja?");
      s.v().ev.onTurnComplete();
      await ruhe();
    }
    expect(s.zaehlpunkte).toEqual(["erstes_wort:sim-coaching-morgan:sprechen"]);
    await s.ende();

    // Wer schon geschrieben hat, zählt im Sprechweg nicht noch einmal.
    const spaeter = sitzung(doc({ turns: [{ role: "persona", text: ERSTER_SATZ, ts: "t0" }, { role: "user", text: "Hallo.", ts: "t1" }] }));
    await ruhe();
    spaeter.v().ev.onInputText("Weiter.");
    spaeter.v().ev.onTurnComplete();
    await ruhe();
    expect(spaeter.zaehlpunkte).toEqual([]);
    await spaeter.ende();
  });

  it("die Kennzahlen gehen mit jedem Zug an den Lauf und zählen frühere Sitzungen mit", async () => {
    const d = doc({ liveStats: { antworten: 2, p50Ms: 800, p95Ms: 1_000, maxMs: 1_000, zeiten: [800, 1_000], unterbrechungen: 1, gekuerztZeichen: 30 } });
    const s = sitzung(d);
    await ruhe();
    s.v().ev.onInputText("Und jetzt?");
    s.advance(1_400);
    s.v().ev.onAudio(ton(200));
    s.v().ev.onOutputText("Jetzt Du.");
    s.v().ev.onTurnComplete();
    await ruhe();
    // Schon mit dem Zug gespeichert, nicht erst beim Auflegen.
    expect(s.d.liveStats).toEqual({ antworten: 3, p50Ms: 1_000, p95Ms: 1_400, maxMs: 1_400, zeiten: [800, 1_000, 1_400], unterbrechungen: 1, gekuerztZeichen: 30 });
    await s.ende();
  });

  it("liveKennzahlen: rein, mit Deckel und ohne Werte", () => {
    expect(liveKennzahlen(null, { zeiten: [], unterbrechungen: 0, gekuerztZeichen: 0 })).toBeNull();
    expect(liveKennzahlen(null, { zeiten: [1_234.6], unterbrechungen: 2, gekuerztZeichen: 50 })).toEqual({
      antworten: 1,
      p50Ms: 1_235,
      p95Ms: 1_235,
      maxMs: 1_235,
      zeiten: [1_235],
      unterbrechungen: 2,
      gekuerztZeichen: 50,
    });
    // Lauf von vor dem 12.11.2026 (ohne einzelne Zeiten), Sitzung ohne Antwort: die alten Werte bleiben stehen.
    expect(liveKennzahlen({ antworten: 4, p50Ms: 900, p95Ms: 2_000, maxMs: 2_100 }, { zeiten: [], unterbrechungen: 1, gekuerztZeichen: 0 })).toMatchObject({
      antworten: 4,
      p50Ms: 900,
      p95Ms: 2_000,
      maxMs: 2_100,
      unterbrechungen: 1,
    });
    const viele = liveKennzahlen(null, { zeiten: Array.from({ length: 80 }, (_, i) => 500 + i), unterbrechungen: 0, gekuerztZeichen: 0 });
    expect(viele?.zeiten).toHaveLength(60);
    expect(viele?.zeiten?.at(-1)).toBe(579);
  });
});

vi.mock("server-only", () => ({}));
