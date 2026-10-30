/**
 * Live-Stimmen (Gemini Live, EU) für die Stimmenwahl im Builder — client-sicher.
 *
 * 30 Stimmen laut Google; „character“ ist Googles Ein-Wort-Beschreibung (Schlüssel ins Wörterbuch). Geschlecht laut
 * Google-Liste (Owner-Ohr entscheidet; Hörproben: /stimmen/<id>.mp3, ein deutscher Satz je Stimme).
 * `fallback` ist die Azure-Stimme für den Textweg (Tippen statt Sprechen): sie liest dann vor.
 */
import type { PersonaVoice } from "./types";

export type LiveVoiceGender = "w" | "m";

/** Googles Ein-Wort-Charakter als Schlüssel; der Anzeigetext steht je Sprache im Wörterbuch (`simulation.liveVoiceCharacter`). */
export type LiveVoiceCharacter =
  | "breezy" | "firm" | "youthful" | "bright" | "easygoing" | "smooth" | "clear" | "upbeat" | "soft" | "mature" | "forward"
  | "gentle" | "warm" | "informative" | "excitable" | "breathy" | "gravelly" | "even" | "friendly" | "casual" | "lively" | "knowledgeable";

export interface LiveVoice {
  id: string;
  gender: LiveVoiceGender;
  character: LiveVoiceCharacter;
}

export const LIVE_VOICES: ReadonlyArray<LiveVoice> = [
  // weiblich
  { id: "Aoede", gender: "w", character: "breezy" },
  { id: "Kore", gender: "w", character: "firm" },
  { id: "Leda", gender: "w", character: "youthful" },
  { id: "Zephyr", gender: "w", character: "bright" },
  { id: "Autonoe", gender: "w", character: "bright" },
  { id: "Callirrhoe", gender: "w", character: "easygoing" },
  { id: "Despina", gender: "w", character: "smooth" },
  { id: "Erinome", gender: "w", character: "clear" },
  { id: "Laomedeia", gender: "w", character: "upbeat" },
  { id: "Achernar", gender: "w", character: "soft" },
  { id: "Gacrux", gender: "w", character: "mature" },
  { id: "Pulcherrima", gender: "w", character: "forward" },
  { id: "Vindemiatrix", gender: "w", character: "gentle" },
  { id: "Sulafat", gender: "w", character: "warm" },
  // männlich
  { id: "Charon", gender: "m", character: "informative" },
  { id: "Puck", gender: "m", character: "upbeat" },
  { id: "Fenrir", gender: "m", character: "excitable" },
  { id: "Orus", gender: "m", character: "firm" },
  { id: "Alnilam", gender: "m", character: "firm" },
  { id: "Iapetus", gender: "m", character: "clear" },
  { id: "Enceladus", gender: "m", character: "breathy" },
  { id: "Umbriel", gender: "m", character: "easygoing" },
  { id: "Algieba", gender: "m", character: "smooth" },
  { id: "Algenib", gender: "m", character: "gravelly" },
  { id: "Rasalgethi", gender: "m", character: "informative" },
  { id: "Schedar", gender: "m", character: "even" },
  { id: "Achird", gender: "m", character: "friendly" },
  { id: "Zubenelgenubi", gender: "m", character: "casual" },
  { id: "Sadachbia", gender: "m", character: "lively" },
  { id: "Sadaltager", gender: "m", character: "knowledgeable" },
];

export const LIVE_VOICE_IDS: ReadonlyArray<string> = LIVE_VOICES.map((v) => v.id);

export function isLiveVoice(v: unknown): v is string {
  return typeof v === "string" && LIVE_VOICE_IDS.includes(v);
}

export function liveVoiceInfo(id: string | undefined): LiveVoice | undefined {
  return LIVE_VOICES.find((v) => v.id === id);
}

/** Live-Stimme, wenn ein Szenario (noch) keine eigene hat: nach der Vorlesestimme (Owner-Hörurteil 28.10.: Aoede/Charon). */
export function defaultLiveVoice(voice: PersonaVoice | undefined): string {
  return voice === "seraphina-hd" || voice === "emma-hd" ? "Aoede" : "Charon";
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
