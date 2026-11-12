/**
 * Tonweg im Browser für den Sprachmodus Live (N4-231).
 *
 *   Mikrofon → AudioWorklet (Abtastung auf 16 kHz, PCM 16 Bit, Stücke zu 100 ms) → Server
 *   Server   → PCM 16 Bit, 24 kHz → lückenlos geplante AudioBuffer-Quellen → Lautsprecher
 *
 * Beides hängt an EINEM AudioContext, der im Klick entsteht (Autoplay-Regel).
 * Ohne AudioWorklet (sehr alte Browser) fällt die Aufnahme auf einen ScriptProcessor zurück.
 *
 * Paket 4 (12.11.2026, WELLE3-SPRECHEN.md):
 *   - C30: `createLiveAudio()` und `unlock()` gehören in den Klick selbst (vorher entstand der Kontext nach einem
 *     `await`; iOS gibt den Ton dann nicht frei). Auf `ctx.resume()` wird nirgends mehr gewartet.
 *   - S2: `openMic()` öffnet das Mikrofon schon im Mikrofon-Check (Pegel über einen AnalyserNode, Gerätewahl);
 *     `startMic()` nutzt genau diesen Strom weiter, es wird kein zweites Mal angefragt.
 *   - S6, C13: stumm schalten ohne aufzulegen, Coach-Pause hält Mikrofon und Wiedergabe an.
 *   - S4: `onSpeaking` meldet, ob gerade Ton der Rolle läuft (Zustand „spricht“).
 *   - S31: `interrupt()` nennt, wie viele Millisekunden der laufenden Antwort wirklich abgespielt wurden.
 */
import { pegelAusBytes } from "@/lib/simulation/mikro-pegel";

const WORKLET_SOURCE = `
class PnLiveMic extends AudioWorkletProcessor {
  constructor() {
    super();
    this.rest = new Float32Array(0);
    this.ratio = sampleRate / 16000;
    this.out = new Int16Array(1600);
    this.fill = 0;
    this.pos = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const buf = new Float32Array(this.rest.length + ch.length);
    buf.set(this.rest, 0);
    buf.set(ch, this.rest.length);
    let i = this.pos;
    while (i + this.ratio <= buf.length) {
      // Mittelwert über das Quellfenster: einfache Tiefpass-Abtastung, reicht für Sprache.
      const from = Math.floor(i), to = Math.min(buf.length, Math.floor(i + this.ratio));
      let s = 0;
      for (let k = from; k < to; k++) s += buf[k];
      const v = to > from ? s / (to - from) : 0;
      this.out[this.fill++] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
      if (this.fill === this.out.length) {
        this.port.postMessage(this.out.buffer.slice(0));
        this.fill = 0;
      }
      i += this.ratio;
    }
    const consumed = Math.floor(i);
    this.rest = buf.subarray(consumed);
    this.pos = i - consumed;
    return true;
  }
}
registerProcessor('pn-live-mic', PnLiveMic);
`;

