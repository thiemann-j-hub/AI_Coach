/**
 * Persona-Stimme über Azure AI Speech (Owner-GO 19.09.2026).
 *
 * Befund: Der Coach las Persona-Antworten mit der Browser-Stimme vor —
 * unter Windows/Chrome die erste de-DE-Stimme der Liste („Microsoft Hedda",
 * Systemstimme von 2013, abgehackt, für ALLE Personas dieselbe Frauenstimme).
 * Jetzt spricht der Server mit denselben Azure-Neural-HD-Stimmen, die im
 * Studio die Videos vertonen (Ressource `pulsenorth-speech`, westeurope —
 * EU-Verarbeitung; 22 $/1M Zeichen ⇒ ~13 Cent je komplettem Rollenspiel).
 *
 * Portiert aus ai-elearning-studio/src/lib/server/azure-tts.ts (TS-1/T2),
 * reduziert auf das, was ein Gesprächs-Coach braucht: kurze Antworten, keine
 * Regie-Marker, keine persistierten Assets. Die puren Teile (Stimmen, SSML,
 * Escaping) sind env-frei und per Vitest abgedeckt.
 */
import {
  DEFAULT_PERSONA_VOICE,
  PERSONA_VOICES,
  type PersonaVoice,
} from "@/lib/simulation/types";

/** Stimm-Whitelist (Owner-Hörtest 08/2026: nur diese drei bestehen die Umlaute). */
export const TTS_VOICES: ReadonlyArray<{ id: PersonaVoice; azureName: string }> = [
  { id: "seraphina-hd", azureName: "de-DE-Seraphina:DragonHDLatestNeural" },
  { id: "florian-hd", azureName: "de-DE-Florian:DragonHDLatestNeural" },
  { id: "emma-hd", azureName: "en-US-Emma:DragonHDLatestNeural" },
];

export function isPersonaVoice(v: unknown): v is PersonaVoice {
  return typeof v === "string" && (PERSONA_VOICES as readonly string[]).includes(v);
}

/**
 * Persona-Antworten sind Gesprächsbeiträge, keine Vorträge: 1.500 Zeichen
 * (~1,5 Minuten) decken jede Antwort und deckeln zugleich die Kosten je Call.
 */
export const TTS_MAX_CHARS = 1500;

/** Gesprächssprache → BCP-47 für xml:lang (die vier Coach-Sprachen). */
const LOCALE_TO_BCP47: Record<string, string> = {
  de: "de-DE",
  en: "en-GB",
  es: "es-ES",
  fr: "fr-FR",
};
export function bcp47ForLocale(locale: string | undefined): string {
  return LOCALE_TO_BCP47[(locale ?? "de").toLowerCase()] ?? "de-DE";
}

/**
 * XML-Escaping — SICHERHEITSKANTE: die Antwort stammt aus dem LLM, die Route
 * nimmt aber Text vom Client entgegen. Ohne Escaping könnte jemand SSML-Tags
 * einschleusen (fremde Stimme, Endlos-Pausen). Nur Text passiert, nie Markup.
 */
export function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Baut das SSML-Dokument (pur, deterministisch — testbar ohne Azure). */
export function buildTtsSsml(params: { text: string; voice: PersonaVoice; locale?: string }): string {
  const voice = TTS_VOICES.find((v) => v.id === params.voice) ?? TTS_VOICES[0];
  const lang = bcp47ForLocale(params.locale);
  // Absätze = kurze Sprechpause; mehr Regie braucht ein Gesprächsbeitrag nicht.
  const paragraphs = params.text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => escapeXmlText(p.trim()))
    .filter((p) => p.length > 0);
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">` +
    `<voice name="${voice.azureName}"><lang xml:lang="${lang}">` +
    paragraphs.join('<break time="400ms"/>') +
    `</lang></voice></speak>`
  );
}

export class AzureTtsError extends Error {
  constructor(
    message: string,
    /** 503 = nicht konfiguriert/Upstream weg; 422 = Eingabe-Problem; 502 = Upstream-Fehler. */
    public readonly status: 422 | 502 | 503
  ) {
    super(message);
    this.name = "AzureTtsError";
  }
}

/** Ist Azure Speech konfiguriert? (Route: ehrliches 503 → Client nimmt die Browserstimme.) */
export function azureTtsConfigured(): boolean {
  return !!process.env.AZURE_SPEECH_KEY && !!process.env.AZURE_SPEECH_REGION;
}

/** Synthetisiert den Text zu MP3-Bytes (24 kHz/96 kbit mono) — mit KI-Kennzeichnung im ID3-Tag. */
export async function synthesizeTtsMp3(params: {
  text: string;
  voice: PersonaVoice;
  locale?: string;
}): Promise<Uint8Array> {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) {
    throw new AzureTtsError("Sprachausgabe ist nicht konfiguriert (AZURE_SPEECH_KEY/REGION fehlen).", 503);
  }
  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
      "User-Agent": "pulsenorth-coach-tts",
    },
    body: buildTtsSsml({ text: params.text, voice: params.voice ?? DEFAULT_PERSONA_VOICE, locale: params.locale }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[azure-tts] upstream ${res.status}: ${detail.slice(0, 300)}`);
    throw new AzureTtsError(
      res.status === 400 ? "Der Text konnte nicht vertont werden." : "Die Sprachausgabe ist gerade nicht verfügbar.",
      res.status === 400 ? 422 : 502
    );
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength < 128) {
    throw new AzureTtsError("Die Sprachausgabe lieferte keine Daten.", 502);
  }
  return prependAiId3Tag(bytes);
}

/**
 * EU AI Act Art. 50 — maschinenlesbare KI-Kennzeichnung als ID3v2.3-COMM-Frame
 * vor den MP3-Daten (Player überspringen ID3-Header standardkonform).
 */
const AI_AUDIO_COMMENT =
  "AI-generated synthetic voice (EU AI Act Art. 50). Produced by PulseNorth.AI Coach (Azure TTS).";

export function prependAiId3Tag(mp3: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const text = enc.encode(AI_AUDIO_COMMENT);
  const body = new Uint8Array(1 + 3 + 1 + text.length);
  body.set([0x00], 0);
  body.set(enc.encode("eng"), 1);
  body.set([0x00], 4);
  body.set(text, 5);
  const frame = new Uint8Array(10 + body.length);
  frame.set(enc.encode("COMM"), 0);
  new DataView(frame.buffer).setUint32(4, body.length, false);
  frame.set(body, 10);
  const tagSize = frame.length;
  const header = new Uint8Array(10);
  header.set(enc.encode("ID3"), 0);
  header.set([0x03, 0x00, 0x00], 3);
  header[6] = (tagSize >>> 21) & 0x7f;
  header[7] = (tagSize >>> 14) & 0x7f;
  header[8] = (tagSize >>> 7) & 0x7f;
  header[9] = tagSize & 0x7f;
  const out = new Uint8Array(10 + tagSize + mp3.length);
  out.set(header, 0);
  out.set(frame, 10);
  out.set(mp3, 10 + tagSize);
  return out;
}
