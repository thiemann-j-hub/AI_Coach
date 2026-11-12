import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pakete 1 und 2 (12.11.2026) am Relais-Kern: C3 (nur die eigene Änderung schreiben), C36 (eine Sitzung je Lauf,
 * close-Hörer zuerst), C14 (Beobachter neben der Warteschlange), C7 (Ausfall im Protokoll).
 * Der Speicher ist der echte `simulation-store` über einem Cosmos im Arbeitsspeicher, der sich wie Cosmos verhält:
 * jede Schreibung vergibt eine neue Version, ein Ersetzen mit veralteter Version scheitert mit 412.
 */
const db = vi.hoisted(() => {
  const items = new Map<string, Record<string, unknown>>();
  let version = 0;
  const stand = {
    items,
    /** So oft scheiterte ein Ersetzen an einer veralteten Version (412). */
    konflikte: 0,
    next: () => `v${++version}`,
    reset: () => {
      items.clear();
      version = 0;
      stand.konflikte = 0;
    },
  };
  return stand;
});

vi.mock("@/lib/cosmos", () => ({
  runsContainer: () => ({}),
  readItem: async (_c: unknown, id: string) => {
    const hit = db.items.get(id);
    return hit ? structuredClone(hit) : null;
  },
  upsertItem: async (_c: unknown, item: { id: string }) => {
    const saved = { ...item, _etag: db.next() };
    db.items.set(item.id, structuredClone(saved));
    return saved;
  },
  replaceItemIfMatch: async (_c: unknown, item: { id: string }, _pk: string, etag: string) => {
    const current = db.items.get(item.id);
    if (!current || current._etag !== etag) {
      db.konflikte++;
      throw Object.assign(new Error("precondition failed"), { code: 412 });
    }
    const saved = { ...item, _etag: db.next() };
    db.items.set(item.id, structuredClone(saved));
    return saved;
  },
  queryItems: async () => [],
  deleteItem: async (_c: unknown, id: string) => void db.items.delete(id),
}));
vi.mock("@/lib/server/radar-emit", () => ({ deleteCoachMeasurement: async () => ({ deleted: 0 }) }));

import { ENDE_PRUEFUNG_TIMEOUT_MS } from "@/ai/flows/simulation-ende-pruefung";
import { getScenario } from "@/lib/simulation/scenarios";
import { SIM_DOC_TYPE, getSimulation, updateSimulation, type SimulationDoc } from "@/lib/server/simulation-store";
import {
  ENDE_WERKZEUG,
  runLiveSession,
  type LiveDeps,
  type LiveSitzungen,
  type LiveSocket,
  type Upstream,
  type UpstreamEvents,
  WS_OPEN,
} from "./live-session";

const SIM = "sim-abcdefgh";
const ticket = { uid: "u1", email: null, oid: null, simId: SIM };
const START = 1_000_000;

function seed(extra: Partial<SimulationDoc> = {}): void {
  const doc = {
    id: SIM,
    sessionId: "sim:u1",
    docType: SIM_DOC_TYPE,
    uid: "u1",
    scenarioId: "sim-coaching-morgan",
    createdAt: new Date(START).toISOString(),
    updatedAt: new Date(START).toISOString(),
    status: "active",
    turns: [{ role: "persona", text: "Guten Morgen.", ts: new Date(START).toISOString() }],
    convoLocale: "de",
    ...extra,
    _etag: db.next(),
  };
  db.items.set(doc.id, doc as unknown as Record<string, unknown>);
}
const stored = async () => (await getSimulation("u1", SIM))!;

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
  const calls: Array<{ k: string; v?: unknown }> = [];
  let events: UpstreamEvents | null = null;
  const up: Upstream = {
    sendAudio: () => void calls.push({ k: "audio" }),
    sendText: (text, turnComplete) => void calls.push({ k: "text", v: { text, turnComplete } }),
    sendHistory: (turns) => void calls.push({ k: "history", v: turns.map((t) => t.text) }),
    sendToolResponse: (r) => void calls.push({ k: "tool", v: r }),
    close: () => void calls.push({ k: "close" }),
  };
  const connect: LiveDeps["connect"] = async (_c, ev) => {
    events = ev;
    calls.push({ k: "connect" });
    return up;
  };
  return { calls, connect, ev: () => events! };
}

type LogZeile = { level: string; msg: string; meta?: Record<string, unknown> };