export interface LiveAudio {
  /** Im Klick aufrufen (C30, iOS): den Kontext fortsetzen, solange die Geste gilt. */
  unlock(): void;
  /** Mikrofon öffnen, ohne zu senden (Mikrofon-Check). Ein erneuter Aufruf wechselt das Gerät. */
  openMic(deviceId?: string): Promise<void>;
  /** Pegel des offenen Mikrofons als Effektivwert 0 bis 1; 0 ohne Mikrofon. */
  level(): number;
  /** Kennung des offenen Mikrofons (für die Gerätewahl); null ohne Mikrofon. */
  micDeviceId(): string | null;
  /**
   * Aufnahme starten; jedes Stück ist PCM 16 Bit / 16 kHz / mono (≈ 100 ms). Nutzt das schon geöffnete Mikrofon.
   * Ein erneuter Aufruf lenkt nur die Stücke um (neu verbinden).
   */
  startMic(onChunk: (pcm: ArrayBuffer) => void): Promise<void>;
  /** Nichts mehr senden; das Mikrofon bleibt offen (zwischen zwei Verbindungen). */
  stopSending(): void;
  /** Stumm ohne Auflegen (S6): Das Mikrofon liefert Stille, die Verbindung bleibt. */
  setMicMuted(on: boolean): void;
  /** Ton der Rolle an oder aus. */
  setOutputMuted(on: boolean): void;
  /** Coach-Pause (C13): Mikrofon stumm und Wiedergabe angehalten; danach geht beides an derselben Stelle weiter. */
  setPaused(on: boolean): void;
  /** Meldet, ob gerade Ton der Rolle abgespielt wird (S4). */
  onSpeaking(cb: (laeuft: boolean) => void): void;
  /** Antwort-Audio (PCM 16 Bit / 24 kHz / mono) anhängen; spielt lückenlos weiter. */
  play(pcm: ArrayBuffer): void;
  /**
   * Unterbrechung: Warteschlange leeren, sofort still. Rückgabe (S31): so viele Millisekunden des Tons, der seit
   * dem letzten `answerDone()` oder `interrupt()` ankam, wurden wirklich abgespielt. So zählt auch das Relais:
   * ab dem letzten `turn` oder `interrupted`. Die hörbare Eröffnung endet ohne `turn` und zählt deshalb mit;
   * das Relais rechnet sie heraus.
   */
  interrupt(): number;
  /**
   * `turn` kam an: Die Zählung für `interrupt` beginnt sofort bei null. Der Rest der Antwort spielt weiter,
   * zählt aber nicht mehr mit (er gehört zum gespeicherten Zug).
   */
  answerDone(): void;
  /** Mikrofon freigeben, die Antwort aber zu Ende spielen lassen; danach schließen (Verabschiedung!). */
  finish(): void;
  /** Alles beenden (Mikrofon freigeben, sofort still, Kontext schließen). */
  close(): void;
}

export function liveAudioSupported(): boolean {
  return typeof window !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && ("AudioContext" in window || "webkitAudioContext" in window);
}

/** Ein Stück geplanter Wiedergabe in der Zeit des AudioContext (Sekunden). */
export interface TonStueck {
  start: number;
  dauer: number;
}

/**
 * Wie viele Millisekunden der Stücke sind bis `jetzt` (Zeit des AudioContext, Sekunden) wirklich abgespielt?
 * Stücke in der Zukunft zählen nicht, laufende anteilig, Lücken zwischen Stücken gar nicht.
 */
export function gespielteMs(stuecke: ReadonlyArray<TonStueck>, jetzt: number): number {
  let sekunden = 0;
  for (const s of stuecke) sekunden += Math.min(Math.max(jetzt - s.start, 0), s.dauer);
  return Math.round(sekunden * 1000);
}

/**
 * Die wählbaren Mikrofone aus der Geräteliste des Browsers. Chrome nennt zusätzlich zwei Verweise auf das
 * Standardgerät („default“, „communications“); sie fallen weg, sobald es echte Einträge gibt — sonst stünde
 * ein einziges Mikrofon dreimal in der Auswahl.
 */
export function waehlbareMikrofone(
  geraete: ReadonlyArray<{ kind: string; deviceId: string; label: string }>
): Array<{ deviceId: string; label: string }> {
  const mikros = geraete.filter((d) => d.kind === "audioinput" && d.deviceId).map((d) => ({ deviceId: d.deviceId, label: d.label }));
  const echte = mikros.filter((d) => d.deviceId !== "default" && d.deviceId !== "communications");
  return echte.length > 0 ? echte : mikros;
}

/** Die Mikrofone dieses Geräts (Namen nennt der Browser erst nach der Freigabe). */
export async function listMicrophones(): Promise<Array<{ deviceId: string; label: string }>> {
  try {
    return waehlbareMikrofone(await navigator.mediaDevices.enumerateDevices());
  } catch {
    return [];
  }
}

