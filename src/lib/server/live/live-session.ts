import { buildPersonaSystemPrompt, personaStageNote, type PersonaEndeErgebnis, type PersonaTimeSignal } from "@/ai/flows/simulation-persona";
import { regieStageNote, type RegieStand } from "@/ai/flows/simulation-regie";
import type { SimulationScenario, SimulationTurn } from "@/lib/simulation/types";
import {
  SIM_MAX_USER_TURNS,
  SIM_TIME_WARN_FRACTION,
  countUserTurns,
  type SimulationDoc,
} from "@/lib/server/simulation-store";
import { estimateTokens } from "@/lib/server/cost-cap";
import { liveLanguageCode, liveVoiceFor } from "./live-voice";
import type { LiveTicket } from "./ticket-store";

/**
 * Sprachmodus „Live“ — Kern des Relais (Owner-GO 28.10.2026, Register N4-231).
 *
 * Browser ──WebSocket──► dieser Server ──WebSocket──► Gemini Live (Vertex AI, EU-Mehrfachregion)
 *
 * Der Browser schickt rohes Mikrofon-Audio (PCM 16 Bit, 16 kHz, mono), das Live-Modell antwortet
 * mit Stimme (PCM 16 Bit, 24 kHz, mono) und liefert die Mitschrift beider Seiten. Dieser Kern
 *   - baut die Persona aus derselben Rollen-DNA wie der Textweg (ein Schreibweg),
 *   - spielt den bisherigen Verlauf ein (Wiedereinstieg nach Neuladen),
 *   - macht aus den Mitschriften die Gesprächszüge im Simulations-Doc (der Richter bleibt unverändert),
 *   - hält Zeitbox, Zugbegrenzung und Tagesbudget wie die Turn-Route,
 *   - verbindet nach einem Abriss mit der Wiederaufnahme-Marke neu (Sitzungen über zehn Minuten).
 *
 * Welle 2 (Owner-GO 30.10.2026, N4-240):
 *   - die Rolle beendet das Gespräch selbst über das Werkzeug `gespraech_beenden` (Endbedingungen der DNA),
 *   - der Regie-Beobachter schickt nach jedem Zug der lernenden Person bei Stufenwechsel eine Notiz,
 *   - Antwortzeit (Ende der Eingabe-Mitschrift → erstes Audio) wird je Zug gemessen und am Lauf gespeichert,
 *   - vor dem Stille-Abbruch bekommt der Browser eine Vorwarnung.
 *
 * Alle Außenwelt (Vertex, Cosmos, Budget, Uhr) kommt über `LiveDeps` herein — der Kern ist testbar.
 * Es verlässt nie etwas aus der Rollen-DNA den Server; der Browser sieht nur Audio und Mitschrift.
 */

/** Nachrichten Browser → Server (Text-Frames als JSON, Binär-Frames = Audio 16 kHz). */
export type ClientMessage = { t: "hello"; ticket: string } | { t: "end" };

/** Nachrichten Server → Browser (Text-Frames als JSON, Binär-Frames = Audio 24 kHz). */
export type ServerMessage =
  | { t: "ready"; persona: string; voice: string }
  | { t: "you"; text: string }
  | { t: "persona"; text: string }
  | { t: "interrupted" }
  | { t: "turn"; user: string | null; persona: string | null; userTurnsLeft: number; timeUp: boolean; ended: boolean }
  | { t: "ended"; grund: string; ergebnis: PersonaEndeErgebnis }
  | { t: "idle_warn"; seconds: number }
  | { t: "error"; code: LiveErrorCode }
  | { t: "bye"; reason: LiveByeReason };

export type LiveErrorCode =
  | "NOT_FOUND"
  | "ALREADY_FINISHED"
  | "TIME_UP"
  | "ENDED"
  | "TURN_LIMIT"
  | "UNKNOWN_SCENARIO"
  | "UPSTREAM";
export type LiveByeReason = "time_up" | "ended_by_persona" | "turn_limit" | "budget" | "idle" | "upstream" | "ended";

/** Der Teil eines ws-Sockets, den der Kern braucht (so bleibt er ohne ws-Typen testbar). */
export interface LiveSocket {
  send(data: string | Buffer): void;
  close(code?: number, reason?: string): void;
  on(event: "message", fn: (data: Buffer | ArrayBuffer | Buffer[] | string, isBinary: boolean) => void): void;
  on(event: "close", fn: () => void): void;
  on(event: "error", fn: (e: unknown) => void): void;
  readonly readyState: number;
}
export const WS_OPEN = 1;