/** Eine Sitzung mit eigener Attrappe für Browser und Live-Modell; der Speicher ist für alle derselbe. */
function sitzung(over: Partial<LiveDeps> = {}) {
  const ws = fakeSocket();
  const up = fakeUpstream();
  const logs: LogZeile[] = [];
  let now = START + 60_000;
  const deps: LiveDeps = {
    connect: up.connect,
    loadSim: (uid, simId) => getSimulation(uid, simId),
    updateSim: (uid, simId, mutate) => updateSimulation(uid, simId, mutate),
    loadScenario: async (_u, id) => getScenario(id),
    budget: async () => ({ allowed: true }),
    now: () => now,
    log: (level, msg, meta) => void logs.push({ level, msg, meta }),
    model: "gemini-3.8-live",
    idleMs: 60_000,
    sitzungen: new Map(),
    ...over,
  };
  const run = runLiveSession(ws, ticket, deps);
  const json = () => ws.sent.filter((s) => typeof s === "string").map((s) => JSON.parse(s as string));
  /** Ein ganzer Zug: die Person spricht, die Rolle antwortet, das Live-Modell meldet den Zug fertig. */
  const zug = (user: string, persona: string) => {
    up.ev().onInputText(user);
    up.ev().onOutputText(persona);
    up.ev().onTurnComplete();
  };
  return { ws, up, logs, run, json, zug, advance: (ms: number) => (now += ms) };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const ruhe = async () => {
  await tick();
  await tick();
};
function spaeter<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const texte = (d: SimulationDoc) => d.turns.map((t) => t.text);

beforeEach(() => db.reset());

describe("Relais schreibt nur seine eigene Änderung (C3)", () => {
  it("Coach-Tipp bleibt erhalten: der nächste Live-Zug überschreibt ihn nicht", async () => {
    seed();
    const s = sitzung();
    await ruhe();
    s.zug("Haben Sie kurz Zeit?", "Ja, kurz.");
    await ruhe();
    // Coach-Pause: die Timeout-Route hängt den Tipp an den gespeicherten Lauf.
    await updateSimulation("u1", SIM, (d) => {
      d.coachNotes = [{ question: "", answer: "Frag nach der Ursache.", ts: "t" }];
    });
    s.zug("Was ist aus Ihrer Sicht passiert?", "Es war einfach zu viel.");
    await ruhe();
    s.zug("Verstehe.", "Danke.");
    await ruhe();
    const d = await stored();
    expect(d.coachNotes).toEqual([{ question: "", answer: "Frag nach der Ursache.", ts: "t" }]);
    expect(texte(d)).toEqual([
      "Guten Morgen.",
      "Haben Sie kurz Zeit?",
      "Ja, kurz.",
      "Was ist aus Ihrer Sicht passiert?",
      "Es war einfach zu viel.",
      "Verstehe.",
      "Danke.",
    ]);
    expect(s.json().filter((m) => m.t === "turn")).toHaveLength(3);
    s.ws.close(1000);
    await s.run;
    expect((await stored()).coachNotes).toHaveLength(1);
  });

  it("fertige Auswertung wird nicht überschrieben: kein Zug, keine Antwortzeiten, Status bleibt, Sitzung endet", async () => {
    seed();
    const s = sitzung();
    await ruhe();
    s.up.ev().onInputText("Eins noch.");
    s.advance(900);
    s.up.ev().onAudio(Buffer.alloc(8)); // Antwortzeit liegt vor: früher schrieb der Abschluss damit die ganze Kopie
    s.up.ev().onOutputText("Ja?");
    // Die Finish-Route wertet inzwischen aus.
    await updateSimulation("u1", SIM, (d) => {
      d.status = "finished";
      d.feedbackJson = { summary: "fertig" };
      d.finishedAt = "2026-11-12T09:00:00.000Z";
    });
    const version = db.items.get(SIM)!._etag;
    s.up.ev().onTurnComplete();
    await ruhe();
    expect(s.json().some((m) => m.t === "turn")).toBe(false);
    expect(s.json().at(-1)).toEqual({ t: "bye", reason: "not_active" });
    await s.run; // der Socket schließt nach dem bye-Frame, der Abschluss läuft
    const d = await stored();
    expect(d.status).toBe("finished");
    expect(d.feedbackJson).toEqual({ summary: "fertig" });
    expect(d.turns).toHaveLength(1);
    expect(d.liveStats).toBeUndefined();
    expect(db.items.get(SIM)!._etag).toBe(version); // nichts geschrieben
  });

  it("später Abschluss nach Abbruch oder Löschung schreibt nichts mehr", async () => {
    seed();
    const s = sitzung();
    await ruhe();
    s.up.ev().onInputText("Ich wollte noch sagen");
    await updateSimulation("u1", SIM, (d) => {
      d.status = "aborted";
    });
    s.ws.close(1001);
    await s.run;
    const d = await stored();
    expect(d.status).toBe("aborted");
    expect(d.turns).toHaveLength(1);

    db.reset();
    seed();
    const t = sitzung();
    await ruhe();
    db.items.delete(SIM); // Lauf gelöscht
    t.zug("Hallo?", "Ja?");
    await ruhe();
    expect(t.json().at(-1)).toEqual({ t: "bye", reason: "not_active" });
    await t.run;
    expect(db.items.has(SIM)).toBe(false);
  });

  it("zwei Sitzungen desselben Laufs verlieren keine Züge (zwei Prozesse, auch bei gleichzeitigem Schreiben)", async () => {
    seed();
    const a = sitzung();
    const b = sitzung(); // eigene Sitzungsliste = zweiter Prozess, beide laufen nebeneinander
    await ruhe();
    a.zug("A eins", "Antwort A eins");
    await ruhe();
    b.zug("B eins", "Antwort B eins");
    await ruhe();
    // Gleichzeitig: beide lesen dieselbe Version, eine Schreibung scheitert und wird auf frischem Stand wiederholt.
    a.zug("A zwei", "Antwort A zwei");
    b.zug("B zwei", "Antwort B zwei");
    await ruhe();
    expect(db.konflikte).toBeGreaterThan(0); // der Konflikt ist wirklich eingetreten
    const d = await stored();
    expect(d.turns).toHaveLength(9);
    expect([...texte(d)].sort()).toEqual(
      ["Guten Morgen.", "A eins", "Antwort A eins", "B eins", "Antwort B eins", "A zwei", "Antwort A zwei", "B zwei", "Antwort B zwei"].sort()
    );
    // Jede Sitzung zählt nach ihrem Schreiben auf dem gespeicherten Stand (4 Züge der Person insgesamt).
    const letzte = [a, b].map((x) => x.json().filter((m) => m.t === "turn").at(-1).userTurnsLeft);
    expect(Math.min(...letzte)).toBe(36);
    a.ws.close(1000);
    b.ws.close(1000);
    await Promise.all([a.run, b.run]);
    expect((await stored()).turns).toHaveLength(9);
  });

  it("scheitert ein Speichern, geht der Zug mit dem nächsten Schreiben mit", async () => {
    seed();
    let kaputt = true;
    const s = sitzung({
      updateSim: async (uid, simId, mutate) => {
        if (kaputt) throw new Error("Cosmos nicht erreichbar");
        return updateSimulation(uid, simId, mutate);
      },
    });
    await ruhe();
    s.zug("Erster Satz.", "Erste Antwort.");
    await ruhe();
    expect((await stored()).turns).toHaveLength(1);
    expect(s.logs.some((l) => l.msg === "live-finalize")).toBe(true);
    kaputt = false;
    s.zug("Zweiter Satz.", "Zweite Antwort.");
    await ruhe();
    expect(texte(await stored())).toEqual(["Guten Morgen.", "Erster Satz.", "Erste Antwort.", "Zweiter Satz.", "Zweite Antwort."]);
    s.ws.close(1000);
    await s.run;
  });
});

describe("Höchstens eine Live-Sitzung je Lauf, close-Hörer zuerst (C36)", () => {
  it("eine zweite Verbindung beendet die ältere mit Grund; deren Angefangenes ist gespeichert, bevor die neue lädt", async () => {
    seed();
    const sitzungen: LiveSitzungen = new Map();
    const a = sitzung({ sitzungen });
    await ruhe();
    a.up.ev().onInputText("Ich wollte gerade sagen"); // mitten im Zug
    const b = sitzung({ sitzungen });
    await ruhe();
    expect(a.json().at(-1)).toEqual({ t: "bye", reason: "replaced" });
    expect(a.ws.closedWith[0]).toEqual([1000, "replaced"]);
    expect(a.up.calls.at(-1)?.k).toBe("close");
    await a.run;
    // Die neue Sitzung hat den Lauf samt dem Angefangenen der alten geladen und dem Live-Modell eingespielt.
    expect(b.up.calls.find((c) => c.k === "history")?.v).toEqual(["Guten Morgen.", "Ich wollte gerade sagen"]);
    expect(b.json()[0]).toMatchObject({ t: "ready" });
    expect(b.logs.some((l) => l.msg === "live-ersetzt")).toBe(true);
    b.zug("Jetzt aber.", "Ich höre.");
    await ruhe();
    expect(texte(await stored())).toEqual(["Guten Morgen.", "Ich wollte gerade sagen", "Jetzt aber.", "Ich höre."]);
    expect(sitzungen.size).toBe(1);
    b.ws.close(1000);
    await b.run;
    expect(sitzungen.size).toBe(0);
  });

  it("Auflegen während des Ladens wird nicht mehr verpasst: keine Verbindung zum Live-Modell, Sitzung endet", async () => {
    seed();
    const laden = spaeter<SimulationDoc | null>();
    const sitzungen: LiveSitzungen = new Map();
    const s = sitzung({ sitzungen, loadSim: () => laden.promise });
    await tick();
    s.ws.close(1001); // Browser legt auf, bevor der Lauf geladen ist
    laden.resolve(await getSimulation("u1", SIM));
    await s.run;
    expect(s.up.calls.some((c) => c.k === "connect")).toBe(false);
    expect(s.json()).toEqual([]);
    expect(sitzungen.size).toBe(0);
  });

  it("Auflegen während des Verbindens schließt die frische Verbindung zum Live-Modell wieder", async () => {
    seed();
    const up = fakeUpstream();
    const verbunden = spaeter<void>();
    const s = sitzung({
      connect: async (c, ev) => {
        await verbunden.promise;
        return up.connect(c, ev);
      },
    });
    await ruhe();
    s.ws.close(1001);
    verbunden.resolve();
    await s.run;
    expect(up.calls.map((c) => c.k)).toEqual(["connect", "close"]);
  });

  it("ein abgelehnter Start (Lauf schon ausgewertet) meldet sich wieder ab", async () => {
    seed({ status: "finished" });
    const sitzungen: LiveSitzungen = new Map();
    const s = sitzung({ sitzungen });
    await s.run;
    expect(s.json()[0]).toEqual({ t: "error", code: "ALREADY_FINISHED" });
    expect(sitzungen.size).toBe(0);
  });
});

describe("Regie-Beobachter neben der Speicher-Warteschlange (C14)", () => {
  const stand = (turn: number) => ({ stufe: 1, erfuellt: ["Anerkennung kam"], eskaliert: false, notiz: "Du stehst jetzt auf Stufe 1.", turn, ts: "t" });

  it("hängt der Beobachter, werden die folgenden Züge trotzdem sofort gespeichert und gemeldet; Auflegen wartet nicht", async () => {
    seed();
    const haengt = spaeter<null>();
    const regie = vi.fn(() => haengt.promise);
    const s = sitzung({ regie });
    await ruhe();
    s.zug("Ich sehe, wie viel du leistest.", "Danke.");
    await ruhe();
    s.zug("Was brauchst du von mir?", "Mehr Zeit.");
    await ruhe();
    s.zug("Bis wann?", "Bis Freitag.");
    await ruhe();
    expect(regie).toHaveBeenCalledTimes(1); // er hängt noch am ersten Zug
    expect(s.json().filter((m) => m.t === "turn")).toHaveLength(3);
    expect((await stored()).turns).toHaveLength(7);
    s.up.ev().onInputText("Und dann");
    s.ws.close(1001);
    await s.run; // löst auf, obwohl der Beobachter nie antwortet
    expect(texte(await stored()).at(-1)).toBe("Und dann");
  });

  it("antwortet er später, hängt er Notiz und Verlauf nach; für den Zug dazwischen folgt genau ein weiterer Lauf", async () => {
    seed();
    const erster = spaeter<ReturnType<typeof stand>>();
    const gesehen: number[] = [];
    const regie = vi.fn(async (_s: unknown, turns: unknown[]) => {
      gesehen.push(turns.length);
      return gesehen.length === 1 ? erster.promise : { ...stand(turns.length), stufe: 2, notiz: "Du stehst jetzt auf Stufe 2." };
    });
    const s = sitzung({ regie });
    await ruhe();
    s.zug("Ich sehe, wie viel du leistest.", "Danke.");
    await ruhe();
    s.zug("Was brauchst du von mir?", "Mehr Zeit.");
    await ruhe();
    expect((await stored()).regie).toBeUndefined();
    erster.resolve(stand(3));
    await ruhe();
    const d = await stored();
    expect(d.turns).toHaveLength(5);
    expect(d.regie?.map((r) => [r.stufe, r.delivered])).toEqual([
      [1, true],
      [2, true],
    ]);
    expect(gesehen).toEqual([3, 5]); // zweiter Lauf mit dem neuesten Stand, nicht je Zug einer
    const notizen = s.up.calls.filter((c) => c.k === "text").map((c) => (c.v as { text: string }).text);
    expect(notizen).toHaveLength(2);
    expect(notizen[0]).toContain("Stufe 1");
    expect(notizen[1]).toContain("Stufe 2");
    s.ws.close(1000);
    await s.run;
  });
});

describe("Ausfall von Beobachter und Torwächter steht im Protokoll, ohne Nutzertext (C7)", () => {
  const GESAGT = "Mein Kollege Peter Beispiel blockiert alles.";
  const ohneNutzertext = (logs: LogZeile[]) => expect(JSON.stringify(logs)).not.toContain("Peter Beispiel");

  it("Beobachter liefert nichts (Frist oder Fehler) oder wirft: je eine Zeile, das Gespräch läuft weiter", async () => {
    seed();
    let wirft = false;
    const s = sitzung({
      regie: async () => {
        if (wirft) throw new Error(`Modellantwort unlesbar: ${GESAGT}`);
        return null;
      },
    });
    await ruhe();
    s.zug(GESAGT, "Aha.");
    await ruhe();
    wirft = true;
    s.zug("Und jetzt?", "Mal sehen.");
    await ruhe();
    const zeilen = s.logs.filter((l) => l.msg === "live-regie-ausfall");
    expect(zeilen.map((l) => [l.level, l.meta?.anlass])).toEqual([
      ["warn", "frist-oder-fehler"],
      ["warn", "fehler"],
    ]);
    expect(zeilen[0].meta).toMatchObject({ simId: SIM, ms: 0 });
    ohneNutzertext(zeilen);
    expect(s.json().filter((m) => m.t === "turn")).toHaveLength(2);
    expect((await stored()).regie).toBeUndefined();
    s.ws.close(1000);
    await s.run;
  });

  it("Torwächter wirft oder läuft in die Frist: Ende gilt weiter, mit Protokollzeile", async () => {
    for (const fall of ["fehler", "frist"] as const) {
      db.reset();
      seed();
      const s = sitzung({
        endePruefen: async () => {
          if (fall === "fehler") throw new Error(`kaputt: ${GESAGT}`);
          s.advance(ENDE_PRUEFUNG_TIMEOUT_MS); // die Prüfung gibt nach ihrer Frist ungeprüft frei
          return { erfuellt: true, fehlt: "" };
        },
      });
      await ruhe();
      s.up.ev().onInputText(GESAGT);
      s.up.ev().onToolCall([{ id: "c1", name: ENDE_WERKZEUG, args: { grund: "Termin vereinbart.", ergebnis: "ziel" } }]);
      await ruhe();
      s.up.ev().onOutputText("Danke, bis dann.");
      s.up.ev().onTurnComplete();
      await ruhe();
      const zeilen = s.logs.filter((l) => l.msg === "live-ende-ungeprueft");
      expect(zeilen).toHaveLength(1);
      expect(zeilen[0]).toMatchObject({ level: "warn", meta: { anlass: fall, ergebnis: "ziel", simId: SIM } });
      ohneNutzertext(zeilen);
      expect((await stored()).closedByPersona?.ergebnis).toBe("ziel");
      await s.run;
    }
  });

  it("geprüftes Ende schreibt keine Ausfall-Zeile; ein abgelehntes Ende hängt nur seine Notiz an den Lauf", async () => {
    seed();
    const s = sitzung({ endePruefen: async () => ({ erfuellt: false, fehlt: "Termin fehlt" }) });
    await ruhe();
    s.up.ev().onInputText("Dann machen wir das.");
    await updateSimulation("u1", SIM, (d) => {
      d.coachNotes = [{ question: "", answer: "Tipp", ts: "t" }];
    });
    s.up.ev().onToolCall([{ id: "c1", name: ENDE_WERKZEUG, args: { grund: "Einig.", ergebnis: "ziel" } }]);
    await ruhe();
    const d = await stored();
    expect(d.regie?.at(-1)?.fehlt).toBe("Termin fehlt");
    expect(d.coachNotes).toHaveLength(1);
    expect(d.closedByPersona).toBeUndefined();
    expect(s.logs.some((l) => l.msg === "live-ende-ungeprueft")).toBe(false);
    s.ws.close(1000);
    await s.run;
  });
});

vi.mock("server-only", () => ({}));
