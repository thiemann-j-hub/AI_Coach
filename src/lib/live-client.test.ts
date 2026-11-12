import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchLiveMessage, helloFrame, openLiveConnection, parseLiveMessage, type LiveEvents } from './live-client';

/**
 * Paket 4 (12.11.2026, WELLE3-SPRECHEN.md): Protokoll Browser ↔ Relais. Geprüft wird ohne echten Socket: das Lesen
 * der Nachrichten, das Verteilen an die Hörer und die neuen Frames zum Relais (Eröffnung, Pause, Gehörtes).
 */

function hoerer(): LiveEvents & Record<string, ReturnType<typeof vi.fn>> {
  return {
    onReady: vi.fn(),
    onYou: vi.fn(),
    onPersona: vi.fn(),
    onInterrupted: vi.fn(),
    onThinking: vi.fn(),
    onReconnecting: vi.fn(),
    onReconnected: vi.fn(),
    onAudio: vi.fn(),
    onTurn: vi.fn(),
    onError: vi.fn(),
    onBye: vi.fn(),
    onEnded: vi.fn(),
    onIdleWarn: vi.fn(),
    onClose: vi.fn(),
  };
}

describe('helloFrame', () => {
  it('schickt nur die Karte, wenn keine Eröffnung gewünscht ist (alter Stand, rückwärtsverträglich)', () => {
    expect(JSON.parse(helloFrame('k1'))).toEqual({ t: 'hello', ticket: 'k1' });
    expect(JSON.parse(helloFrame('k1', false))).toEqual({ t: 'hello', ticket: 'k1' });
  });

  it('bittet um die hörbare Eröffnung', () => {
    expect(JSON.parse(helloFrame('k1', true))).toEqual({ t: 'hello', ticket: 'k1', eroeffnung: true });
  });
});

describe('parseLiveMessage', () => {
  it('liest `ready` eines älteren Relais (ohne Pausen, ohne Eröffnung)', () => {
    expect(parseLiveMessage('{"t":"ready","persona":"Alex","voice":"Kore"}')).toEqual({
      t: 'ready',
      persona: 'Alex',
      voice: 'Kore',
      eroeffnung: false,
    });
  });

  it('liest `ready` mit Pausenzeit und Eröffnung', () => {
    expect(parseLiveMessage('{"t":"ready","persona":"Alex","voice":"Kore","pausedMs":42000,"pauseSince":null,"eroeffnung":true}')).toEqual({
      t: 'ready',
      persona: 'Alex',
      voice: 'Kore',
      pausedMs: 42000,
      pauseSince: null,
      eroeffnung: true,
    });
  });

  it('liest eine noch laufende Pause aus `ready`', () => {
    const m = parseLiveMessage('{"t":"ready","persona":"A","voice":"K","pausedMs":0,"pauseSince":"2026-11-12T10:04:00.000Z","eroeffnung":false}');
    expect(m).toMatchObject({ pausedMs: 0, pauseSince: '2026-11-12T10:04:00.000Z' });
  });

  it('verwirft eine unbrauchbare Pausenzeit', () => {
    const m = parseLiveMessage('{"t":"ready","persona":"A","voice":"K","pausedMs":"viel"}');
    expect(m).toEqual({ t: 'ready', persona: 'A', voice: 'K', eroeffnung: false });
  });

  it('liest die neuen Zustände', () => {
    expect(parseLiveMessage('{"t":"thinking"}')).toEqual({ t: 'thinking' });
    expect(parseLiveMessage('{"t":"reconnecting"}')).toEqual({ t: 'reconnecting' });
    expect(parseLiveMessage('{"t":"reconnected"}')).toEqual({ t: 'reconnected' });
    expect(parseLiveMessage('{"t":"interrupted"}')).toEqual({ t: 'interrupted' });
  });

  it('liest einen Zug mit fehlenden Feldern', () => {
    expect(parseLiveMessage('{"t":"turn","user":"Hallo","persona":null}')).toEqual({
      t: 'turn',
      user: 'Hallo',
      persona: null,
      userTurnsLeft: 0,
      timeUp: false,
      ended: false,
    });
  });

  it('liest Ende, Vorwarnung, Fehler und Abschied', () => {
    expect(parseLiveMessage('{"t":"ended","grund":"Ziel","ergebnis":"ziel"}')).toEqual({ t: 'ended', grund: 'Ziel', ergebnis: 'ziel' });
    expect(parseLiveMessage('{"t":"idle_warn"}')).toEqual({ t: 'idle_warn', seconds: 60 });
    expect(parseLiveMessage('{"t":"error","code":"KI_AUS","message":"aus"}')).toEqual({ t: 'error', code: 'KI_AUS', message: 'aus' });
    expect(parseLiveMessage('{"t":"error"}')).toEqual({ t: 'error', code: 'UNKNOWN' });
    expect(parseLiveMessage('{"t":"bye"}')).toEqual({ t: 'bye', reason: 'ended' });
  });

  it('gibt null bei Unbekanntem und bei kaputtem JSON', () => {
    expect(parseLiveMessage('{"t":"zukunft"}')).toBeNull();
    expect(parseLiveMessage('kein json')).toBeNull();
    expect(parseLiveMessage('null')).toBeNull();
    expect(parseLiveMessage('"text"')).toBeNull();
  });
});