/** Werkzeugaufruf des Live-Modells (Welle 2: `gespraech_beenden`). */
export interface LiveToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface UpstreamEvents {
  onAudio(pcm24k: Buffer): void;
  onInputText(text: string): void;
  onOutputText(text: string): void;
  onInterrupted(): void;
  onTurnComplete(): void;
  onToolCall(calls: LiveToolCall[]): void;
  onResumptionHandle(handle: string): void;
  onGoAway(): void;
  onClose(reason: string): void;
  onError(err: unknown): void;
}

export interface Upstream {
  sendAudio(pcm16k: Buffer): void;
  /** Text in den Kontext legen; `turnComplete` = das Modell soll jetzt antworten. */
  sendText(text: string, turnComplete: boolean): void;
  sendHistory(turns: Array<{ role: "user" | "model"; text: string }>): void;
  /** Antwort auf einen Werkzeugaufruf (optional — Tests und alte Anschlüsse ohne Werkzeug). */
  sendToolResponse?(responses: Array<{ id?: string; name: string; response: Record<string, unknown> }>): void;
  close(): void;
}

export interface UpstreamConfig {
  model: string;
  voice: string;
  languageCode: string;
  systemInstruction: string;
  resumeHandle?: string;
  /** Welle 2: Werkzeug `gespraech_beenden` anbieten. */
  endeWerkzeug?: boolean;
  /** Welle 2: Sprechpausen-Erkennung (`kurz` = Satzende früher annehmen). */
  sprechpause?: "normal" | "kurz";
}

export type ConnectUpstream = (cfg: UpstreamConfig, events: UpstreamEvents) => Promise<Upstream>;

export interface LiveDeps {
  connect: ConnectUpstream;
  loadSim(uid: string, simId: string): Promise<SimulationDoc | null>;
  saveSim(doc: SimulationDoc): Promise<void>;
  loadScenario(uid: string, scenarioId: string, oid: string | null): Promise<SimulationScenario | null>;
  /** Spielbuch des Szenarios (vorbereitet) oder null; optional (Tests, Rückweg). */
  loadSpielbuch?(scenario: SimulationScenario): Promise<string | null>;
  /** Welle 2: Regie-Beobachter nach einem Zug der lernenden Person; optional (Tests, Rückweg). */
  regie?(scenario: SimulationScenario, turns: SimulationTurn[], bisher: RegieStand | null): Promise<RegieStand | null>;
  budget(args: { uid: string; email: string | null; estimatedTokens: number }): Promise<{ allowed: boolean }>;
  now(): number;
  log(level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>): void;
  model: string;
  /** Welle 2: Werkzeug zum Beenden anbieten (Standard: wenn das Szenario Endbedingungen trägt). */
  endeOn?: boolean;
  /** Welle 2: Sprechpausen-Erkennung (Standard normal). */
  sprechpause?: "normal" | "kurz";
  /** Stille vom Browser, nach der die Sitzung endet (Standard 2 Minuten). */
  idleMs?: number;
  /** Vorwarnung vor dem Stille-Abbruch (Standard 60 s vorher). */
  idleWarnMs?: number;
  /** Obergrenze je Verbindung (Standard 30 Minuten). */
  maxConnectionMs?: number;
}

/** Name des Werkzeugs, mit dem die Rolle das Gespräch beendet. */
export const ENDE_WERKZEUG = "gespraech_beenden";

