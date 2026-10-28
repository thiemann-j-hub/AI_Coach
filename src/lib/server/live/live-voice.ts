import type { PersonaVoice, SimConversationLocale } from "@/lib/simulation/types";

/**
 * Stimmen-Zuordnung für den Sprachmodus Live (Owner-Hörurteil 28.10.2026):
 * Von zwölf Gemini-Live-Stimmen bestanden im echten Gesprächszug Aoede (weiblich, als „Sabine“)
 * und Charon (männlich, als „Toni“). Szenarien mit Seraphina sprechen live mit Aoede, Szenarien mit
 * Florian mit Charon. Emma (weiblich, international) bekommt bis zu einem eigenen Hörurteil Aoede.
 * Die übrigen zehn Stimmen liegen als Hörproben in Cowork\Hoerproben-Live-Modelle-2026-10-28.
 */
export const LIVE_VOICE_BY_PERSONA_VOICE: Readonly<Record<PersonaVoice, string>> = {
  "seraphina-hd": "Aoede",
  "florian-hd": "Charon",
  "emma-hd": "Aoede",
};

export function liveVoiceFor(voice: PersonaVoice | undefined): string {
  return LIVE_VOICE_BY_PERSONA_VOICE[voice ?? "florian-hd"] ?? "Charon";
}

/** Sprachkennung für die Sprachausgabe des Live-Modells (Gesprächssprache, nicht Autorensprache). */
export function liveLanguageCode(locale: SimConversationLocale | undefined): string {
  switch (locale) {
    case "en":
      return "en-US";
    case "es":
      return "es-ES";
    case "fr":
      return "fr-FR";
    default:
      return "de-DE";
  }
}