describe('dispatchLiveMessage', () => {
  it('gibt jede Nachricht an ihren Hörer', () => {
    const ev = hoerer();
    dispatchLiveMessage({ t: 'ready', persona: 'A', voice: 'K', pausedMs: 5, pauseSince: null, eroeffnung: true }, ev);
    dispatchLiveMessage({ t: 'thinking' }, ev);
    dispatchLiveMessage({ t: 'reconnecting' }, ev);
    dispatchLiveMessage({ t: 'reconnected' }, ev);
    dispatchLiveMessage({ t: 'interrupted' }, ev);
    dispatchLiveMessage({ t: 'idle_warn', seconds: 30 }, ev);
    dispatchLiveMessage({ t: 'error', code: 'UPSTREAM' }, ev);
    dispatchLiveMessage({ t: 'bye', reason: 'idle' }, ev);
    expect(ev.onReady).toHaveBeenCalledWith({ persona: 'A', voice: 'K', pausedMs: 5, pauseSince: null, eroeffnung: true });
    expect(ev.onThinking).toHaveBeenCalledTimes(1);
    expect(ev.onReconnecting).toHaveBeenCalledTimes(1);
    expect(ev.onReconnected).toHaveBeenCalledTimes(1);
    expect(ev.onInterrupted).toHaveBeenCalledTimes(1);
    expect(ev.onIdleWarn).toHaveBeenCalledWith(30);
    expect(ev.onError).toHaveBeenCalledWith('UPSTREAM', undefined);
    expect(ev.onBye).toHaveBeenCalledWith('idle');
  });

  it('kommt ohne die wahlfreien Hörer aus', () => {
    const { onThinking: _a, onReconnecting: _b, onReconnected: _c, onEnded: _d, onIdleWarn: _e, ...pflicht } = hoerer();
    expect(() => {
      dispatchLiveMessage({ t: 'thinking' }, pflicht);
      dispatchLiveMessage({ t: 'reconnecting' }, pflicht);
      dispatchLiveMessage({ t: 'reconnected' }, pflicht);
      dispatchLiveMessage({ t: 'ended', grund: '', ergebnis: 'ziel' }, pflicht);
      dispatchLiveMessage({ t: 'idle_warn', seconds: 60 }, pflicht);
    }).not.toThrow();
  });
});

describe('openLiveConnection', () => {
  class FakeSocket {
    static OPEN = 1;
    static last: FakeSocket | null = null;
    readyState = 0;
    binaryType = '';
    sent: unknown[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: ((e: { code: number }) => void) | null = null;
    constructor(public url: string) {
      FakeSocket.last = this;
    }
    send(data: unknown) {
      this.sent.push(data);
    }
    close() {
      this.readyState = 3;
      this.onclose?.({ code: 1000 });
    }
    oeffnen() {
      this.readyState = FakeSocket.OPEN;
      this.onopen?.();
    }
  }

  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('window', { location: { protocol: 'https:', host: 'app.test' } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('meldet sich mit Karte und Eröffnung an und spricht die neuen Frames', () => {
    const ev = hoerer();
    const conn = openLiveConnection('/api/simulation/live/ws', 'karte', ev, { eroeffnung: true });
    const ws = FakeSocket.last!;
    expect(ws.url).toBe('wss://app.test/api/simulation/live/ws');
    // Vor dem Öffnen geht nichts hinaus.
    conn.pause();
    expect(ws.sent).toEqual([]);
    ws.oeffnen();
    conn.pause();
    conn.resume();
    conn.heard(1234.6);
    conn.heard(-5);
    expect(ws.sent.map((s) => JSON.parse(String(s)))).toEqual([
      { t: 'hello', ticket: 'karte', eroeffnung: true },
      { t: 'pause' },
      { t: 'resume' },
      { t: 'heard', ms: 1235 },
      { t: 'heard', ms: 0 },
    ]);
  });

  it('verteilt Text-Frames, reicht Ton durch und meldet das Ende genau einmal', () => {
    const ev = hoerer();
    const conn = openLiveConnection('/api/simulation/live/ws', 'karte', ev);
    const ws = FakeSocket.last!;
    ws.oeffnen();
    expect(JSON.parse(String(ws.sent[0]))).toEqual({ t: 'hello', ticket: 'karte' });
    ws.onmessage?.({ data: '{"t":"thinking"}' });
    ws.onmessage?.({ data: '{"t":"unbekannt"}' });
    const ton = new ArrayBuffer(4);
    ws.onmessage?.({ data: ton });
    expect(ev.onThinking).toHaveBeenCalledTimes(1);
    expect(ev.onAudio).toHaveBeenCalledWith(ton);
    conn.end();
    ws.onclose?.({ code: 1006 });
    expect(ev.onClose).toHaveBeenCalledTimes(1);
    expect(ev.onClose).toHaveBeenCalledWith(1000);
    expect(JSON.parse(String(ws.sent[1]))).toEqual({ t: 'end' });
  });
});
