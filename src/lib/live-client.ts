import { withBasePath } from "@/lib/base-path";

/**
 * Browser-Seite der Live-Verbindung (Sprachmodus Live, N4-231).
 * Text-Frames sind JSON (Protokoll in src/lib/server/live/live-session.ts), Binär-Frames Audio:
 * hin PCM 16 kHz, zurück PCM 24 kHz.
 *
 * Paket 4 (12.11.2026, WELLE3-SPRECHEN.md): Die Nachrichten des Relais werden in `parseLiveMessage` geprüft und in
 * `dispatchLiveMessage` verteilt (beides ohne Socket testbar). Neu, alles rückwärtsverträglich: `hello` mit
 * `eroeffnung`, `pause`/`resume`, `heard` zum Relais; `thinking`, `reconnecting`, `reconnected` und ein `ready` mit
 * `pausedMs` und `eroeffnung` vom Relais.
 */
export interface LiveTurn {
  user: string | null;
  persona: string | null;
  userTurnsLeft: number;
  timeUp: boolean;
  /** Welle 2: die Rolle hat das Gespräch mit diesem Zug beendet. */
  ended: boolean;
}

export interface LiveReady {
  persona: string;
  voice: string;
  /** Summe der abgeschlossenen Coach-Pausen des Laufs (C13); fehlt bei einem älteren Relais. */
  pausedMs?: number;
  /** Beginn einer noch laufenden Coach-Pause (ISO-Zeit); null = keine. Fehlt bei einem älteren Relais. */
  pauseSince?: string | null;
  /** Die Rolle eröffnet gleich hörbar (S1). */
  eroeffnung: boolean;
}

/** Eine geprüfte Nachricht des Relais. */
export type LiveServerMessage =
  | ({ t: "ready" } & LiveReady)
  | { t: "you"; text: string }
  | { t: "persona"; text: string }
  | { t: "interrupted" }
  | { t: "thinking" }
  | { t: "reconnecting" }
  | { t: "reconnected" }
  | ({ t: "turn" } & LiveTurn)
  | { t: "ended"; grund: string; ergebnis: string }
  | { t: "idle_warn"; seconds: number }
  | { t: "error"; code: string; message?: string }
  | { t: "bye"; reason: string };

export interface LiveEvents {
  onReady(p: LiveReady): void;
  onYou(text: string): void;
  onPersona(text: string): void;
  onInterrupted(): void;
  /** Paket 4, S4: Die Person ist fertig, die Antwort entsteht („denkt nach“ bis zum ersten Ton). */
  onThinking?(): void;
  /** Paket 4, C15: Das Relais verbindet sich neu zur KI; das Mikrofon bleibt an. */
  onReconnecting?(): void;
  onReconnected?(): void;
  onAudio(pcm24k: ArrayBuffer): void;
  onTurn(turn: LiveTurn): void;
  /** `message`: Meldung für die Person, wenn der Server eine mitschickt (A4: KI_AUS). */
  onError(code: string, message?: string): void;
  onBye(reason: string): void;
  /** Welle 2: die Rolle hat das Gespräch beendet (Grund in der Autorensprache). */
  onEnded?(p: { grund: string; ergebnis: string }): void;
  /** Welle 2: Vorwarnung vor dem Stille-Abbruch. */
  onIdleWarn?(seconds: number): void;
  /**
   * Immer zuletzt, genau einmal. `wsCode`: Schließ-Code des Sockets (Paket 1, C10, 12.11.2026) —
   * 4401 = Karte abgelaufen, 1011 = Sitzung gescheitert, 1006 = Abriss; der Client entscheidet damit über den Satz.
   */
  onClose(wsCode: number): void;
}

export interface LiveConnection {
  sendAudio(pcm16k: ArrayBuffer): void;
  /** Coach-Pause (C13): Das Relais gibt kein Mikrofon-Audio weiter und hält Stille-Uhr und Zeit-Regie an. */
  pause(): void;
  resume(): void;
  /** Direkt nach einer Unterbrechung: so viele Millisekunden der laufenden Antwort wurden wirklich abgespielt (S31). */
  heard(ms: number): void;
  /** Mikro aus: dem Server das Ende melden; der Socket schließt danach. */
  end(): void;
  close(): void;
}

