import { buildPersonaSystemPrompt, personaStageNote, type PersonaEndeErgebnis, type PersonaTimeSignal } from "@/ai/flows/simulation-persona";
import { regieStageNote, type RegieStand } from "@/ai/flows/simulation-regie";
import { ENDE_PRUEFUNG_TIMEOUT_MS, endeAbgelehntNote } from "@/ai/flows/simulation-ende-pruefung";
import type { SimulationScenario, SimulationTurn } from "@/lib/simulation/types";
import { ohneRegieKlammern } from "@/lib/simulation/beitrag";
import {
  SIM_MAX_USER_TURNS,
  SIM_TIME_WARN_FRACTION,
  countUserTurns,
  type SimulationDoc,
} from "@/lib/server/simulation-store";
import { estimateTokens } from "@/lib/server/cost-cap";
import { gespraechsZeitMs, pauseRestMs, pauseSetzen, type ZeitLauf } from "@/lib/simulation/zeit";
import { gehoertVomBrowser, kuerzeAufGehoertes, schaetzeGehoertMs, tonMs, type TextMarke } from "./gehoert";
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
 * A4 (Prüfung Sichtbarkeit, 31.10.2026): Der KI-Schalter des Unternehmens gilt auch in der laufenden Sitzung —
 * geprüft vor dem Verbinden, nach jedem Zug und in festem Takt (auch wenn gerade niemand spricht, geht das
 * Mikrofon-Audio an das Live-Modell). Ist er aus: Fehler-Frame KI_AUS mit der Meldung, dann Ende.
 *
 * Pakete 1 und 2 (Owner-GO 12.11.2026, Code-Review C3, C7, C14, C36):
 *   - das Relais schreibt nie seine Kopie des Laufs zurück, sondern nur die eigene Änderung (Züge, Regie, Ende,
 *     Antwortzeiten) auf den frisch gelesenen Lauf, und nur solange der Lauf aktiv ist,
 *   - je Lauf gibt es höchstens eine Sitzung: eine neue Verbindung beendet die ältere (bye `replaced`),
 *   - der Regie-Beobachter läuft neben der Speicher-Warteschlange; Züge werden sofort gespeichert und gemeldet,
 *   - fällt der Torwächter oder der Beobachter aus, steht das im Protokoll (ohne Nutzertext).
 *
 * Paket 4 (Owner-GO 12.11.2026, „Sprechen nach vorn“; C13, C15, C36, S1, S22, S24, S31):
 *   - Coach-Pause: `pause` / `resume` halten Mikrofon-Audio, Stille-Uhr und Zeit-Regie an; die Pausenzeit steht am Lauf,
 *   - die Uhr rechnet über `gespraechsZeitMs` (src/lib/simulation/zeit.ts) und zieht Pausen ab,
 *   - hörbare Eröffnung: Mit `eroeffnung` im `hello` spricht die Rolle ihren gespeicherten Eröffnungssatz,
 *   - nach einer Unterbrechung geht nur der gehörte Teil der Antwort in den Verlauf (gehoert.ts),
 *   - `thinking`, sobald die Person fertig scheint; `reconnecting` / `reconnected` bei einem Abriss zur KI,
 *   - Abriss zur KI: nach der Vorwarnung vorab neu verbinden, ohne Marke mit dem Verlauf neu aufsetzen,
 *   - staut sich der Ton zum Browser, wird er verworfen statt gepuffert,
 *   - Antwortzeiten, Unterbrechungen und gekürzte Zeichen stehen je Lauf in `liveStats` (Qualitäts-Statistik).
 *
 * Alle Außenwelt (Vertex, Cosmos, Budget, Uhr) kommt über `LiveDeps` herein — der Kern ist testbar.
 * Es verlässt nie etwas aus der Rollen-DNA den Server; der Browser sieht nur Audio und Mitschrift.
 */

/**
 * Nachrichten Browser → Server (Text-Frames als JSON, Binär-Frames = Audio 16 kHz).
 * Paket 4 (12.11.2026), alles Neue ist freiwillig (ein alter Client läuft weiter): `eroeffnung` im `hello` (die Rolle
 * spricht ihren Eröffnungssatz), `pause` / `resume` (Coach-Pause), `heard` (direkt nach `interrupted`: so viele
 * Millisekunden der laufenden Antwort wurden wirklich abgespielt, S31). Der Browser zählt dafür den abgespielten Ton
 * seit dem letzten `turn` oder `interrupted`; das Relais rechnet Ton heraus, der davor lag (die hörbare Eröffnung
 * endet ohne `turn`).
 */
export type ClientMessage =
  | { t: "hello"; ticket: string; eroeffnung?: boolean }
  | { t: "end" }
  | { t: "pause" }
  | { t: "resume" }
  | { t: "heard"; ms: number };

/**
 * Nachrichten Server → Browser (Text-Frames als JSON, Binär-Frames = Audio 24 kHz).
 * Paket 4: `ready` trägt die Pausenfelder der Uhr und `eroeffnung` (die Rolle eröffnet gleich hörbar); `thinking` =
 * die Person ist fertig, die Antwort entsteht; `reconnecting` / `reconnected` = das Relais verbindet sich neu zur KI.
 * Nach `interrupted` kann `persona` einen KÜRZEREN Text tragen als zuvor (nur das Gehörte, auch leer).
 */
export type ServerMessage =
  | { t: "ready"; persona: string; voice: string; pausedMs: number; pauseSince: string | null; eroeffnung: boolean }
  | { t: "you"; text: string }
  | { t: "persona"; text: string }
  | { t: "interrupted" }
  | { t: "thinking" }
  | { t: "reconnecting" }
  | { t: "reconnected" }
  | { t: "turn"; user: string | null; persona: string | null; userTurnsLeft: number; timeUp: boolean; ended: boolean }
  | { t: "ended"; grund: string; ergebnis: PersonaEndeErgebnis }
  | { t: "idle_warn"; seconds: number }
  | { t: "error"; code: LiveErrorCode; message?: string }
  | { t: "bye"; reason: LiveByeReason };

export type LiveErrorCode =
  | "NOT_FOUND"
  | "ALREADY_FINISHED"
  | "TIME_UP"
  | "ENDED"
  | "TURN_LIMIT"
  | "UNKNOWN_SCENARIO"
  | "UPSTREAM"
  | "KI_AUS";
/**
 * Paket 2 (12.11.2026), zwei neue Gründe: `replaced` = eine neuere Verbindung hat diesen Lauf übernommen (C36);
 * `not_active` = der Lauf ist inzwischen ausgewertet, abgebrochen oder gelöscht, das Relais schreibt nichts mehr (C3).
 */
export type LiveByeReason =
  | "time_up"
  | "ended_by_persona"
  | "turn_limit"
  | "budget"
  | "idle"
  | "upstream"
  | "ended"
  | "ki_aus"
  | "replaced"
  | "not_active";

/** Der Teil eines ws-Sockets, den der Kern braucht (so bleibt er ohne ws-Typen testbar). */
export interface LiveSocket {
  send(data: string | Buffer): void;
  close(code?: number, reason?: string): void;
  on(event: "message", fn: (data: Buffer | ArrayBuffer | Buffer[] | string, isBinary: boolean) => void): void;
  on(event: "close", fn: () => void): void;
  on(event: "error", fn: (e: unknown) => void): void;
  /** Paket 4, C36: Hörer wieder abhängen (der Hallo-Hörer der Annahme); fehlt bei Attrappen. */
  removeListener?(event: "message" | "close", fn: (...args: never[]) => void): void;
  readonly readyState: number;
  /** Paket 4, C36: Bytes, die noch nicht beim Browser sind (Rückstau); fehlt bei Attrappen. */
  readonly bufferedAmount?: number;
}
export const WS_OPEN = 1;