/** Zusatz zur Rollenanweisung: gesprochenes Gespräch, kurze Antworten, Unterbrechungen, Ende-Werkzeug. */
export function liveAddendum(locale: SimulationScenario["locale"], mitEndeWerkzeug = false): string {
  const basis =
    locale === "en"
      ? `\n\n=== SPOKEN CONVERSATION ===\nThis is a spoken conversation: you hear your counterpart and answer with your voice. Keep replies short (usually 1–3 sentences), natural spoken language, no lists, no markdown, no stage directions. If you get interrupted, listen and respond to what was just said. Never read out notes marked as stage notes.`
      : `\n\n=== GESPROCHENES GESPRÄCH ===\nDies ist ein gesprochenes Gespräch: Du hörst dein Gegenüber und antwortest mit deiner Stimme. Antworte kurz (meist 1–3 Sätze), in gesprochener Sprache, ohne Aufzählungen, ohne Markdown, ohne Regieanweisungen. Wirst du unterbrochen, hör zu und antworte auf das gerade Gesagte. Lies Regie-Notizen nie vor.`;
  if (!mitEndeWerkzeug) return basis;
  return (
    basis +
    (locale === "en"
      ? `\nENDING: When one of the END conditions is met, first say your goodbye line, THEN call the tool ${ENDE_WERKZEUG} with grund (one sentence why) and ergebnis (ziel, verabschiedung or abbruch). Never call it before that, and never mention the tool.`
      : `\nENDE: Ist eine der ENDBEDINGUNGEN erfüllt, sprich erst deinen Abschiedssatz und rufe DANN das Werkzeug ${ENDE_WERKZEUG} auf, mit grund (ein Satz, warum) und ergebnis (ziel, verabschiedung oder abbruch). Rufe es nie vorher auf und erwähne es nie.`)
  );
}

/** Zeit-Regie (PURE): dieselbe Entscheidung wie in der Turn-Route. */
export function decideTimeSignal(args: {
  createdAt: string;
  now: number;
  durationMin: number;
  timeWarned: boolean;
}): PersonaTimeSignal | undefined {
  const elapsedMs = args.now - new Date(args.createdAt).getTime();
  const limitMs = args.durationMin * 60_000;
  if (elapsedMs >= limitMs) return "farewell";
  if (elapsedMs >= limitMs * SIM_TIME_WARN_FRACTION && !args.timeWarned) return "closing";
  return undefined;
}

export function sessionDurationMin(doc: SimulationDoc, scenario: SimulationScenario): number {
  return doc.mode === "check" ? (scenario.checkDurationMin ?? scenario.durationMin) : scenario.durationMin;
}

/** Antwortzeiten (ms) → Kennzahlen; PURE. */
export function latencyStats(samples: number[]): { antworten: number; p50Ms: number; p95Ms: number; maxMs: number } | null {
  if (!samples.length) return null;
  const s = [...samples].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
  return { antworten: s.length, p50Ms: Math.round(q(0.5)), p95Ms: Math.round(q(0.95)), maxMs: Math.round(s[s.length - 1]) };
}

/** Werkzeugaufruf `gespraech_beenden` lesen; PURE. */
export function parseEndeCall(call: LiveToolCall): { grund: string; ergebnis: PersonaEndeErgebnis } | null {
  if (call.name !== ENDE_WERKZEUG) return null;
  const grund = String(call.args.grund ?? "").trim().slice(0, 300);
  const e = String(call.args.ergebnis ?? "").trim().toLowerCase();
  const ergebnis: PersonaEndeErgebnis = e === "ziel" || e === "abbruch" ? e : "verabschiedung";
  return { grund, ergebnis };
}

function toHistory(turns: SimulationTurn[]): Array<{ role: "user" | "model"; text: string }> {
  return turns
    .filter((t) => t.text.trim())
    .map((t) => ({ role: t.role === "user" ? ("user" as const) : ("model" as const), text: t.text }));
}

function asBuffer(data: Buffer | ArrayBuffer | Buffer[] | string): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  if (typeof data === "string") return Buffer.from(data);
  return Buffer.from(data);
}

/**
 * Führt EINE Live-Verbindung bis zu ihrem Ende. Löst auf, wenn der Browser-Socket zu ist.
 * Die Karte ist bereits geprüft und eingelöst (Route + Mantel).
 */
