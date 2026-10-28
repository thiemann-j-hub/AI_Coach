import { withBasePath } from "@/lib/base-path";

/**
 * Browser-Seite der Live-Verbindung (Sprachmodus Live, N4-231).
 * Text-Frames sind JSON (Protokoll in src/lib/server/live/live-session.ts), Binär-Frames Audio:
 * hin PCM 16 kHz, zurück PCM 24 kHz.
 */
export interface LiveTurn {
  user: string | null;
  persona: string | null;
  userTurnsLeft: number;
  timeUp: boolean;
}

export interface LiveEvents {
  onReady(p: { persona: string; voice: string }): void;
  onYou(text: string): void;
  onPersona(text: string): void;
  onInterrupted(): void;
  onAudio(pcm24k: ArrayBuffer): void;
  onTurn(turn: LiveTurn): void;
  onError(code: string): void;
  onBye(reason: string): void;
  /** Immer zuletzt, genau einmal. */
  onClose(): void;
}

export interface LiveConnection {
  sendAudio(pcm16k: ArrayBuffer): void;
  /** Mikro aus: dem Server das Ende melden; der Socket schließt danach. */
  end(): void;
  close(): void;
}

export function liveSocketUrl(path: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${withBasePath(path)}`;
}

export function openLiveConnection(path: string, ticket: string, ev: LiveEvents): LiveConnection {
  const ws = new WebSocket(liveSocketUrl(path));
  ws.binaryType = "arraybuffer";
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    ev.onClose();
  };
  ws.onopen = () => ws.send(JSON.stringify({ t: "hello", ticket }));
  ws.onmessage = (e: MessageEvent) => {
    if (e.data instanceof ArrayBuffer) {
      ev.onAudio(e.data);
      return;
    }
    let m: { t?: string; [k: string]: unknown };
    try {
      m = JSON.parse(String(e.data));
    } catch {
      return;
    }
    switch (m.t) {
      case "ready":
        ev.onReady({ persona: String(m.persona ?? ""), voice: String(m.voice ?? "") });
        break;
      case "you":
        ev.onYou(String(m.text ?? ""));
        break;
      case "persona":
        ev.onPersona(String(m.text ?? ""));
        break;
      case "interrupted":
        ev.onInterrupted();
        break;
      case "turn":
        ev.onTurn({
          user: typeof m.user === "string" ? m.user : null,
          persona: typeof m.persona === "string" ? m.persona : null,
          userTurnsLeft: Number(m.userTurnsLeft ?? 0),
          timeUp: m.timeUp === true,
        });
        break;
      case "error":
        ev.onError(String(m.code ?? "UNKNOWN"));
        break;
      case "bye":
        ev.onBye(String(m.reason ?? "ended"));
        break;
    }
  };
  ws.onerror = () => {
    /* der folgende close trägt das Ende */
  };
  ws.onclose = () => finish();
  return {
    sendAudio: (pcm) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(pcm);
    },
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