/** Was der Browser im `hello` zur Sitzung wünscht (Paket 4). */
export interface LiveSessionOptions {
  /** Die Rolle spricht ihren gespeicherten Eröffnungssatz, wenn der Lauf noch keinen eigenen Beitrag hat. */
  eroeffnung?: boolean;
}

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
  /**
   * Paket 2, C3 (12.11.2026): ändert den GESPEICHERTEN Lauf (`updateSimulation`): liest frisch, wendet `mutate`
   * an, schreibt mit Versionsprüfung und wiederholt bei Konflikt. `mutate` muss wiederholbar sein; gibt es
   * `false` zurück, wird nichts geschrieben. Liefert den Lauf, wie er jetzt gespeichert ist, oder null (Lauf weg).
   */
  updateSim(uid: string, simId: string, mutate: (doc: SimulationDoc) => void | false): Promise<SimulationDoc | null>;
  loadScenario(uid: string, scenarioId: string, oid: string | null): Promise<SimulationScenario | null>;
  /** Spielbuch des Szenarios (vorbereitet) oder null; optional (Tests, Rückweg). */
  loadSpielbuch?(scenario: SimulationScenario): Promise<string | null>;
  /** Welle 2: Regie-Beobachter nach einem Zug der lernenden Person; optional (Tests, Rückweg). */
  regie?(scenario: SimulationScenario, turns: SimulationTurn[], bisher: RegieStand | null): Promise<RegieStand | null>;
  /** Torwächter (01.11.2026): prüft das gewünschte Ende gegen die Endbedingungen; optional (fehlt = Ende gilt). */
  endePruefen?(scenario: SimulationScenario, turns: SimulationTurn[], ende: { grund: string; ergebnis: "ziel" | "verabschiedung" | "abbruch" }): Promise<{ erfuellt: boolean; fehlt: string }>;
  budget(args: { uid: string; email: string | null; estimatedTokens: number }): Promise<{ allowed: boolean }>;
  /**
   * A4: KI-Schalter des Unternehmens für diese Kennung. Liefert die Meldung für die Person, wenn er aus ist,
   * sonst null — auch wenn die Einstellungen nicht lesbar sind (die Warnung schreibt die Prüfung selbst,
   * kiSchalterAus in entitlement.ts). Optional (Tests, Rückweg).
   */
  kiAusMeldung?(oid: string | null): Promise<string | null>;
  /** A4: Takt der Schalter-Prüfung, während die Verbindung steht (Standard 60 s, wie der Zwischenspeicher). */
  kiPruefMs?: number;
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
  /** Paket 2, C36: laufende Sitzungen je Lauf (Standard: eine Liste je Prozess; Tests reichen eine eigene herein). */
  sitzungen?: LiveSitzungen;
  /** Paket 4, S24: Zählpunkt „erstes Wort“ im Sprechweg (eine Protokollzeile ohne Nutzertext); optional. */
  zaehlpunkt?(schritt: "erstes_wort", meta: { scenarioId: string; weg: "sprechen" }): void;
  /** Paket 4, S31: So lange wartet das Relais nach einer Unterbrechung auf `heard` vom Browser (Standard 400 ms). */
  gehoertWarteMs?: number;
  /** Paket 4: Stille nach der letzten Eingabe-Mitschrift, nach der `thinking` an den Browser geht (Standard 600 ms). */
  denkStilleMs?: number;
}

/** Laufende Sitzungen: Schlüssel `uid:simId`, Wert = „beende Dich, eine neuere Verbindung übernimmt“. */
export type LiveSitzungen = Map<string, () => Promise<void>>;

/** Eine Liste je Prozess, wie der Karten-Laden (ticket-store.ts): Der Coach läuft als EIN Prozess. */
function liveSitzungen(): LiveSitzungen {
  const g = globalThis as typeof globalThis & { __coachLiveSitzungen?: LiveSitzungen };
  if (!g.__coachLiveSitzungen) g.__coachLiveSitzungen = new Map();
  return g.__coachLiveSitzungen;
}

/** So lange wartet eine neue Verbindung höchstens darauf, dass die ältere ihr Angefangenes gespeichert hat. */
const ERSETZEN_WARTE_MS = 3_000;

/** Wartet auf `p`, höchstens aber `ms`; Fehler von `p` zählen als fertig. */
function hoechstens(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    void p
      .catch(() => undefined)
      .then(() => {
        clearTimeout(t);
        resolve();
      });
  });
}

/** Name des Werkzeugs, mit dem die Rolle das Gespräch beendet. */
/** Stille nach der Ende-Freigabe, nach der der Zug abgeschlossen wird (die Abschiedsrede dauert meist 2–6 s). */
export const ENDE_STILLE_MS = 3_000;
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
      ? `\nENDING: When one of the END conditions is met, FIRST call the tool ${ENDE_WERKZEUG} silently with grund (one sentence why) and ergebnis (ziel, verabschiedung or abbruch) — before any goodbye. If the tool answers ok, say your goodbye line. If it answers that something is still missing, do NOT say goodbye: stay in the conversation and ask for what is missing. Never mention the tool.`
      : `\nENDE: Ist eine der ENDBEDINGUNGEN erfüllt, rufe ZUERST stumm das Werkzeug ${ENDE_WERKZEUG} auf, mit grund (ein Satz, warum) und ergebnis (ziel, verabschiedung oder abbruch) — vor jedem Abschied. Antwortet es mit ok, sprich deinen Abschiedssatz. Antwortet es, dass noch etwas fehlt, verabschiede dich NICHT: bleib im Gespräch und verlange, was fehlt. Erwähne das Werkzeug nie.`)
  );
}

/** S31: So lange wartet das Relais nach einer Unterbrechung höchstens auf `heard` vom Browser. */
export const GEHOERT_WARTE_MS = 400;
/**
 * `thinking`: Das Live-Modell meldet kein „die Person ist fertig“. Das Relais nimmt es an, wenn nach der letzten
 * Eingabe-Mitschrift so lange nichts mehr kommt und noch kein Ton der Antwort da ist.
 */
export const DENK_STILLE_MS = 600;
/** C36: Ab so vielen ungesendeten Bytes zum Browser (rund 20 Sekunden Ton) wird neuer Ton verworfen. */
export const RUECKSTAU_MAX_BYTES = 1_000_000;
/** C15: So viele Abrisse zur KI hintereinander fängt das Relais auf; nach einem gelungenen Zug zählt es neu. */
export const MAX_WIEDERAUFNAHMEN = 2;

/** S1: Auftrag an die Rolle, ihren gespeicherten Eröffnungssatz zu sprechen (Stil der Regie-Notizen). */
export function eroeffnungsNote(locale: SimulationScenario["locale"], satz: string): string {
  return locale === "en"
    ? `[STAGE NOTE — not part of the conversation: the conversation starts now. Open it by saying exactly this line, word for word and nothing else: »${satz}« Then wait for your counterpart.]`
    : `[REGIE — nicht Teil des Gesprächs: Das Gespräch beginnt jetzt. Eröffne es mit genau diesem Satz, wörtlich und ohne Zusatz: »${satz}« Warte danach auf dein Gegenüber.]`;
}

/**
 * Zeit-Regie (PURE): dieselbe Entscheidung wie in der Turn-Route.
 * Paket 4, C13 (12.11.2026): gerechnet wird die Gesprächszeit ohne Coach-Pausen (`gespraechsZeitMs`).
 */
