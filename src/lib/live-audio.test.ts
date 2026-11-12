import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLiveAudio, gespielteMs, liveAudioSupported, waehlbareMikrofone } from './live-audio';

/**
 * Paket 4 (12.11.2026): der Tonweg ohne echtes Mikrofon und ohne echten Lautsprecher. Der AudioContext und
 * `getUserMedia` sind Attrappen; geprüft wird, was die Sprechansicht braucht: ein Mikrofon-Strom für Check UND
 * Gespräch (S2), stumm ohne Auflegen (S6), Pause (C13), „spricht“ (S4) und die gespielten Millisekunden (S31).
 */

describe('gespielteMs (S31)', () => {
  const stuecke = [
    { start: 1.0, dauer: 0.5 },
    { start: 1.5, dauer: 0.5 },
    // Lücke von 0,3 s (der Ton kam zu spät nach): Sie zählt nicht als gespielt.
    { start: 2.3, dauer: 0.4 },
  ];

  it('zählt nichts, bevor der erste Ton beginnt', () => {
    expect(gespielteMs(stuecke, 0.9)).toBe(0);
    expect(gespielteMs([], 5)).toBe(0);
  });

  it('zählt das laufende Stück anteilig', () => {
    expect(gespielteMs(stuecke, 1.25)).toBe(250);
    expect(gespielteMs(stuecke, 1.75)).toBe(750);
  });

  it('zählt Lücken nicht mit', () => {
    expect(gespielteMs(stuecke, 2.2)).toBe(1000);
    expect(gespielteMs(stuecke, 2.5)).toBe(1200);
  });

  it('endet bei der Gesamtdauer', () => {
    expect(gespielteMs(stuecke, 99)).toBe(1400);
  });
});

describe('waehlbareMikrofone (S2, Gerätewahl)', () => {
  const g = (kind: string, deviceId: string, label = '') => ({ kind, deviceId, label });

  it('nennt nur Mikrofone', () => {
    expect(waehlbareMikrofone([g('audiooutput', 'box'), g('audioinput', 'a', 'Headset'), g('videoinput', 'cam')])).toEqual([
      { deviceId: 'a', label: 'Headset' },
    ]);
  });

  it('lässt die Verweise auf das Standardgerät weg, wenn es echte Einträge gibt (ein Mikrofon steht nicht dreimal da)', () => {
    const liste = [g('audioinput', 'default', 'Standard – Headset'), g('audioinput', 'communications', 'Kommunikation – Headset'), g('audioinput', 'a', 'Headset')];
    expect(waehlbareMikrofone(liste)).toEqual([{ deviceId: 'a', label: 'Headset' }]);
  });

  it('behält den Verweis, wenn der Browser sonst nichts nennt, und überspringt Einträge ohne Kennung (vor der Freigabe)', () => {
    expect(waehlbareMikrofone([g('audioinput', 'default', '')])).toEqual([{ deviceId: 'default', label: '' }]);
    expect(waehlbareMikrofone([g('audioinput', '', '')])).toEqual([]);
  });
});

/* ── Attrappen ── */

class FakeNode {
  connected: unknown[] = [];
  connect(ziel: unknown) {
    this.connected.push(ziel);
  }
  disconnect() {
    this.connected = [];
  }
}

class FakeBufferSource extends FakeNode {
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stopped = false;
  start(at: number) {
    this.startedAt = at;
  }
  stop() {
    this.stopped = true;
  }
}

class FakeWorkletNode extends FakeNode {
  static last: FakeWorkletNode | null = null;
  port: { onmessage: ((e: { data: ArrayBuffer }) => void) | null } = { onmessage: null };
  constructor() {
    super();
    FakeWorkletNode.last = this;
  }
}

class FakeContext {
  static last: FakeContext | null = null;
  currentTime = 0;
  sampleRate = 48000;
  state = 'running';
  destination = new FakeNode();
  resumed = 0;
  suspended = 0;
  closedCount = 0;
  sources: FakeBufferSource[] = [];
  gain = { gain: { value: 1 }, node: new FakeNode() };
  audioWorklet = { addModule: vi.fn(async () => {}) };
  analyser = {
    fftSize: 0,
    connected: [] as unknown[],
    disconnect: () => {},
    getByteTimeDomainData: (bytes: Uint8Array) => bytes.fill(160),
  };
  constructor() {
    FakeContext.last = this;
  }
  createGain() {
    const g = Object.assign(new FakeNode(), { gain: this.gain.gain });
    return g;
  }
  createBuffer(_kanaele: number, laenge: number, rate: number) {
    return { duration: laenge / rate, getChannelData: () => new Float32Array(laenge) };
  }
  createBufferSource() {
    const s = new FakeBufferSource();
    this.sources.push(s);
    return s;
  }
  createMediaStreamSource() {
    return new FakeNode();
  }
  createAnalyser() {
    return this.analyser;
  }
  async resume() {
    this.resumed++;
    this.state = 'running';
  }
  async suspend() {
    this.suspended++;
    this.state = 'suspended';
  }
  async close() {
    this.closedCount++;
  }
}