export function liveSocketUrl(path: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${withBasePath(path)}`;
}

/** Der erste Frame: die Karte, auf Wunsch mit der Bitte, dass die Rolle hörbar eröffnet. */
export function helloFrame(ticket: string, eroeffnung?: boolean): string {
  return JSON.stringify(eroeffnung ? { t: "hello", ticket, eroeffnung: true } : { t: "hello", ticket });
}

/** Text-Frame des Relais lesen. null = kein JSON oder eine Nachricht, die dieser Client nicht kennt. */
export function parseLiveMessage(raw: string): LiveServerMessage | null {
  let m: { t?: unknown; [k: string]: unknown };
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== "object") return null;
  switch (m.t) {
    case "ready": {
      const pausedMs = typeof m.pausedMs === "number" && Number.isFinite(m.pausedMs) && m.pausedMs >= 0 ? m.pausedMs : undefined;
      // Die Pausenfelder gehören zusammen: Nur mit einer lesbaren Summe zählt auch der Beginn der laufenden Pause.
      const pauseSince = typeof m.pauseSince === "string" && m.pauseSince ? m.pauseSince : null;
      return {
        t: "ready",
        persona: String(m.persona ?? ""),
        voice: String(m.voice ?? ""),
        ...(pausedMs !== undefined ? { pausedMs, pauseSince } : {}),
        eroeffnung: m.eroeffnung === true,
      };
    }
    case "you":
      return { t: "you", text: String(m.text ?? "") };
    case "persona":
      return { t: "persona", text: String(m.text ?? "") };
    case "interrupted":
    case "thinking":
    case "reconnecting":
    case "reconnected":
      return { t: m.t };
    case "turn":
      return {
        t: "turn",
        user: typeof m.user === "string" ? m.user : null,
        persona: typeof m.persona === "string" ? m.persona : null,
        userTurnsLeft: Number(m.userTurnsLeft ?? 0),
        timeUp: m.timeUp === true,
        ended: m.ended === true,
      };
    case "ended":
      return { t: "ended", grund: String(m.grund ?? ""), ergebnis: String(m.ergebnis ?? "") };
    case "idle_warn":
      return { t: "idle_warn", seconds: Number(m.seconds ?? 60) };
    case "error":
      return { t: "error", code: String(m.code ?? "UNKNOWN"), ...(typeof m.message === "string" ? { message: m.message } : {}) };
    case "bye":
      return { t: "bye", reason: String(m.reason ?? "ended") };
    default:
      return null;
  }
}

/** Eine geprüfte Nachricht an den passenden Hörer geben. */
export function dispatchLiveMessage(m: LiveServerMessage, ev: Omit<LiveEvents, "onAudio" | "onClose">): void {
  switch (m.t) {
    case "ready":
      ev.onReady({
        persona: m.persona,
        voice: m.voice,
        ...(m.pausedMs !== undefined ? { pausedMs: m.pausedMs, pauseSince: m.pauseSince ?? null } : {}),
        eroeffnung: m.eroeffnung,
      });
      break;
    case "you":
      ev.onYou(m.text);
      break;
    case "persona":
      ev.onPersona(m.text);
      break;
    case "interrupted":
      ev.onInterrupted();
      break;
    case "thinking":
      ev.onThinking?.();
      break;
    case "reconnecting":
      ev.onReconnecting?.();
      break;
    case "reconnected":
      ev.onReconnected?.();
      break;
    case "turn":
      ev.onTurn({ user: m.user, persona: m.persona, userTurnsLeft: m.userTurnsLeft, timeUp: m.timeUp, ended: m.ended });
      break;
    case "ended":
      ev.onEnded?.({ grund: m.grund, ergebnis: m.ergebnis });
      break;
    case "idle_warn":
      ev.onIdleWarn?.(m.seconds);
      break;
    case "error":
      ev.onError(m.code, m.message);
      break;
    case "bye":
      ev.onBye(m.reason);
      break;
  }
}

export function openLiveConnection(path: string, ticket: string, ev: LiveEvents, opts?: { eroeffnung?: boolean }): LiveConnection {
  const ws = new WebSocket(liveSocketUrl(path));
  ws.binaryType = "arraybuffer";
  let closed = false;
  const finish = (wsCode: number) => {
    if (closed) return;
    closed = true;
    ev.onClose(wsCode);
  };
  const sendJson = (m: Record<string, unknown>) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(m));
    } catch {
      /* der Socket schließt gerade */
    }
  };
  ws.onopen = () => ws.send(helloFrame(ticket, opts?.eroeffnung));
  ws.onmessage = (e: MessageEvent) => {
    if (e.data instanceof ArrayBuffer) {
      ev.onAudio(e.data);
      return;
    }
    const m = parseLiveMessage(String(e.data));
    if (m) dispatchLiveMessage(m, ev);
  };
  ws.onerror = () => {
    /* der folgende close trägt das Ende */
  };
  ws.onclose = (e: CloseEvent) => finish(e.code);
  return {
    sendAudio: (pcm) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(pcm);
    },
    pause: () => sendJson({ t: "pause" }),
    resume: () => sendJson({ t: "resume" }),
    heard: (ms) => sendJson({ t: "heard", ms: Math.max(0, Math.round(ms)) }),
    end: () => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ t: "end" }));
        } catch {
          /* egal */
        }
      }
      ws.close();
    },
    close: () => ws.close(),
  };
}