export function decideTimeSignal(
  args: ZeitLauf & {
    now: number;
    durationMin: number;
    timeWarned: boolean;
  }
): PersonaTimeSignal | undefined {
  const elapsedMs = gespraechsZeitMs(args, args.now);
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

/** So viele einzelne Antwortzeiten bleiben je Lauf gespeichert (ein Lauf hat höchstens 40 eigene Züge). */
export const LIVE_ZEITEN_MAX = 60;

/**
 * Paket 4, S22 (12.11.2026): Kennzahlen des Sprachwegs am Lauf; PURE. `vorher` ist der Stand früherer Sitzungen
 * desselben Laufs (jedes Mikrofon-Aus beendet eine Sitzung): Zeiten und Zähler werden zusammengezählt statt
 * überschrieben. Messlatte aus dem Vergleich (S22): Antwort nach 1,3 s, Ton aus 0,8 s nach einem Einwurf.
 */
export function liveKennzahlen(
  vorher: SimulationDoc["liveStats"],
  sitzung: { zeiten: number[]; unterbrechungen: number; gekuerztZeichen: number }
): NonNullable<SimulationDoc["liveStats"]> | null {
  const unterbrechungen = (vorher?.unterbrechungen ?? 0) + sitzung.unterbrechungen;
  const gekuerztZeichen = (vorher?.gekuerztZeichen ?? 0) + sitzung.gekuerztZeichen;
  if (!vorher && !sitzung.zeiten.length && !unterbrechungen) return null;
  const zeiten = [...(vorher?.zeiten ?? []), ...sitzung.zeiten.map((z) => Math.round(z))].slice(-LIVE_ZEITEN_MAX);
  // Ohne einzelne Zeiten (Lauf von vor dem 12.11.2026, diese Sitzung ohne Antwort) bleiben die alten Werte stehen.
  const werte = latencyStats(zeiten) ?? {
    antworten: vorher?.antworten ?? 0,
    p50Ms: vorher?.p50Ms ?? 0,
    p95Ms: vorher?.p95Ms ?? 0,
    maxMs: vorher?.maxMs ?? 0,
  };
  return { ...werte, zeiten, unterbrechungen, gekuerztZeichen };
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
    // S6: Eckige Klammern der Person werden rund, damit ein früherer Beitrag nicht wie eine Regie-Notiz aussieht.
    .map((t) => (t.role === "user" ? { role: "user" as const, text: ohneRegieKlammern(t.text) } : { role: "model" as const, text: t.text }));
}

function asBuffer(data: Buffer | ArrayBuffer | Buffer[] | string): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  if (typeof data === "string") return Buffer.from(data);
  return Buffer.from(data);
}

/**
 * Führt EINE Live-Verbindung bis zu ihrem Ende. Löst auf, wenn der Browser-Socket zu ist.
 * Die Karte ist bereits geprüft und eingelöst (Route + Mantel). `opts` trägt die Wünsche aus dem `hello`.
 */
