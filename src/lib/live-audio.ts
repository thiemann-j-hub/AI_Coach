/**
 * Tonweg im Browser für den Sprachmodus Live (N4-231).
 *
 *   Mikrofon → AudioWorklet (Abtastung auf 16 kHz, PCM 16 Bit, Stücke zu 100 ms) → Server
 *   Server   → PCM 16 Bit, 24 kHz → lückenlos geplante AudioBuffer-Quellen → Lautsprecher
 *
 * Beides hängt an EINEM AudioContext, der im Klick auf das Mikro entsteht (Autoplay-Regel).
 * Ohne AudioWorklet (sehr alte Browser) fällt die Aufnahme auf einen ScriptProcessor zurück.
 */

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
  /** Aufnahme starten; jedes Stück ist PCM 16 Bit / 16 kHz / mono (≈ 100 ms). */
  startMic(onChunk: (pcm: ArrayBuffer) => void): Promise<void>;
  /** Antwort-Audio (PCM 16 Bit / 24 kHz / mono) anhängen; spielt lückenlos weiter. */
  play(pcm: ArrayBuffer): void;
  /** Unterbrechung: Warteschlange leeren, sofort still. */
  interrupt(): void;
  /** Mikrofon freigeben, die Antwort aber zu Ende spielen lassen; danach schließen (Verabschiedung!). */
  finish(): void;
  /** Alles beenden (Mikrofon freigeben, sofort still, Kontext schließen). */
  close(): void;
}

export function liveAudioSupported(): boolean {
  return typeof window !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && ("AudioContext" in window || "webkitAudioContext" in window);
}

export function createLiveAudio(): LiveAudio {
  const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
  const ctx = new Ctx();
  let stream: MediaStream | null = null;
  let micNodes: AudioNode[] = [];
  let workletUrl: string | null = null;
  let nextTime = 0;
  let playing: AudioBufferSourceNode[] = [];
  let closed = false;

  const mic = async (onChunk: (pcm: ArrayBuffer) => void) => {
    if (closed) return;
    await ctx.resume();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (closed) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const source = ctx.createMediaStreamSource(stream);
    if (ctx.audioWorklet) {
      workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
      await ctx.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(ctx, "pn-live-mic", { numberOfInputs: 1, numberOfOutputs: 0 });
      node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onChunk(e.data);
      source.connect(node);
      micNodes = [source, node];
      return;
    }
    // Notnagel ohne AudioWorklet: ScriptProcessor (veraltet, aber überall vorhanden).
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const ratio = ctx.sampleRate / 16000;
    let rest = new Float32Array(0);
    let pos = 0;
    let out = new Int16Array(1600);
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
        out[fill++] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
        if (fill === out.length) {
          onChunk(out.buffer.slice(0));
          out = new Int16Array(1600);
          fill = 0;
        }
        i += ratio;
      }
      const consumed = Math.floor(i);
      rest = buf.slice(consumed);
      pos = i - consumed;
    };
    const sink = ctx.createGain();
    sink.gain.value = 0;
    source.connect(proc);
    proc.connect(sink);
    sink.connect(ctx.destination);
    micNodes = [source, proc, sink];
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
    src.connect(ctx.destination);
    const at = Math.max(ctx.currentTime + 0.02, nextTime);
    src.start(at);
    nextTime = at + buffer.duration;
    playing.push(src);
    src.onended = () => {
      playing = playing.filter((s) => s !== src);
    };
  };

  const interrupt = () => {
    for (const s of playing) {
      try {
        s.stop();
      } catch {
        /* schon fertig */
      }
    }
    playing = [];
    nextTime = 0;
  };

  const releaseMic = () => {
    for (const n of micNodes) {
      try {
        n.disconnect();
      } catch {
        /* egal */
      }
    }
    micNodes = [];
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (workletUrl) {
      URL.revokeObjectURL(workletUrl);
      workletUrl = null;
    }
  };

  const close = () => {
    if (closed) return;
    closed = true;
    interrupt();
    releaseMic();
    void ctx.close().catch(() => {});
  };

  const finish = () => {
    if (closed) return;
    releaseMic();
    const restMs = Math.max(0, (nextTime - ctx.currentTime) * 1000);
    setTimeout(close, restMs + 150);
  };

  return { startMic: mic, play, interrupt, finish, close };
}