function fakeStream(deviceId = 'mic-1') {
  const track = { enabled: true, stopped: false, stop: () => void (track.stopped = true), getSettings: () => ({ deviceId }) };
  return { track, stream: { getTracks: () => [track], getAudioTracks: () => [track] } };
}

/** 100 ms Ton der Rolle (PCM 16 Bit, 24 kHz). */
const tonStueck = () => new ArrayBuffer(2 * 2400);

describe('createLiveAudio (Paket 4)', () => {
  let getUserMedia: ReturnType<typeof vi.fn>;
  let streams: ReturnType<typeof fakeStream>[];

  beforeEach(() => {
    streams = [];
    getUserMedia = vi.fn(async (c: { audio: { deviceId?: { exact: string } } }) => {
      const s = fakeStream(c.audio.deviceId?.exact ?? 'mic-1');
      streams.push(s);
      return s.stream;
    });
    vi.stubGlobal('window', { AudioContext: FakeContext });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
    vi.stubGlobal('Blob', class {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('erkennt, ob der Browser Live-Ton kann', () => {
    expect(liveAudioSupported()).toBe(true);
    vi.stubGlobal('navigator', {});
    expect(liveAudioSupported()).toBe(false);
  });

  it('C30: setzt den Kontext im Klick fort, ohne darauf zu warten', () => {
    const audio = createLiveAudio();
    const ctx = FakeContext.last!;
    audio.unlock();
    expect(ctx.resumed).toBe(1);
    // Ein stummer Puffer gibt den Ton auf iOS frei.
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0].startedAt).toBe(0);
  });

  it('S2: der geprüfte Strom geht ins Gespräch — kein zweites Anfragen', async () => {
    const audio = createLiveAudio();
    expect(audio.level()).toBe(0);
    await audio.openMic();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(audio.level()).toBeCloseTo(0.25, 2);
    expect(audio.micDeviceId()).toBe('mic-1');

    const stuecke: ArrayBuffer[] = [];
    await audio.startMic((pcm) => stuecke.push(pcm));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    FakeWorkletNode.last!.port.onmessage?.({ data: new ArrayBuffer(8) });
    expect(stuecke).toHaveLength(1);

    // Neu verbinden: nur die Stücke werden umgelenkt, das Mikrofon bleibt offen.
    audio.stopSending();
    FakeWorkletNode.last!.port.onmessage?.({ data: new ArrayBuffer(8) });
    expect(stuecke).toHaveLength(1);
    const neu: ArrayBuffer[] = [];
    await audio.startMic((pcm) => neu.push(pcm));
    FakeWorkletNode.last!.port.onmessage?.({ data: new ArrayBuffer(8) });
    expect(neu).toHaveLength(1);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(streams[0].track.stopped).toBe(false);
  });

  it('S2: Gerätewahl öffnet das gewählte Mikrofon und gibt das alte frei', async () => {
    const audio = createLiveAudio();
    await audio.openMic();
    await audio.openMic('mic-2');
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(streams[0].track.stopped).toBe(true);
    expect(audio.micDeviceId()).toBe('mic-2');
  });

  it('startMic ohne Check fragt das Mikrofon selbst an und reicht eine Verweigerung weiter', async () => {
    const audio = createLiveAudio();
    await audio.startMic(() => {});
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    getUserMedia.mockRejectedValueOnce(Object.assign(new Error('nein'), { name: 'NotAllowedError' }));
    const zweites = createLiveAudio();
    await expect(zweites.startMic(() => {})).rejects.toMatchObject({ name: 'NotAllowedError' });
  });

  it('S6: stumm schalten lässt Strom und Verbindung stehen', async () => {
    const audio = createLiveAudio();
    await audio.openMic();
    audio.setMicMuted(true);
    expect(streams[0].track.enabled).toBe(false);
    expect(streams[0].track.stopped).toBe(false);
    audio.setMicMuted(false);
    expect(streams[0].track.enabled).toBe(true);
  });

  it('C13: die Coach-Pause hält Mikrofon und Wiedergabe an und gibt beides danach wieder frei', async () => {
    const audio = createLiveAudio();
    const ctx = FakeContext.last!;
    await audio.openMic();
    audio.setPaused(true);
    expect(streams[0].track.enabled).toBe(false);
    expect(ctx.suspended).toBe(1);
    // In der Pause setzt ein Klick den Kontext nicht heimlich fort.
    audio.unlock();
    expect(ctx.state).toBe('suspended');
    audio.setPaused(false);
    expect(streams[0].track.enabled).toBe(true);
    expect(ctx.state).toBe('running');
    // Wer vor der Pause stumm war, bleibt es danach.
    audio.setMicMuted(true);
    audio.setPaused(true);
    audio.setPaused(false);
    expect(streams[0].track.enabled).toBe(false);
  });

  it('S4: meldet „spricht“ vom ersten Ton bis zum Ende des letzten Stücks', () => {
    const audio = createLiveAudio();
    const ctx = FakeContext.last!;
    const meldungen: boolean[] = [];
    audio.onSpeaking((on) => meldungen.push(on));
    audio.play(tonStueck());
    audio.play(tonStueck());
    expect(meldungen).toEqual([true]);
    ctx.sources[0].onended?.();
    expect(meldungen).toEqual([true]);
    ctx.sources[1].onended?.();
    expect(meldungen).toEqual([true, false]);
  });

  it('S31: eine Unterbrechung nennt die gespielten Millisekunden der laufenden Antwort', () => {
    const audio = createLiveAudio();
    const ctx = FakeContext.last!;
    // Fünf Stücke zu 100 ms, lückenlos ab 0,02 s.
    for (let i = 0; i < 5; i++) audio.play(tonStueck());
    ctx.currentTime = 0.27;
    expect(audio.interrupt()).toBe(250);
    expect(ctx.sources.every((s) => s.stopped)).toBe(true);
    // Danach beginnt eine neue Antwort bei null.
    ctx.currentTime = 1;
    audio.play(tonStueck());
    ctx.currentTime = 1.07;
    expect(audio.interrupt()).toBe(50);
  });

  it('S31: nach `turn` zählt der nächste Ton neu — der Rest der alten Antwort zählt nicht mehr mit', () => {
    const audio = createLiveAudio();
    const ctx = FakeContext.last!;
    audio.play(tonStueck());
    audio.answerDone();
    // Unterbrechung, bevor neuer Ton kam (die Rolle dachte noch nach): nichts gehört.
    ctx.currentTime = 0.08;
    expect(audio.interrupt()).toBe(0);
    ctx.currentTime = 5;
    audio.play(tonStueck());
    ctx.currentTime = 5.05;
    expect(audio.interrupt()).toBe(30);
  });

  it('S31: die Eröffnung endet ohne `turn` und zählt deshalb mit (das Relais rechnet sie heraus)', () => {
    const audio = createLiveAudio();
    const ctx = FakeContext.last!;
    // Eröffnung: drei Stücke zu 100 ms, ganz gespielt. Kein `turn` danach.
    for (let i = 0; i < 3; i++) audio.play(tonStueck());
    ctx.currentTime = 4;
    // Erste Antwort: zwei Stücke, nach 150 ms unterbrochen.
    audio.play(tonStueck());
    audio.play(tonStueck());
    ctx.currentTime = 4.17;
    expect(audio.interrupt()).toBe(450);
  });

  it('„Ton der Rolle aus“ dreht nur den Regler zu', () => {
    const audio = createLiveAudio();
    const ctx = FakeContext.last!;
    audio.setOutputMuted(true);
    expect(ctx.gain.gain.value).toBe(0);
    audio.setOutputMuted(false);
    expect(ctx.gain.gain.value).toBe(1);
  });

  it('close gibt das Mikrofon frei und schließt den Kontext genau einmal', async () => {
    const audio = createLiveAudio();
    const ctx = FakeContext.last!;
    await audio.openMic();
    audio.close();
    audio.close();
    expect(streams[0].track.stopped).toBe(true);
    expect(ctx.closedCount).toBe(1);
    // Danach wird nichts mehr geöffnet.
    await audio.openMic();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('finish gibt das Mikrofon sofort frei und schließt erst nach dem Rest der Antwort', async () => {
    vi.useFakeTimers();
    const audio = createLiveAudio();
    const ctx = FakeContext.last!;
    await audio.openMic();
    audio.play(tonStueck());
    audio.finish();
    expect(streams[0].track.stopped).toBe(true);
    expect(ctx.closedCount).toBe(0);
    vi.advanceTimersByTime(400);
    expect(ctx.closedCount).toBe(1);
  });
});