export function createLiveAudio(): LiveAudio {
  const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
  const ctx = new Ctx();
  // Alle Antwort-Stücke laufen über diesen Regler: „Ton der Rolle aus“ stellt ihn auf null.
  const out = ctx.createGain();
  out.connect(ctx.destination);
  let stream: MediaStream | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let pegelBytes: Uint8Array<ArrayBuffer> | null = null;
  let captureNodes: AudioNode[] = [];
  let workletUrl: string | null = null;
  let workletLoad: Promise<void> | null = null;
  let sink: ((pcm: ArrayBuffer) => void) | null = null;
  let micMuted = false;
  let paused = false;
  let nextTime = 0;
  let playing: AudioBufferSourceNode[] = [];
  let stuecke: TonStueck[] = [];
  let speaking = false;
  let speakingCb: ((laeuft: boolean) => void) | null = null;
  let closed = false;

  const setSpeaking = (on: boolean) => {
    if (speaking === on) return;
    speaking = on;
    speakingCb?.(on);
  };

  const unlock = () => {
    if (closed || paused) return;
    void ctx.resume().catch(() => {});
    // iOS gibt den Ton erst frei, wenn in der Geste etwas abgespielt wurde: ein stummer Puffer genügt.
    try {
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, 22050);
      s.connect(out);
      s.start(0);
    } catch {
      /* Freigabe ist ein Versuch */
    }
  };

  const applyMicState = () => {
    stream?.getAudioTracks().forEach((t) => {
      t.enabled = !(micMuted || paused);
    });
  };

  const detachCapture = () => {
    for (const n of captureNodes) {
      try {
        n.disconnect();
      } catch {
        /* egal */
      }
    }
    captureNodes = [];
  };

  const releaseMic = () => {
    detachCapture();
    for (const n of [source, analyser]) {
      try {
        n?.disconnect();
      } catch {
        /* egal */
      }
    }
    source = null;
    analyser = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  };

  /** Die Aufnahme an das offene Mikrofon hängen: Stücke gehen an `sink`. */
  const attachCapture = async () => {
    const src = source;
    if (closed || !src || captureNodes.length) return;
    if (ctx.audioWorklet) {
      if (!workletLoad) {
        workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
        workletLoad = ctx.audioWorklet.addModule(workletUrl);
      }
      await workletLoad;
      // Paket 1, C11 (12.11.2026): Während des Ladens geschlossen oder das Gerät gewechselt → nichts mehr anschließen.
      if (closed || source !== src || captureNodes.length) return;
      const node = new AudioWorkletNode(ctx, "pn-live-mic", { numberOfInputs: 1, numberOfOutputs: 0 });
      node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => sink?.(e.data);
      src.connect(node);
      captureNodes = [node];
      return;
    }
    // Notnagel ohne AudioWorklet: ScriptProcessor (veraltet, aber überall vorhanden).
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const ratio = ctx.sampleRate / 16000;
    let rest = new Float32Array(0);
    let pos = 0;
    let stueck = new Int16Array(1600);
    let fill = 0;
    proc.onaudioprocess = (e) => {
      const ch = e.inputBuffer.getChannelData(0);
      const buf = new Float32Array(rest.length + ch.length);
      buf.set(rest, 0);
      buf.set(ch, rest.length);
      let i = pos;
      while (i + ratio <= buf.length) {
        const from = Math.floor(i);
        const to = Math.min(buf.length, Math.floor(i + ratio));
        let s = 0;
        for (let k = from; k < to; k++) s += buf[k];
        const v = to > from ? s / (to - from) : 0;
        stueck[fill++] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
        if (fill === stueck.length) {
          sink?.(stueck.buffer.slice(0));
          stueck = new Int16Array(1600);
          fill = 0;
        }
        i += ratio;
      }
      const consumed = Math.floor(i);
      rest = buf.slice(consumed);
      pos = i - consumed;
    };
    const still = ctx.createGain();
    still.gain.value = 0;
    src.connect(proc);
    proc.connect(still);
    still.connect(ctx.destination);
    captureNodes = [proc, still];
  };

  const openMic = async (deviceId?: string) => {
    if (closed) return;
    const next = await navigator.mediaDevices.getUserMedia({
      // Welle 2: voiceIsolation (Chrome) trennt die Stimme von Raumgeräuschen; andere Browser ignorieren das Feld.
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        voiceIsolation: true,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      } as MediaTrackConstraints,
    });
    if (closed) {
      next.getTracks().forEach((t) => t.stop());
      return;
    }
    // Gerätewechsel im laufenden Gespräch: Die Aufnahme zieht auf das neue Mikrofon um.
    const lief = captureNodes.length > 0;
    releaseMic();
    stream = next;
    source = ctx.createMediaStreamSource(next);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    applyMicState();
    if (lief) await attachCapture();
  };

  const mic = async (onChunk: (pcm: ArrayBuffer) => void) => {
    if (closed) return;
    sink = onChunk;
    if (!paused) void ctx.resume().catch(() => {});
    if (!stream) await openMic();
    await attachCapture();
  };

  const level = () => {
    if (closed || !analyser) return 0;
    if (!pegelBytes || pegelBytes.length !== analyser.fftSize) pegelBytes = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(pegelBytes);
    return pegelAusBytes(pegelBytes);
  };

  const play = (pcm: ArrayBuffer) => {
    if (closed || pcm.byteLength < 2) return;
    const n = Math.floor(pcm.byteLength / 2);
    const view = new DataView(pcm);
    const buffer = ctx.createBuffer(1, n, 24000);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = view.getInt16(i * 2, true) / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(out);
    const at = Math.max(ctx.currentTime + 0.02, nextTime);
    src.start(at);
    nextTime = at + buffer.duration;
    stuecke.push({ start: at, dauer: buffer.duration });
    playing.push(src);
    setSpeaking(true);
    src.onended = () => {
      playing = playing.filter((s) => s !== src);
      if (!playing.length) setSpeaking(false);
    };
  };

  const interrupt = () => {
    const ms = gespielteMs(stuecke, ctx.currentTime);
    for (const s of playing) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* schon fertig */
      }
    }
    playing = [];
    nextTime = 0;
    stuecke = [];
    setSpeaking(false);
    return ms;
  };

  const close = () => {
    if (closed) return;
    closed = true;
    interrupt();
    sink = null;
    releaseMic();
    if (workletUrl) {
      URL.revokeObjectURL(workletUrl);
      workletUrl = null;
    }
    void ctx.close().catch(() => {});
  };

  const finish = () => {
    if (closed) return;
    sink = null;
    releaseMic();
    const restMs = Math.max(0, (nextTime - ctx.currentTime) * 1000);
    setTimeout(close, restMs + 150);
  };

  return {
    unlock,
    openMic,
    level,
    micDeviceId: () => stream?.getAudioTracks()[0]?.getSettings().deviceId ?? null,
    startMic: mic,
    stopSending: () => {
      sink = null;
    },
    setMicMuted: (on) => {
      micMuted = on;
      applyMicState();
    },
    setOutputMuted: (on) => {
      out.gain.value = on ? 0 : 1;
    },
    setPaused: (on) => {
      if (closed || paused === on) return;
      paused = on;
      applyMicState();
      // Den Kontext anhalten: Die Antwort der Rolle bleibt stehen und läuft nach der Pause an derselben Stelle weiter.
      void (on ? ctx.suspend() : ctx.resume()).catch(() => {});
    },
    onSpeaking: (cb) => {
      speakingCb = cb;
    },
    play,
    interrupt,
    answerDone: () => {
      stuecke = [];
    },
    finish,
    close,
  };
}