export async function runLiveSession(
  ws: LiveSocket,
  ticket: LiveTicket,
  deps: LiveDeps,
  opts: LiveSessionOptions = {}
): Promise<void> {
  const sendJson = (m: ServerMessage) => {
    if (ws.readyState === WS_OPEN) {
      try {
        ws.send(JSON.stringify(m));
      } catch {
        /* Socket gerade zu */
      }
    }
  };
  const fail = (code: LiveErrorCode, wsCode = 4400, message?: string) => {
    sendJson(message ? { t: "error", code, message } : { t: "error", code });
    try {
      ws.close(wsCode, code);
    } catch {
      /* schon zu */
    }
  };

  const log = (level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) =>
    deps.log(level, msg, { simId: ticket.simId, uid: ticket.uid, ...meta });

  // ── Ende der Sitzung ──────────────────────────────────────────────────────
  // Paket 2, C36 (12.11.2026): Die Hörer für close und error stehen vor dem ersten Warten. Vorher wurde ein
  // Auflegen während des Ladens verpasst, die Sitzung lief dann ohne Browser weiter.
  let closing = false; // wir beenden gerade (kein Reconnect mehr)
  const sitzungen = deps.sitzungen ?? liveSitzungen();
  const sitzungsKey = `${ticket.uid}:${ticket.simId}`;
  const abmelden = () => {
    if (sitzungen.get(sitzungsKey) === ersetzen) sitzungen.delete(sitzungsKey);
  };
  /** Bis die Sitzung steht, gibt es nichts zu speichern; danach übernimmt der Abschluss weiter unten. */
  let abschluss = async (): Promise<void> => abmelden();
  /** Eine neuere Verbindung für denselben Lauf übernimmt: Grund melden, schließen, Angefangenes speichern. */
  const ersetzen = async (): Promise<void> => {
    if (!closing) {
      closing = true;
      sendJson({ t: "bye", reason: "replaced" });
    }
    try {
      ws.close(1000, "replaced");
    } catch {
      /* schon zu */
    }
    await abschluss();
  };
  ws.on("error", (e) => log("warn", "live-ws-error", { err: e instanceof Error ? e.message : String(e) }));
  ws.on("close", () => {
    closing = true;
    void abschluss();
  });

  // Paket 2, C36: höchstens eine Live-Sitzung je Lauf. Zwei Verbindungen (zweiter Tab, Doppelklick, Neuverbinden,
  // bevor die alte Sitzung gespeichert hat) hielten je eine eigene Kopie. Die ältere endet, bevor die neue lädt.
  const vorgaenger = sitzungen.get(sitzungsKey);
  sitzungen.set(sitzungsKey, ersetzen);
  if (vorgaenger) {
    log("info", "live-ersetzt");
    await hoechstens(vorgaenger(), ERSETZEN_WARTE_MS);
    if (closing) return;
  }

  const geladen = await deps.loadSim(ticket.uid, ticket.simId);
  if (!geladen) return fail("NOT_FOUND", 4404);
  // Arbeitsstand für Prompts und Entscheidungen. Paket 2, C3: gespeichert wird nie diese Kopie, sondern nur die
  // eigene Änderung (siehe „Speichern“); nach jedem Schreiben ist sie der gespeicherte Lauf.
  let doc: SimulationDoc = geladen;
  if (doc.status !== "active") return fail("ALREADY_FINISHED", 4409);
  if (doc.closedByTime) return fail("TIME_UP", 4409);
  if (doc.closedByPersona) return fail("ENDED", 4409);
  if (countUserTurns(doc.turns) >= SIM_MAX_USER_TURNS) return fail("TURN_LIMIT", 4409);
  const scenario = await deps.loadScenario(ticket.uid, doc.scenarioId, ticket.oid);
  if (!scenario) return fail("UNKNOWN_SCENARIO", 4410);
  // A4: Schalter vor dem Verbinden — und vor dem Spielbuch, das fehlende Spielbücher per KI schreiben lässt.
  const kiAusBeimStart = deps.kiAusMeldung ? await deps.kiAusMeldung(ticket.oid) : null;
  if (kiAusBeimStart) return fail("KI_AUS", 4403, kiAusBeimStart);

  const durationMin = sessionDurationMin(doc, scenario);
  const voice = liveVoiceFor(scenario.persona.voice, scenario.id, scenario.persona.liveVoice);
  const languageCode = liveLanguageCode(doc.convoLocale ?? scenario.locale);
  const spielbuch = deps.loadSpielbuch ? await deps.loadSpielbuch(scenario) : null;
  // C36: während des Ladens aufgelegt (oder von einer neueren Verbindung ersetzt) → nichts verbinden.
  if (closing) return;
  const endeWerkzeug =
    (deps.endeOn ?? true) && Boolean(scenario.personaDna.endbedingungen?.some((x) => x.trim()));
  const systemInstruction =
    buildPersonaSystemPrompt(scenario, doc.convoLocale, doc.hardness, spielbuch) +
    liveAddendum(scenario.locale, endeWerkzeug);

  // ── Zustand der Verbindung ────────────────────────────────────────────────
  let upstream: Upstream | null = null;
  let resumeHandle: string | undefined;
  let reconnects = 0;
  // Paket 4, C15: Ereignisse gelten nur von der Verbindung, die gerade trägt (`aktiv`) oder aufgebaut wird
  // (`imAufbau`). Was eine abgelöste Verbindung noch schickt, wird verworfen.
  let aktiv: object | null = null;
  let imAufbau: object | null = null;
  let goAwayOffen = false; // das Modell hat das Ende der Verbindung angekündigt
  let markeFrisch = false; // seit der letzten Wiederaufnahme-Marke ist nichts gesprochen worden
  let vorabLaeuft = false; // der vorsorgliche Wechsel auf eine neue Verbindung läuft
  let farewellPending = false; // die Verabschiedung wurde angewiesen; ihr Zug schließt den Lauf
  let personaEnde: { grund: string; ergebnis: PersonaEndeErgebnis } | null = null; // Werkzeug gerufen und freigegeben
  let endeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Nach der Freigabe spricht die Rolle noch ihren Abschied: Abschluss erst nach ENDE_STILLE_MS ohne Ausgabe (oder turnComplete). */
  const endeTimerNeu = () => {
    if (endeTimer) clearTimeout(endeTimer);
    endeTimer = setTimeout(() => { if (!closing && personaEnde && !doc.closedByPersona) enqueueFinalize(); }, ENDE_STILLE_MS);
    timers.push(endeTimer);
  };
  let pendingUser = "";
  let pendingPersona = "";
  let queue: Promise<void> = Promise.resolve();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let idleWarnTimer: ReturnType<typeof setTimeout> | undefined;
  let kiTimer: ReturnType<typeof setInterval> | undefined;
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((r) => (resolveDone = r));
  // Antwortzeit: Ende der Eingabe-Mitschrift → erstes Audio der Antwort (ungefähr, je Zug).
  let lastInputAt = 0;
  let audioSeenThisTurn = false;
  const latencies: number[] = [];
  // Paket 4, S22: Zählwerte dieser Sitzung. `liveStatsVorher` ist der Stand früherer Sitzungen dieses Laufs.
  const liveStatsVorher = doc.liveStats ?? null;
  let unterbrechungen = 0;
  let gekuerztZeichen = 0;
  let verworfenBytes = 0; // C36: bei Rückstau verworfener Ton
  const kennzahlen = () => liveKennzahlen(liveStatsVorher, { zeiten: latencies, unterbrechungen, gekuerztZeichen });
  // Paket 4, S31: Ton und Textstand der laufenden Antwort; `kuerzung` läuft nach einer Unterbrechung.
  let antwortTonBytes = 0;
  let antwortErsterTonAt: number | null = null;
  let antwortMarken: TextMarke[] = [];
  /** Ton an den Browser seit dem letzten `turn` oder `interrupted`: Ab dort zählt der Browser sein `heard`. */
  let tonSeitMeldungBytes = 0;
  let antwortAbgebrochen = false; // nach `interrupted`: Nachzügler der Mitschrift zählen nicht mehr
  let kuerzung: Promise<string> | null = null;
  let gehoertMelden: ((ms: number | null) => void) | null = null;
  const antwortNeu = () => {
    antwortTonBytes = 0;
    antwortErsterTonAt = null;
    antwortMarken = [];
  };
  // Paket 4: Coach-Pause, hörbare Eröffnung, Zustand „denkt nach“.
  let pausiert = false;
  let pauseTimer: ReturnType<typeof setTimeout> | undefined;
  let eroeffnungLaeuft = false;
  let denkTimer: ReturnType<typeof setTimeout> | undefined;
  /** Zeit-Regie über die gemeinsame Uhr (C13): Coach-Pausen zählen nicht. */
  const zeitSignal = () =>
    decideTimeSignal({
      createdAt: doc.createdAt,
      pausedMs: doc.pausedMs,
      pauseSince: doc.pauseSince,
      now: deps.now(),
      durationMin,
      timeWarned: doc.timeWarned === true,
    });

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

  // ── Speichern (Paket 2, C3, 12.11.2026) ───────────────────────────────────
  // Vorher schrieb das Relais seine bis zu 30 Minuten alte Kopie jeweils ganz zurück: Coach-Tipps gingen verloren,
  // zwei Verbindungen überschrieben sich, ein später Schreiber setzte eine fertige Auswertung auf „aktiv“ zurück.
  // Jetzt geht nur die eigene Änderung auf den frisch gelesenen Lauf, eine nach der anderen, und nur solange der
  // Lauf aktiv ist. Danach ist die Arbeitskopie der gespeicherte Lauf (samt fremder Änderungen wie coachNotes).
  type Aenderung = (lauf: SimulationDoc) => void;
  /** Änderungen, deren Speichern scheiterte: Sie gehen mit dem nächsten Schreiben mit. */
  const offen: Aenderung[] = [];
  let laufAktiv = true;
  let schreibKette: Promise<unknown> = Promise.resolve();
  /** true = gespeichert. false = der Lauf ist nicht mehr aktiv (ausgewertet, abgebrochen, gelöscht): nichts geschrieben, die Sitzung endet. */
  const schreiben = (aenderung: Aenderung): Promise<boolean> => {
    const lauf = schreibKette.then(async () => {
      if (!laufAktiv) return false;
      offen.push(aenderung);
      const stapel = [...offen];
      let aktiv = false as boolean;
      let gespeichert: SimulationDoc | null;
      try {
        gespeichert = await deps.updateSim(ticket.uid, ticket.simId, (frisch) => {
          aktiv = frisch.status === "active";
          if (!aktiv) return false;
          for (const a of stapel) a(frisch);
        });
      } catch (e) {
        // Für Prompts und Zählung gilt die Änderung schon; gespeichert wird sie mit dem nächsten Schreiben.
        aenderung(doc);
        throw e;
      }
      offen.length = 0;
      if (!gespeichert || !aktiv) {
        laufAktiv = false;
        log("info", "live-lauf-nicht-aktiv", { status: gespeichert?.status ?? "weg" });
        bye("not_active");
        return false;
      }
      doc = gespeichert;
      return true;
    });
    schreibKette = lauf.catch(() => undefined);
    return lauf;
  };

  const stopIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    if (idleWarnTimer) clearTimeout(idleWarnTimer);
  };
  const resetIdle = () => {
    stopIdle();
    if (pausiert) return; // Coach-Pause: die Stille-Uhr steht
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
  /** Zeit-Regie: Der Hinweis „muss gleich los“ ist gegeben (am Lauf merken, damit er nur einmal kommt). */
  const zeitHinweisMerken = () =>
    schreiben((lauf) => {
      lauf.timeWarned = true;
    });

  // ── Coach-Pause (Paket 4, C13, 12.11.2026) ────────────────────────────────
  // In der Pause geht kein Mikrofon-Audio an die KI, Stille-Uhr und Zeit-Regie stehen. Die Pausenzeit steht am Lauf,
  // über dieselbe Funktion wie in POST /api/simulation/pause (der Browser ruft beides; doppelt ändert nichts).
  // Legt der Browser in der Pause auf, bleibt sie am Lauf offen und endet dort am Deckel von selbst.
  const pauseEnde = (anlass: "resume" | "deckel") => {
    if (!pausiert) return;
    pausiert = false;
    if (pauseTimer) clearTimeout(pauseTimer);
    const jetzt = deps.now();
    log("info", "live-pause-ende", { anlass });
    void schreiben((lauf) => {
      pauseSetzen(lauf, false, jetzt);
    }).catch((e) => log("error", "live-pause-speichern", { err: e instanceof Error ? e.message : String(e) }));
    if (!closing) resetIdle();
  };
  const pauseBeginn = () => {
    // Im Prüfungsmodus gibt es keine Coach-Pause (wie in der Coach-Route).
    if (pausiert || closing || doc.mode === "check") return;
    pausiert = true;
    stopIdle();
    if (denkTimer) clearTimeout(denkTimer);
    const jetzt = deps.now();
    log("info", "live-pause");
    void schreiben((lauf) => {
      pauseSetzen(lauf, true, jetzt);
    })
      .catch((e) => log("error", "live-pause-speichern", { err: e instanceof Error ? e.message : String(e) }))
      .then(() => {
        if (!pausiert || closing) return;
        // Die Pause endet spätestens am Deckel von selbst (5 Minuten je Pause, 15 Minuten je Lauf).
        const rest = pauseRestMs(doc, deps.now());
        if (rest <= 0) return pauseEnde("deckel");
        if (pauseTimer) clearTimeout(pauseTimer);
        pauseTimer = setTimeout(() => pauseEnde("deckel"), rest);
      });
  };

  /** `thinking`: nach der letzten Eingabe-Mitschrift kurz warten; kommt nichts mehr und noch kein Ton, denkt die Rolle nach. */
  const denkNeu = () => {
    if (denkTimer) clearTimeout(denkTimer);
    denkTimer = setTimeout(() => {
      // Nicht, wenn die Antwort schon tönt (die Mitschrift der Person kann dem Ton der Rolle nachlaufen).
      if (closing || pausiert || !lastInputAt || antwortTonBytes > 0) return;
      sendJson({ t: "thinking" });
    }, deps.denkStilleMs ?? DENK_STILLE_MS);
  };

  /** A4: Ist der KI-Schalter inzwischen aus? Dann Meldung an den Browser und Ende. true = beendet. */
  const kiPruefen = async (): Promise<boolean> => {
    if (!deps.kiAusMeldung || closing) return false;
    const meldung = await deps.kiAusMeldung(ticket.oid);
    if (!meldung || closing) return false;
    log("info", "live-ki-aus");
    sendJson({ t: "error", code: "KI_AUS", message: meldung });
    bye("ki_aus");
    return true;
  };

  /**
   * Welle 2: Regie-Beobachter nach dem Zug — Notiz an die Rolle, Verlauf am Lauf.
   * Paket 1, C14 (12.11.2026): Er läuft NEBEN der Speicher-Warteschlange und hängt seine Notiz nach, wenn er fertig
   * ist. Vorher stand er in der Warteschlange: Hing er, wurden folgende Züge weder gespeichert noch gemeldet, und
   * das Abschluss-Speichern wartete. Es läuft höchstens einer; kam inzwischen ein Zug dazu, folgt genau ein
   * weiterer Lauf mit dem neuesten Stand.
   */
  let beobachterLaeuft = false;
  let beobachterNochmal = false;
  const beobachten = () => {
    const regie = deps.regie;
    if (!regie || closing) return;
    if (beobachterLaeuft) {
      beobachterNochmal = true;
      return;
    }
    beobachterLaeuft = true;
    void (async () => {
      const bisher = doc.regie?.length ? doc.regie[doc.regie.length - 1] : null;
      const t0 = deps.now();
      // Paket 2, C7: Fällt der Beobachter aus, steht das im Protokoll (ohne Nutzertext). Er liefert null nach
      // Frist oder Fehler; die Notiz dieses Zugs entfällt dann.
      let stand: RegieStand | null;
      try {
        stand = await regie(scenario, doc.turns, bisher);
      } catch {
        return log("warn", "live-regie-ausfall", { anlass: "fehler", ms: deps.now() - t0 });
      }
      if (!stand) return log("warn", "live-regie-ausfall", { anlass: "frist-oder-fehler", ms: deps.now() - t0 });
      if (closing) return;
      const eintrag = { ...stand, delivered: Boolean(stand.notiz) };
      const gespeichert = await schreiben((lauf) => {
        lauf.regie = [...(lauf.regie ?? []).slice(-40), eintrag];
      });
      if (!gespeichert || closing) return;
      if (stand.notiz && upstream) {
        upstream.sendText(regieStageNote(scenario, stand), false);
        log("info", "live-regie", { stufe: stand.stufe, eskaliert: stand.eskaliert, turn: stand.turn });
      }
    })()
      .catch((e) => log("error", "live-regie-speichern", { err: e instanceof Error ? e.message : String(e) }))
      .finally(() => {
        beobachterLaeuft = false;
        if (beobachterNochmal) {
          beobachterNochmal = false;
          beobachten();
        }
      });
  };

  /** Mitschriften eines Zugs, festgehalten im Augenblick seines Abschlusses. `kuerzung`: die Antwort wurde unterbrochen (S31). */
  type OffenerZug = { user: string; persona: string; kuerzung: Promise<string> | null };

  /** Ein abgeschlossener Zug: Mitschriften werden Gesprächszüge, dann Regie wie in der Turn-Route. */
  const finalizeTurn = async (zug: OffenerZug) => {
    const user = zug.user.trim();
    // S31: Nach einer Unterbrechung zählt nur der gehörte Teil der Antwort (höchstens 400 ms Warten auf den Browser).
    const persona = (zug.kuerzung ? await zug.kuerzung : zug.persona).trim();
    if (!user && !persona && !personaEnde) return;
    const jetzt = deps.now();
    const ts = new Date(jetzt).toISOString();
    const zeitUm = farewellPending;
    const ende = personaEnde;
    const stats = kennzahlen();
    let erstesWort = false;
    const gespeichert = await schreiben((lauf) => {
      erstesWort = Boolean(user) && countUserTurns(lauf.turns) === 0;
      if (user) lauf.turns.push({ role: "user", text: user, ts });
      if (persona) lauf.turns.push({ role: "persona", text: persona, ts });
      // C13: Wer spricht, pausiert nicht. Eine offen gebliebene Pause (Seite verlassen, Textweg) endet mit dem eigenen Zug.
      if (user && !pausiert) pauseSetzen(lauf, false, jetzt);
      // S22: Die Kennzahlen gehen mit jedem Zug mit. Beim Auflegen kommt das Speichern oft zu spät, weil die
      // Auswertung den Lauf dann schon übernommen hat.
      if (stats) lauf.liveStats = stats;
      if (zeitUm) lauf.closedByTime = true;
      if (ende && !lauf.closedByPersona) lauf.closedByPersona = { ...ende, at: ts };
    });
    if (!gespeichert) return; // Lauf nicht mehr aktiv: nichts geschrieben, die Sitzung endet (bye ist raus)
    // C15: Ein Zug ist angekommen, die Verbindung zur KI trägt. Der Zähler der Wiederaufnahmen beginnt neu.
    reconnects = 0;
    // S24: Zählpunkt „erstes Wort“ (Sprechweg), ohne Nutzertext.
    if (erstesWort) deps.zaehlpunkt?.("erstes_wort", { scenarioId: doc.scenarioId, weg: "sprechen" });
    sendJson({
      t: "turn",
      user: user || null,
      persona: persona || null,
      userTurnsLeft: Math.max(0, SIM_MAX_USER_TURNS - countUserTurns(doc.turns)),
      timeUp: doc.closedByTime === true,
      ended: Boolean(doc.closedByPersona),
    });
    tonSeitMeldungBytes = 0;
    log("info", "live-turn", { turns: doc.turns.length, ...(doc.closedByTime ? { timeUp: true } : {}), ...(doc.closedByPersona ? { ended: doc.closedByPersona.ergebnis } : {}) });
    if (doc.closedByPersona) {
      sendJson({ t: "ended", grund: doc.closedByPersona.grund, ergebnis: doc.closedByPersona.ergebnis });
      return bye("ended_by_persona");
    }
    if (doc.closedByTime) return bye("time_up");
    if (closing) return;
    // A4: nach jedem Zug — wie die Turn-Route vor jedem Zug.
    if (await kiPruefen()) return;

    const budget = await deps.budget({ uid: ticket.uid, email: ticket.email, estimatedTokens: estimateTokens(user, persona) });
    if (!budget.allowed) return bye("budget");
    if (countUserTurns(doc.turns) >= SIM_MAX_USER_TURNS) return bye("turn_limit");

    const signal = zeitSignal();
    if (signal === "closing") {
      if (!(await zeitHinweisMerken())) return;
      sendStageNote("closing");
    } else if (signal === "farewell" && !farewellPending) {
      sendStageNote("farewell");
    }
    // C14: nicht warten — der nächste Zug wird gespeichert und gemeldet, auch wenn der Beobachter noch rechnet.
    if (user) beobachten();
  };
  const enqueueFinalize = () => {
    // Paket 4: Der Zug wird im Augenblick seines Abschlusses festgehalten. Was danach mitgeschrieben wird (nach einer
    // Unterbrechung spricht die Person schon weiter, während das Relais auf `heard` wartet), gehört zum nächsten Zug.
    const zug: OffenerZug = { user: pendingUser, persona: pendingPersona, kuerzung };
    pendingUser = "";
    pendingPersona = "";
    kuerzung = null;
    antwortAbgebrochen = false;
    audioSeenThisTurn = false;
    antwortNeu();
    queue = queue.then(() => finalizeTurn(zug)).catch((e) => log("error", "live-finalize", { err: e instanceof Error ? e.message : String(e) }));
  };

  /** Letzte Regie-Notiz noch einmal an die Rolle (Wiedereinstieg, Neuaufsatz ohne Marke). */
  const regieNotizNachreichen = () => {
    const letzte = doc.regie?.length ? doc.regie[doc.regie.length - 1] : null;
    if (letzte?.notiz && upstream && !closing) upstream.sendText(regieStageNote(scenario, letzte), false);
  };

  /**
   * C15: Abriss zur KI. Mit Wiederaufnahme-Marke geht das Gespräch dort weiter; ohne Marke (oder wenn sie nicht mehr
   * gilt) setzt das Relais mit dem Verlauf neu auf, statt mit allgemeinem Fehler zu enden. Der Browser erfährt beides.
   */
  const neuVerbinden = (reason: string) => {
    if (reconnects >= MAX_WIEDERAUFNAHMEN) {
      log("warn", "live-upstream-closed", { reason, reconnects });
      return bye("upstream");
    }
    reconnects += 1;
    log("warn", "live-upstream-reconnect", { reason, reconnects, marke: Boolean(resumeHandle) });
    sendJson({ t: "reconnecting" });
    void (async () => {
      let frisch: boolean;
      try {
        frisch = await verbinde();
      } catch (e) {
        if (!resumeHandle || closing) throw e;
        log("warn", "live-upstream-marke-verworfen", { err: e instanceof Error ? e.message : String(e) });
        resumeHandle = undefined;
        frisch = await verbinde();
      }
      if (closing || !upstream) return;
      sendJson({ t: "reconnected" });
      if (frisch) regieNotizNachreichen();
    })().catch((e) => {
      log("error", "live-upstream-reconnect-failed", { err: e instanceof Error ? e.message : String(e) });
      bye("upstream");
    });
  };

  /**
   * C15: Das Modell hat das Ende der Verbindung angekündigt. Sobald eine frische Marke vorliegt (seitdem ist nichts
   * gesprochen worden), verbindet das Relais vorab neu und löst die alte Verbindung ab, ohne Lücke für die Person.
   * Mitten in einer Antwort wartet es auf die nächste Marke; kommt der Abriss vorher, greift `neuVerbinden`.
   */
  const vorabVersuchen = () => {
    if (!goAwayOffen || !markeFrisch || vorabLaeuft || closing || !resumeHandle) return;
    goAwayOffen = false;
    vorabLaeuft = true;
    log("info", "live-upstream-vorab");
    void verbinde()
      .then(() => {
        vorabLaeuft = false;
      })
      .catch((e) => {
        vorabLaeuft = false;
        log("warn", "live-upstream-vorab-failed", { err: e instanceof Error ? e.message : String(e) });
        // Die alte Verbindung ist inzwischen weg: der gewöhnliche Weg.
        if (!upstream && !closing) neuVerbinden("vorab-gescheitert");
      });
  };

  const events: UpstreamEvents = {
    onAudio: (pcm) => {
      markeFrisch = false;
      if (personaEnde && !doc.closedByPersona) endeTimerNeu();
      if (!audioSeenThisTurn && lastInputAt) {
        audioSeenThisTurn = true;
        const ms = deps.now() - lastInputAt;
        // S22: Gemessen wird nur am ersten Ton einer Antwort. Läuft die Mitschrift der Person dem Ton nach, entstünde
        // sonst mitten in der Antwort ein Messwert nahe null.
        if (ms >= 0 && ms < 60_000 && antwortErsterTonAt == null) latencies.push(ms);
        lastInputAt = 0;
      }
      if (ws.readyState !== WS_OPEN) return;
      // C36 (Rest): Staut sich der Ton zum Browser (langsame Leitung), wird er verworfen statt gepuffert.
      if ((ws.bufferedAmount ?? 0) > RUECKSTAU_MAX_BYTES) {
        if (!verworfenBytes) log("warn", "live-rueckstau", { gestautBytes: ws.bufferedAmount });
        verworfenBytes += pcm.length;
        return;
      }
      ws.send(pcm);
      // S31: gezählt wird nur Ton, der wirklich an den Browser ging.
      if (antwortErsterTonAt == null) antwortErsterTonAt = deps.now();
      antwortTonBytes += pcm.length;
      tonSeitMeldungBytes += pcm.length;
    },
    onInputText: (text) => {
      markeFrisch = false;
      // Die Person spricht: Eröffnung und abgebrochene Antwort sind vorbei (Sicherheitsnetz, falls das Modell den
      // Abschluss des Zugs nicht meldet).
      eroeffnungLaeuft = false;
      antwortAbgebrochen = false;
      pendingUser += text;
      lastInputAt = deps.now();
      audioSeenThisTurn = false;
      sendJson({ t: "you", text: pendingUser });
      denkNeu();
    },
    onOutputText: (text) => {
      markeFrisch = false;
      // S1: Der gesprochene Eröffnungssatz steht schon im Verlauf. S31: Nachzügler einer abgebrochenen Antwort zählen nicht.
      if (eroeffnungLaeuft || antwortAbgebrochen) return;
      pendingPersona += text;
      antwortMarken.push({ ms: tonMs(antwortTonBytes), zeichen: pendingPersona.length });
      if (personaEnde && !doc.closedByPersona) endeTimerNeu();
      sendJson({ t: "persona", text: pendingPersona });
    },
    onInterrupted: () => {
      sendJson({ t: "interrupted" });
      // Ton, den der Browser in sein `heard` einrechnet, der aber vor dieser Antwort lag (z. B. die Eröffnung).
      const vorlaufMs = tonMs(tonSeitMeldungBytes - antwortTonBytes);
      tonSeitMeldungBytes = 0;
      unterbrechungen += 1;
      antwortAbgebrochen = true;
      if (eroeffnungLaeuft) {
        eroeffnungLaeuft = false; // der Eröffnungssatz bleibt ganz im Verlauf, er stand schon als Text da
        return;
      }
      // S31: Nur Gehörtes in den Verlauf. Der Browser meldet mit `heard`, wie viel wirklich gespielt wurde; ohne
      // Meldung (alter Client) zählt die Zeit seit dem ersten Ton dieser Antwort.
      const text = pendingPersona;
      if (!text.trim() || kuerzung) return;
      const marken = antwortMarken;
      const tonGesamt = tonMs(antwortTonBytes);
      const geschaetzt = schaetzeGehoertMs({ ersterTonAt: antwortErsterTonAt, jetzt: deps.now(), tonMsGesamt: tonGesamt });
      const vomBrowser = new Promise<number | null>((resolve) => {
        const melden = (ms: number | null) => {
          clearTimeout(frist);
          if (gehoertMelden === melden) gehoertMelden = null;
          resolve(ms);
        };
        const frist = setTimeout(() => melden(null), deps.gehoertWarteMs ?? GEHOERT_WARTE_MS);
        gehoertMelden?.(null); // eine ältere Kürzung, die noch wartet, gilt mit ihrer Schätzung
        gehoertMelden = melden;
      });
      const kuerzen: Promise<string> = vomBrowser.then((ms) => {
        const gehoert = ms == null ? geschaetzt : Math.max(0, ms - vorlaufMs);
        const r = kuerzeAufGehoertes(text, marken, Math.min(gehoert, tonGesamt));
        gekuerztZeichen += r.gekuerzt;
        if (kuerzung === kuerzen) {
          // Der Zug ist noch offen: die gekürzte Mitschrift gilt weiter.
          kuerzung = null;
          pendingPersona = r.text;
          antwortNeu();
        }
        if (r.gekuerzt) {
          log("info", "live-gekuerzt", { zeichen: r.gekuerzt, vomBrowser: ms != null });
          sendJson({ t: "persona", text: r.text });
        }
        return r.text;
      });
      kuerzung = kuerzen;
    },
    onTurnComplete: () => {
      eroeffnungLaeuft = false;
      enqueueFinalize();
    },
    onToolCall: (calls) => {
      for (const call of calls) {
        const ende = parseEndeCall(call);
        const antworten = (response: Record<string, unknown>) => {
          try {
            upstream?.sendToolResponse?.([{ id: call.id, name: call.name, response }]);
          } catch (e) {
            log("warn", "live-tool-response", { err: e instanceof Error ? e.message : String(e) });
          }
        };
        if (!ende) {
          antworten({ ok: false, error: "unknown tool" });
          continue;
        }
        // Torwächter (01.11.2026): Das Ende gilt erst, wenn die Endbedingung wirklich erfüllt ist. Sonst bekommt die
        // Rolle die Werkzeug-Antwort „noch nicht“ plus eine Regie-Notiz, was fehlt — das Gespräch läuft weiter.
        void (async () => {
          const ts = new Date(deps.now()).toISOString();
          const turnsJetzt: SimulationTurn[] = [
            ...doc.turns,
            ...(pendingUser.trim() ? [{ role: "user" as const, text: pendingUser.trim(), ts }] : []),
            ...(pendingPersona.trim() ? [{ role: "persona" as const, text: pendingPersona.trim(), ts }] : []),
          ];
          // Paket 2, C7 (12.11.2026): Fällt der Torwächter aus, gilt das Ende weiter (fail-open), aber es steht im
          // Protokoll, ohne Nutzertext. Fehler sieht das Relais direkt; die Frist erkennt es an der Dauer (nach
          // ihrem Ablauf gibt die Prüfung ungeprüft frei).
          let pruefung = { erfuellt: true, fehlt: "" };
          if (deps.endePruefen) {
            const t0 = deps.now();
            let anlass: "fehler" | "frist" | null = null;
            try {
              pruefung = await deps.endePruefen(scenario, turnsJetzt, ende);
            } catch {
              anlass = "fehler";
            }
            const ms = deps.now() - t0;
            if (!anlass && pruefung.erfuellt && ms >= ENDE_PRUEFUNG_TIMEOUT_MS) anlass = "frist";
            if (anlass) log("warn", "live-ende-ungeprueft", { anlass, ergebnis: ende.ergebnis, ms });
          }
          if (closing) return;
          if (!pruefung.erfuellt) {
            const notiz = endeAbgelehntNote(scenario, pruefung.fehlt);
            antworten({ ok: false, hinweis: notiz });
            const letzte = doc.regie?.[doc.regie.length - 1];
            const stand: RegieStand = { stufe: letzte?.stufe ?? 0, erfuellt: letzte?.erfuellt ?? [], eskaliert: false, notiz, turn: turnsJetzt.length, ts, delivered: true, fehlt: pruefung.fehlt };
            // C3: nur diese Notiz an den gespeicherten Lauf hängen (vorher ging sie mit der ganzen Kopie mit).
            void schreiben((lauf) => {
              lauf.regie = [...(lauf.regie ?? []).slice(-40), stand];
            }).catch((e) => log("error", "live-ende-notiz-speichern", { err: e instanceof Error ? e.message : String(e) }));
            try {
              upstream?.sendText(regieStageNote(scenario, stand), false);
            } catch (e) {
              log("warn", "live-ende-notiz", { err: e instanceof Error ? e.message : String(e) });
            }
            log("info", "live-ende-abgelehnt", { ergebnis: ende.ergebnis, fehlt: pruefung.fehlt.slice(0, 120) });
            return;
          }
          antworten({ ok: true });
          personaEnde = ende;
          log("info", "live-ende-werkzeug", { ergebnis: ende.ergebnis });
          // Die Rolle spricht jetzt ihren Abschied; geschlossen wird nach turnComplete oder nach kurzer Stille.
          endeTimerNeu();
        })();
      }
    },
    onResumptionHandle: (h) => {
      resumeHandle = h;
      markeFrisch = true;
      vorabVersuchen();
    },
    onGoAway: () => {
      log("info", "live-goaway");
      goAwayOffen = true;
      vorabVersuchen();
    },
    onClose: (reason) => {
      if (closing || ws.readyState !== WS_OPEN) return;
      // Abriss der Google-Seite (z. B. Sitzungsgrenze). Bis die neue Verbindung steht, geht kein Ton an die alte.
      upstream = null;
      aktiv = null;
      // Läuft der vorsorgliche Wechsel schon, übernimmt gleich die neue Verbindung.
      if (vorabLaeuft) return log("info", "live-upstream-closed-im-wechsel", { reason });
      neuVerbinden(reason);
    },
    onError: (err) => {
      log("error", "live-upstream-error", { err: err instanceof Error ? err.message : String(err) });
      if (!closing) bye("upstream");
    },
  };

  /** C15: Ereignisse nur von der Verbindung durchlassen, die trägt oder gerade aufgebaut wird (Abriss und Fehler: nur von der tragenden). */
  const nurVon = (kennung: object): UpstreamEvents => {
    const gilt = () => kennung === aktiv || kennung === imAufbau;
    return {
      onAudio: (pcm) => {
        if (gilt()) events.onAudio(pcm);
      },
      onInputText: (text) => {
        if (gilt()) events.onInputText(text);
      },
      onOutputText: (text) => {
        if (gilt()) events.onOutputText(text);
      },
      onInterrupted: () => {
        if (gilt()) events.onInterrupted();
      },
      onTurnComplete: () => {
        if (gilt()) events.onTurnComplete();
      },
      onToolCall: (calls) => {
        if (gilt()) events.onToolCall(calls);
      },
      onResumptionHandle: (h) => {
        if (gilt()) events.onResumptionHandle(h);
      },
      onGoAway: () => {
        if (gilt()) events.onGoAway();
      },
      onClose: (reason) => {
        if (kennung === aktiv) events.onClose(reason);
      },
      onError: (err) => {
        if (kennung === aktiv) events.onError(err);
      },
    };
  };

  /**
   * Verbindet zur KI: beim Start, nach einem Abriss oder vorab nach der Vorwarnung. Mit Wiederaufnahme-Marke kennt die
   * neue Verbindung das Gespräch schon; ohne Marke wird der Verlauf eingespielt (`verlauf`, sonst alle Züge samt dem
   * gerade Mitgeschriebenen). Eine bisherige Verbindung wird erst geschlossen, wenn die neue steht.
   * Rückgabe: true = ohne Marke frisch aufgesetzt.
   */
  const verbinde = async (verlauf?: SimulationTurn[]): Promise<boolean> => {
    const marke = resumeHandle;
    const cfg: UpstreamConfig = {
      model: deps.model,
      voice,
      languageCode,
      systemInstruction,
      resumeHandle: marke,
      endeWerkzeug,
      sprechpause: deps.sprechpause ?? "normal",
    };
    const kennung = {};
    imAufbau = kennung;
    let up: Upstream;
    try {
      up = await deps.connect(cfg, nurVon(kennung));
    } finally {
      if (imAufbau === kennung) imAufbau = null;
    }
    // C36: Während des Verbindens beendet → die frische Verbindung zum Live-Modell gleich wieder schließen.
    if (closing) {
      try {
        up.close();
      } catch {
        /* egal */
      }
      return !marke;
    }
    const alt = upstream;
    upstream = up;
    aktiv = kennung;
    markeFrisch = false;
    try {
      alt?.close();
    } catch {
      /* egal */
    }
    if (marke) return false;
    // Ohne Marke: Verlauf einspielen. Nach einem Abriss gehört das gerade Mitgeschriebene dazu.
    const ts = new Date(deps.now()).toISOString();
    const turns = verlauf ?? [
      ...doc.turns,
      ...(pendingUser.trim() ? [{ role: "user" as const, text: pendingUser.trim(), ts }] : []),
      ...(pendingPersona.trim() ? [{ role: "persona" as const, text: pendingPersona.trim(), ts }] : []),
    ];
    if (turns.length) up.sendHistory(toHistory(turns));
    return true;
  };

  // ── Browser-Socket ────────────────────────────────────────────────────────
  ws.on("message", (data, isBinary) => {
    if (closing) return;
    if (isBinary) {
      if (pausiert) return; // Coach-Pause: kein Mikrofon-Audio an die KI, die Stille-Uhr steht
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
    else if (msg?.t === "pause") pauseBeginn();
    else if (msg?.t === "resume") pauseEnde("resume");
    else if (msg?.t === "heard") gehoertMelden?.(gehoertVomBrowser(msg.ms));
  });
  // Ende der Sitzung, genau einmal: ob der Browser auflegt oder eine neuere Verbindung übernimmt (C36).
  let abschlussLauf: Promise<void> | null = null;
  abschluss = () => {
    if (abschlussLauf) return abschlussLauf;
    closing = true;
    stopIdle();
    if (kiTimer) clearInterval(kiTimer);
    if (pauseTimer) clearTimeout(pauseTimer);
    if (denkTimer) clearTimeout(denkTimer);
    for (const t of timers) clearTimeout(t);
    // S31: Wartet eine Kürzung noch auf den Browser, gilt jetzt die Schätzung (sonst hinge die Warteschlange).
    gehoertMelden?.(null);
    try {
      upstream?.close();
    } catch {
      /* egal */
    }
    // Angefangenes nicht verlieren: was schon mitgeschrieben ist, wird noch gespeichert — und die Antwortzeiten.
    // Seit C14 steht der Beobachter nicht mehr in der Warteschlange, das Speichern wartet also nicht auf ihn.
    abschlussLauf = queue
      .then(async () => {
        const user = pendingUser.trim();
        const persona = (kuerzung ? await kuerzung : pendingPersona).trim();
        pendingUser = "";
        pendingPersona = "";
        const ts = new Date(deps.now()).toISOString();
        const sitzung = latencyStats(latencies);
        if (sitzung || unterbrechungen || verworfenBytes) {
          log("info", "live-latency", { ...sitzung, unterbrechungen, gekuerztZeichen, ...(verworfenBytes ? { verworfenBytes } : {}) });
        }
        const stats = sitzung || unterbrechungen ? kennzahlen() : null;
        let erstesWort = false;
        if (user || persona || stats || offen.length) {
          const gespeichert = await schreiben((lauf) => {
            erstesWort = Boolean(user) && countUserTurns(lauf.turns) === 0;
            if (user) lauf.turns.push({ role: "user", text: user, ts });
            if (persona) lauf.turns.push({ role: "persona", text: persona, ts });
            if (stats) lauf.liveStats = stats;
          });
          if (gespeichert && erstesWort) deps.zaehlpunkt?.("erstes_wort", { scenarioId: doc.scenarioId, weg: "sprechen" });
        }
      })
      .catch((e) => log("error", "live-close-save", { err: e instanceof Error ? e.message : String(e) }))
      .then(() => {
        abmelden();
        resolveDone();
      });
    return abschlussLauf;
  };

  // ── Start ─────────────────────────────────────────────────────────────────
  // Paket 4, S1: Hörbar eröffnet die Rolle nur, wenn der Browser es wünscht, der Lauf noch keinen eigenen Beitrag
  // der Person hat und die Zeit nicht schon um ist (dann verabschiedet sie sich).
  const startSignal = zeitSignal();
  const eroeffnungssatz = doc.turns[0]?.role === "persona" ? doc.turns[0].text.trim() : "";
  const eroeffnen =
    opts.eroeffnung === true && Boolean(eroeffnungssatz) && countUserTurns(doc.turns) === 0 && startSignal !== "farewell";
  try {
    // Der Eröffnungssatz wird gleich gesprochen und steht damit im Gespräch der KI; er wird nicht vorab eingespielt.
    await verbinde(eroeffnen ? doc.turns.slice(1) : undefined);
  } catch (e) {
    log("error", "live-upstream-connect", { err: e instanceof Error ? e.message : String(e) });
    fail("UPSTREAM", 4502);
    return done;
  }
  if (closing) return done; // Browser hat während des Verbindens aufgelegt
  resetIdle();
  timers.push(setTimeout(() => bye("ended"), deps.maxConnectionMs ?? 30 * 60_000));
  // A4: Schalter auch zwischen den Zügen — das Mikrofon-Audio fließt, auch wenn kein Zug fertig wird.
  if (deps.kiAusMeldung) {
    kiTimer = setInterval(() => {
      void kiPruefen().catch((e) => log("warn", "live-ki-pruefung", { err: e instanceof Error ? e.message : String(e) }));
    }, deps.kiPruefMs ?? 60_000);
  }
  // Mikrofon-Check (Paket 4): Ein Lauf, der mit „Sprechen“ beginnt, startet mit angehaltener Uhr. Sie läuft ab hier.
  // Nur vor dem ersten eigenen Wort: Eine Coach-Pause mitten im Gespräch übersteht ein Neuverbinden.
  if (doc.pauseSince && !doc.turns.some((x) => x.role === "user")) {
    const jetzt = deps.now();
    await schreiben((lauf) => {
      pauseSetzen(lauf, false, jetzt);
    }).catch((e) => log("error", "live-pause-speichern", { err: e instanceof Error ? e.message : String(e) }));
  }
  sendJson({
    t: "ready",
    persona: scenario.persona.name,
    voice,
    // C13: Die Uhr des Browsers rechnet mit denselben Feldern wie der Server (gespraechsZeitMs).
    pausedMs: doc.pausedMs ?? 0,
    pauseSince: doc.pauseSince ?? null,
    eroeffnung: eroeffnen,
  });
  log("info", "live-ready", { scenarioId: scenario.id, voice, turns: doc.turns.length, endeWerkzeug, eroeffnung: eroeffnen });

  // S1: Die Rolle spricht ihren gespeicherten Eröffnungssatz wörtlich. Was sie dabei sagt, wird weder noch einmal
  // gespeichert noch als Zug gemeldet (`eroeffnungLaeuft` gilt bis zum Abschluss dieses Zugs).
  if (eroeffnen && upstream) {
    eroeffnungLaeuft = true;
    (upstream as Upstream).sendText(eroeffnungsNote(scenario.locale, eroeffnungssatz), true);
  }

  // Wer spät wieder einsteigt, bekommt die Zeit-Regie sofort — und die letzte Regie-Notiz noch einmal.
  if (startSignal === "farewell") sendStageNote("farewell");
  else if (startSignal === "closing") {
    if (await zeitHinweisMerken()) sendStageNote("closing");
  }
  regieNotizNachreichen();
  return done;
}
