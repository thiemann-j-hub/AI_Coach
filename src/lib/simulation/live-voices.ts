/**
 * Live-Stimmen (Gemini Live, EU) für die Stimmenwahl im Builder — client-sicher.
 *
 * 30 Stimmen laut Google; „character“ ist Googles Ein-Wort-Beschreibung, übersetzt. Geschlecht laut
 * Google-Liste (Owner-Ohr entscheidet; Hörproben: /stimmen/<id>.mp3, ein deutscher Satz je Stimme).
 * `fallback` ist die Azure-Stimme für den Textweg (Tippen statt Sprechen): sie liest dann vor.
 */
import type { PersonaVoice } from "./types";

export type LiveVoiceGender = "w" | "m";

export interface LiveVoice {
  id: string;
  gender: LiveVoiceGender;
  /** Googles Charakterwort, deutsch. */
  character: string;
}

export const LIVE_VOICES: ReadonlyArray<LiveVoice> = [
  // weiblich
  { id: "Aoede", gender: "w", character: "luftig" },
  { id: "Kore", gender: "w", character: "fest" },
  { id: "Leda", gender: "w", character: "jugendlich" },
  { id: "Zephyr", gender: "w", character: "hell" },
  { id: "Autonoe", gender: "w", character: "hell" },
  { id: "Callirrhoe", gender: "w", character: "entspannt" },
  { id: "Despina", gender: "w", character: "weich" },
  { id: "Erinome", gender: "w", character: "klar" },
  { id: "Laomedeia", gender: "w", character: "aufgeweckt" },
  { id: "Achernar", gender: "w", character: "sanft" },
  { id: "Gacrux", gender: "w", character: "reif" },
  { id: "Pulcherrima", gender: "w", character: "direkt" },
  { id: "Vindemiatrix", gender: "w", character: "behutsam" },
  { id: "Sulafat", gender: "w", character: "warm" },
  // männlich
  { id: "Charon", gender: "m", character: "sachlich" },
  { id: "Puck", gender: "m", character: "aufgeweckt" },
  { id: "Fenrir", gender: "m", character: "erregbar" },
  { id: "Orus", gender: "m", character: "fest" },
  { id: "Alnilam", gender: "m", character: "fest" },
  { id: "Iapetus", gender: "m", character: "klar" },
  { id: "Enceladus", gender: "m", character: "hauchig" },
  { id: "Umbriel", gender: "m", character: "entspannt" },
  { id: "Algieba", gender: "m", character: "weich" },
  { id: "Algenib", gender: "m", character: "rau" },
  { id: "Rasalgethi", gender: "m", character: "sachlich" },
  { id: "Schedar", gender: "m", character: "gleichmäßig" },
  { id: "Achird", gender: "m", character: "freundlich" },
  { id: "Zubenelgenubi", gender: "m", character: "lässig" },
  { id: "Sadachbia", gender: "m", character: "lebhaft" },
  { id: "Sadaltager", gender: "m", character: "wissend" },
];

export const LIVE_VOICE_IDS: ReadonlyArray<string> = LIVE_VOICES.map((v) => v.id);

export function isLiveVoice(v: unknown): v is string {
  return typeof v === "string" && LIVE_VOICE_IDS.includes(v);
}

export function liveVoiceInfo(id: string | undefined): LiveVoice | undefined {
  return LIVE_VOICES.find((v) => v.id === id);
}

/** Azure-Stimme für den Textweg, abgeleitet aus Geschlecht der Live-Stimme und Szenariosprache. */
export function fallbackPersonaVoice(liveVoice: string | undefined, locale: "de" | "en"): PersonaVoice {
  const g = liveVoiceInfo(liveVoice)?.gender ?? "m";
  if (g === "w") return locale === "en" ? "emma-hd" : "seraphina-hd";
  return "florian-hd";
}

/** Pfad der Hörprobe (unter dem basePath der App). */
export function liveVoiceSamplePath(id: string): string {
  return `/stimmen/${id}.mp3`;
}
