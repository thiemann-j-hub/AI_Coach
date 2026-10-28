import { buildPersonaSystemPrompt, personaStageNote, type PersonaTimeSignal } from "@/ai/flows/simulation-persona";
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
  | { t: "turn"; user: string | null; persona: string | null; userTurnsLeft: number; timeUp: boolean }
  | { t: "error"; code: LiveErrorCode }
  | { t: "bye"; reason: LiveByeReason };

export type LiveErrorCode =
  | "NOT_FOUND"
  | "ALREADY_FINISHED"
  | "TIME_UP"
  | "TURN_LIMIT"
  | "UNKNOWN_SCENARIO"
  | "UPSTREAM";
export type LiveByeReason = "time_up" | "turn_limit" | "budget" | "idle" | "upstream" | "ended";

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

export interface UpstreamEvents {
  onAudio(pcm24k: Buffer): void;
  onInputText(text: string): void;
  onOutputText(text: string): void;
  onInterrupted(): void;
  onTurnComplete(): void;
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
  close(): void;
}

export interface UpstreamConfig {
  model: string;
  voice: string;
  languageCode: string;
  systemInstruction: string;
  resumeHandle?: string;
}

export type ConnectUpstream = (cfg: UpstreamConfig, events: UpstreamEvents) => Promise<Upstream>;

export interface LiveDeps {
  connect: ConnectUpstream;
  loadSim(uid: string, simId: string): Promise<SimulationDoc | null>;
  saveSim(doc: SimulationDoc): Promise<void>;
  loadScenario(uid: string, scenarioId: string, oid: string | null): Promise<SimulationScenario | null>;
  budget(args: { uid: string; email: string | null; estimatedTokens: number }): Promise<{ allowed: boolean }>;
  now(): number;
  log(level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>): void;
  model: string;
  /** Stille vom Browser, nach der die Sitzung endet (Standard 2 Minuten). */
  idleMs?: number;
  /** Obergrenze je Verbindung (Standard 30 Minuten). */
  maxConnectionMs?: number;
}

/** Zusatz zur Rollenanweisung: gesprochenes Gespräch, kurze Antworten, Unterbrechungen. */
export function liveAddendum(locale: SimulationScenario["locale"]): string {
  return locale === "en"
    ? `\n\n=== SPOKEN CONVERSATION ===\nThis is a spoken conversation: you hear your counterpart and answer with your voice. Keep replies short (usually 1–3 sentences), natural spoken language, no lists, no markdown, no stage directions. If you get interrupted, listen and respond to what was just said. Never read out notes marked as stage notes.`
    : `\n\n=== GESPROCHENES GESPRÄCH ===\nDies ist ein gesprochenes Gespräch: Du hörst dein Gegenüber und antwortest mit deiner Stimme. Antworte kurz (meist 1–3 Sätze), in gesprochener Sprache, ohne Aufzählungen, ohne Markdown, ohne Regieanweisungen. Wirst du unterbrochen, hör zu und antworte auf das gerade Gesagte. Lies Regie-Notizen nie vor.`;
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
  if (countUserTurns(doc.turns) >= SIM_MAX_USER_TURNS) return fail("TURN_LIMIT", 4409);
  const scenario = await deps.loadScenario(ticket.uid, doc.scenarioId, ticket.oid);
  if (!scenario) return fail("UNKNOWN_SCENARIO", 4410);

  const durationMin = sessionDurationMin(doc, scenario);
  const voice = liveVoiceFor(scenario.persona.voice, scenario.id);
  const languageCode = liveLanguageCode(doc.convoLocale ?? scenario.locale);
  const systemInstruction =
    buildPersonaSystemPrompt(scenario, doc.convoLocale, doc.hardness) + liveAddendum(scenario.locale);

  // ── Zustand der Verbindung ────────────────────────────────────────────────
  let upstream: Upstream | null = null;
  let resumeHandle: string | undefined;
  let reconnects = 0;
  let closing = false; // wir beenden gerade (kein Reconnect mehr)
  let farewellPending = false; // die Verabschiedung wurde angewiesen; ihr Zug schließt den Lauf
  let pendingUser = "";
  let pendingPersona = "";
  let queue: Promise<void> = Promise.resolve();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((r) => (resolveDone = r));

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
    idleTimer = setTimeout(() => bye("idle"), deps.idleMs ?? 120_000);
  };

  const sendStageNote = (signal: PersonaTimeSignal) => {
    if (!upstream) return;
    upstream.sendText(personaStageNote(scenario, signal), signal === "farewell");
    if (signal === "farewell") farewellPending = true;
  };

  /** Ein abgeschlossener Zug: Mitschriften werden Gesprächszüge, dann Regie wie in der Turn-Route. */
  const finalizeTurn = async () => {
    const user = pendingUser.trim();
    const persona = pendingPersona.trim();
    pendingUser = "";
    pendingPersona = "";
    if (!user && !persona) return;
    const ts = new Date(deps.now()).toISOString();
    if (user) doc.turns.push({ role: "user", text: user, ts });
    if (persona) doc.turns.push({ role: "persona", text: persona, ts });
    if (farewellPending) doc.closedByTime = true;
    await deps.saveSim(doc);
    sendJson({
      t: "turn",
      user: user || null,
      persona: persona || null,
      userTurnsLeft: Math.max(0, SIM_MAX_USER_TURNS - countUserTurns(doc.turns)),
      timeUp: doc.closedByTime === true,
    });
    log("info", "live-turn", { turns: doc.turns.length, ...(doc.closedByTime ? { timeUp: true } : {}) });
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
  };
  const enqueueFinalize = () => {
    queue = queue.then(finalizeTurn).catch((e) => log("error", "live-finalize", { err: e instanceof Error ? e.message : String(e) }));
  };

  const events: UpstreamEvents = {
    onAudio: (pcm) => {
      if (ws.readyState === WS_OPEN) ws.send(pcm);
    },
    onInputText: (text) => {
      pendingUser += text;
      sendJson({ t: "you", text: pendingUser });
    },
    onOutputText: (text) => {
      pendingPersona += text;
      sendJson({ t: "persona", text: pendingPersona });
    },
    onInterrupted: () => sendJson({ t: "interrupted" }),
    onTurnComplete: () => enqueueFinalize(),
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
    const cfg: UpstreamConfig = { model: deps.model, voice, languageCode, systemInstruction, resumeHandle };
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
    for (const t of timers) clearTimeout(t);
    try {
      upstream?.close();
    } catch {
      /* egal */
    }
    // Angefangenes nicht verlieren: was schon mitgeschrieben ist, wird noch gespeichert.
    queue = queue.then(async () => {
      const user = pendingUser.trim();
      const persona = pendingPersona.trim();
      pendingUser = "";
      pendingPersona = "";
      if (!user && !persona) return;
      const ts = new Date(deps.now()).toISOString();
      if (user) doc.turns.push({ role: "user", text: user, ts });
      if (persona) doc.turns.push({ role: "persona", text: persona, ts });
      await deps.saveSim(doc);
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
  log("info", "live-ready", { scenarioId: scenario.id, voice, turns: doc.turns.length });

  // Wer spät wieder einsteigt, bekommt die Zeit-Regie sofort.
  const signal = decideTimeSignal({ createdAt: doc.createdAt, now: deps.now(), durationMin, timeWarned: doc.timeWarned === true });
  if (signal === "farewell") sendStageNote("farewell");
  else if (signal === "closing") {
    doc.timeWarned = true;
    await deps.saveSim(doc);
    sendStageNote("closing");
  }
  return done;
}