export async function runLiveSession(ws: LiveSocket, ticket: LiveTicket, deps: LiveDeps): Promise<void> {
  const sendJson = (m: ServerMessage) => {
    if (ws.readyState === WS_OPEN) {
      try {
        ws.send(JSON.stringify(m));
      } catch {
        /* Socket gerade zu */
      }
    }
  };
  const fail = (code: LiveErrorCode, wsCode = 4400) => {
    sendJson({ t: "error", code });
    try {
      ws.close(wsCode, code);
    } catch {
      /* schon zu */
    }
  };

  const doc = await deps.loadSim(ticket.uid, ticket.simId);
  if (!doc) return fail("NOT_FOUND", 4404);
  if (doc.status !== "active") return fail("ALREADY_FINISHED", 4409);
  if (doc.closedByTime) return fail("TIME_UP", 4409);
  if (doc.closedByPersona) return fail("ENDED", 4409);
  if (countUserTurns(doc.turns) >= SIM_MAX_USER_TURNS) return fail("TURN_LIMIT", 4409);
  const scenario = await deps.loadScenario(ticket.uid, doc.scenarioId, ticket.oid);
  if (!scenario) return fail("UNKNOWN_SCENARIO", 4410);

  const durationMin = sessionDurationMin(doc, scenario);
  const voice = liveVoiceFor(scenario.persona.voice, scenario.id, scenario.persona.liveVoice);
  const languageCode = liveLanguageCode(doc.convoLocale ?? scenario.locale);
  const spielbuch = deps.loadSpielbuch ? await deps.loadSpielbuch(scenario) : null;
  const endeWerkzeug =
    (deps.endeOn ?? true) && Boolean(scenario.personaDna.endbedingungen?.some((x) => x.trim()));
  const systemInstruction =
    buildPersonaSystemPrompt(scenario, doc.convoLocale, doc.hardness, spielbuch) +
    liveAddendum(scenario.locale, endeWerkzeug);

  // ── Zustand der Verbindung ────────────────────────────────────────────────
  let upstream: Upstream | null = null;
  let resumeHandle: string | undefined;
  let reconnects = 0;
  let closing = false; // wir beenden gerade (kein Reconnect mehr)
  let farewellPending = false; // die Verabschiedung wurde angewiesen; ihr Zug schließt den Lauf
  let personaEnde: { grund: string; ergebnis: PersonaEndeErgebnis } | null = null; // Werkzeug gerufen
  let pendingUser = "";
  let pendingPersona = "";
  let queue: Promise<void> = Promise.resolve();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let idleWarnTimer: ReturnType<typeof setTimeout> | undefined;
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((r) => (resolveDone = r));
  // Antwortzeit: Ende der Eingabe-Mitschrift → erstes Audio der Antwort (ungefähr, je Zug).
  let lastInputAt = 0;
  let audioSeenThisTurn = false;
  const latencies: number[] = [];

  const log = (level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) =>
    deps.log(level, msg, { simId: doc.id, uid: ticket.uid, ...meta });

  const bye = (reason: LiveByeReason) => {
    if (closing) return;
    closing = true;
    sendJson({ t: "bye", reason });
    try {
      upstream?.close();
    } catch {
      /* egal */
    }
    // Das bye-Frame erst abgehen lassen, dann schließen; Audio ist bereits beim Browser.
    timers.push(
      setTimeout(() => {
        try {
          ws.close(1000, reason);
        } catch {
          /* schon zu */
        }
      }, 300)
    );
  };

  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    if (idleWarnTimer) clearTimeout(idleWarnTimer);
    const idleMs = deps.idleMs ?? 120_000;
    const warnMs = Math.min(deps.idleWarnMs ?? 60_000, idleMs);
    if (idleMs - warnMs > 0) {
      idleWarnTimer = setTimeout(() => sendJson({ t: "idle_warn", seconds: Math.round(warnMs / 1000) }), idleMs - warnMs);
    }
    idleTimer = setTimeout(() => bye("idle"), idleMs);
  };

  const sendStageNote = (signal: PersonaTimeSignal) => {
    if (!upstream) return;
    upstream.sendText(personaStageNote(scenario, signal), signal === "farewell");
    if (signal === "farewell") farewellPending = true;
  };

  /** Welle 2: Regie-Beobachter nach dem Zug — Notiz an die Rolle, Verlauf am Lauf (in der Warteschlange). */
  const beobachten = async () => {
    if (!deps.regie || closing) return;
    const last = [...doc.turns].reverse().find((t) => t.role === "user");
    if (!last) return;
    const bisher = doc.regie?.length ? doc.regie[doc.regie.length - 1] : null;
    const stand = await deps.regie(scenario, doc.turns, bisher);
    if (!stand || closing) return;
    doc.regie = [...(doc.regie ?? []).slice(-40), { ...stand, delivered: Boolean(stand.notiz) }];
    await deps.saveSim(doc);
    if (stand.notiz && upstream) {
      upstream.sendText(regieStageNote(scenario, stand), false);
      log("info", "live-regie", { stufe: stand.stufe, eskaliert: stand.eskaliert, turn: stand.turn });
    }
  };

  /** Ein abgeschlossener Zug: Mitschriften werden Gesprächszüge, dann Regie wie in der Turn-Route. */
  const finalizeTurn = async () => {
    const user = pendingUser.trim();
    const persona = pendingPersona.trim();
    pendingUser = "";
    pendingPersona = "";
    audioSeenThisTurn = false;
    if (!user && !persona && !personaEnde) return;
    const ts = new Date(deps.now()).toISOString();
    if (user) doc.turns.push({ role: "user", text: user, ts });
    if (persona) doc.turns.push({ role: "persona", text: persona, ts });
    if (farewellPending) doc.closedByTime = true;
    if (personaEnde && !doc.closedByPersona) doc.closedByPersona = { ...personaEnde, at: ts };
    await deps.saveSim(doc);
    sendJson({
      t: "turn",
      user: user || null,
      persona: persona || null,
      userTurnsLeft: Math.max(0, SIM_MAX_USER_TURNS - countUserTurns(doc.turns)),
      timeUp: doc.closedByTime === true,
      ended: Boolean(doc.closedByPersona),
    });
    log("info", "live-turn", { turns: doc.turns.length, ...(doc.closedByTime ? { timeUp: true } : {}), ...(doc.closedByPersona ? { ended: doc.closedByPersona.ergebnis } : {}) });
    if (doc.closedByPersona) {
      sendJson({ t: "ended", grund: doc.closedByPersona.grund, ergebnis: doc.closedByPersona.ergebnis });
      return bye("ended_by_persona");
    }
    if (doc.closedByTime) return bye("time_up");
    if (closing) return;

    const budget = await deps.budget({ uid: ticket.uid, email: ticket.email, estimatedTokens: estimateTokens(user, persona) });
    if (!budget.allowed) return bye("budget");
    if (countUserTurns(doc.turns) >= SIM_MAX_USER_TURNS) return bye("turn_limit");

    const signal = decideTimeSignal({ createdAt: doc.createdAt, now: deps.now(), durationMin, timeWarned: doc.timeWarned === true });
    if (signal === "closing") {
      doc.timeWarned = true;
      await deps.saveSim(doc);
      sendStageNote("closing");
    } else if (signal === "farewell" && !farewellPending) {
      sendStageNote("farewell");
    }
    if (user) await beobachten();
  };
  const enqueueFinalize = () => {
    queue = queue.then(finalizeTurn).catch((e) => log("error", "live-finalize", { err: e instanceof Error ? e.message : String(e) }));
  };

  const events: UpstreamEvents = {
    onAudio: (pcm) => {
      if (!audioSeenThisTurn && lastInputAt) {
        audioSeenThisTurn = true;
        const ms = deps.now() - lastInputAt;
        if (ms >= 0 && ms < 60_000) latencies.push(ms);
        lastInputAt = 0;
      }
      if (ws.readyState === WS_OPEN) ws.send(pcm);
    },
    onInputText: (text) => {
      pendingUser += text;
      lastInputAt = deps.now();
      audioSeenThisTurn = false;
      sendJson({ t: "you", text: pendingUser });
    },
    onOutputText: (text) => {
      pendingPersona += text;
      sendJson({ t: "persona", text: pendingPersona });
    },
    onInterrupted: () => sendJson({ t: "interrupted" }),
    onTurnComplete: () => enqueueFinalize(),
    onToolCall: (calls) => {
      for (const call of calls) {
        const ende = parseEndeCall(call);
        try {
          upstream?.sendToolResponse?.([{ id: call.id, name: call.name, response: ende ? { ok: true } : { ok: false, error: "unknown tool" } }]);
        } catch (e) {
          log("warn", "live-tool-response", { err: e instanceof Error ? e.message : String(e) });
        }
        if (!ende) continue;
        personaEnde = ende;
        log("info", "live-ende-werkzeug", { ergebnis: ende.ergebnis });
        // Kommt kein turnComplete mehr (Werkzeug nach dem letzten Satz), schließt der Zug nach kurzer Frist.
        timers.push(setTimeout(() => { if (!closing && personaEnde && !doc.closedByPersona) enqueueFinalize(); }, 2_500));
      }
    },
    onResumptionHandle: (h) => {
      resumeHandle = h;
    },
    onGoAway: () => log("info", "live-goaway"),
    onClose: (reason) => {
      if (closing || ws.readyState !== WS_OPEN) return;
      // Abriss der Google-Seite (z. B. Sitzungsgrenze): mit Marke neu verbinden, sonst Ende.
      if (resumeHandle && reconnects < 2) {
        reconnects += 1;
        log("warn", "live-upstream-reconnect", { reason, reconnects });
        void connectUpstream().catch((e) => {
          log("error", "live-upstream-reconnect-failed", { err: e instanceof Error ? e.message : String(e) });
          bye("upstream");
        });
        return;
      }
      log("warn", "live-upstream-closed", { reason });
      bye("upstream");
    },
    onError: (err) => {
      log("error", "live-upstream-error", { err: err instanceof Error ? err.message : String(err) });
      if (!closing) bye("upstream");
    },
  };

  const connectUpstream = async () => {
    const cfg: UpstreamConfig = {
      model: deps.model,
      voice,
      languageCode,
      systemInstruction,
      resumeHandle,
      endeWerkzeug,
      sprechpause: deps.sprechpause ?? "normal",
    };
    const up = await deps.connect(cfg, events);
    upstream = up;
    // Verlauf nur beim ersten Verbinden einspielen; die Wiederaufnahme kennt ihn schon.
    if (!resumeHandle && doc.turns.length) up.sendHistory(toHistory(doc.turns));
  };

  // ── Browser-Socket ────────────────────────────────────────────────────────
  ws.on("message", (data, isBinary) => {
    if (closing) return;
    if (isBinary) {
      resetIdle();
      try {
        upstream?.sendAudio(asBuffer(data));
      } catch (e) {
        log("warn", "live-send-audio", { err: e instanceof Error ? e.message : String(e) });
      }
      return;
    }
    let msg: ClientMessage | null = null;
    try {
      msg = JSON.parse(asBuffer(data).toString("utf8")) as ClientMessage;
    } catch {
      return;
    }
    if (msg?.t === "end") bye("ended");
  });
  ws.on("error", (e) => log("warn", "live-ws-error", { err: e instanceof Error ? e.message : String(e) }));
  ws.on("close", () => {
    closing = true;
    if (idleTimer) clearTimeout(idleTimer);
    if (idleWarnTimer) clearTimeout(idleWarnTimer);
    for (const t of timers) clearTimeout(t);
    try {
      upstream?.close();
    } catch {
      /* egal */
    }
    // Angefangenes nicht verlieren: was schon mitgeschrieben ist, wird noch gespeichert — und die Antwortzeiten.
    queue = queue.then(async () => {
      const user = pendingUser.trim();
      const persona = pendingPersona.trim();
      pendingUser = "";
      pendingPersona = "";
      const ts = new Date(deps.now()).toISOString();
      if (user) doc.turns.push({ role: "user", text: user, ts });
      if (persona) doc.turns.push({ role: "persona", text: persona, ts });
      const stats = latencyStats(latencies);
      if (stats) {
        doc.liveStats = stats;
        log("info", "live-latency", stats);
      }
      if (user || persona || stats) await deps.saveSim(doc);
    }).catch((e) => log("error", "live-close-save", { err: e instanceof Error ? e.message : String(e) }));
    void queue.then(() => resolveDone());
  });

  // ── Start ─────────────────────────────────────────────────────────────────
  try {
    await connectUpstream();
  } catch (e) {
    log("error", "live-upstream-connect", { err: e instanceof Error ? e.message : String(e) });
    fail("UPSTREAM", 4502);
    return done;
  }
  if (closing) return done; // Browser hat während des Verbindens aufgelegt
  resetIdle();
  timers.push(setTimeout(() => bye("ended"), deps.maxConnectionMs ?? 30 * 60_000));
  sendJson({ t: "ready", persona: scenario.persona.name, voice });
  log("info", "live-ready", { scenarioId: scenario.id, voice, turns: doc.turns.length, endeWerkzeug });

  // Wer spät wieder einsteigt, bekommt die Zeit-Regie sofort — und die letzte Regie-Notiz noch einmal.
  const signal = decideTimeSignal({ createdAt: doc.createdAt, now: deps.now(), durationMin, timeWarned: doc.timeWarned === true });
  if (signal === "farewell") sendStageNote("farewell");
  else if (signal === "closing") {
    doc.timeWarned = true;
    await deps.saveSim(doc);
    sendStageNote("closing");
  }
  const letzteRegie = doc.regie?.length ? doc.regie[doc.regie.length - 1] : null;
  if (letzteRegie?.notiz && upstream) (upstream as Upstream).sendText(regieStageNote(scenario, letzteRegie), false);
  return done;
}
