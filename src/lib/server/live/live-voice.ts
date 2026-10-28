import { isLiveVoice } from "@/lib/simulation/live-voices";
import type { PersonaVoice, SimConversationLocale } from "@/lib/simulation/types";

/**
 * Stimmen-Zuordnung für den Sprachmodus Live.
 *
 * Erstes Owner-Hörurteil 28.10.2026 (zwölf Stimmen, Cowork\Hoerproben-Live-Modelle-2026-10-28):
 * Aoede (weiblich) und Charon (männlich) bestanden. Sie bleiben der Rückfall nach Persona-Stimme,
 * also auch für Kundenszenarien aus dem Builder.
 *
 * Zweites Owner-Hörurteil 28.10.2026 (je Rolle drei Kandidaten sprechen den echten Eröffnungssatz,
 * Cowork\Hoerproben-Rollenstimmen-2026-10-28): die acht Standard-Szenarien bekommen ihre eigene
 * Stimme. Diese Zuordnung geht vor der Persona-Stimme.
 */
export const LIVE_VOICE_BY_SCENARIO: Readonly<Record<string, string>> = {
  "sim-coaching-morgan": "Aoede", // Alex Morgan — warm, schnell (Wahl A)
  "sim-peer-lang": "Alnilam", // Viktor Lang — kühl, knapp (Wahl B)
  "sim-critique-vance": "Puck", // Dr. Robin Vance — scharf, ironisch (Wahl B)
  "sim-azubi-roth": "Zubenelgenubi", // Deniz Roth — Azubi, flapsig (Wahl B)
  "sim-performance-reed": "Charon", // Sam Reed — ruhig, dozierend (Wahl A)
  "sim-merge-brandt": "Achird", // Marek Brandt — verbindlich, hart in der Sache (Wahl B)
  "sim-peer-falk": "Algieba", // Ruben Falk — 52, süffisant (Wahl B)
  "sim-appraisal-stone": "Iapetus", // Erik Stone — Englisch, flott (Wahl C)
};

export const LIVE_VOICE_BY_PERSONA_VOICE: Readonly<Record<PersonaVoice, string>> = {
  "seraphina-hd": "Aoede",
  "florian-hd": "Charon",
  "emma-hd": "Aoede",
};

/**
 * Live-Stimme einer Rolle: (1) im Builder gewählte Live-Stimme, (2) Owner-Wahl je Standard-Szenario,
 * (3) Rückfall nach Persona-Stimme (Azure-Name).
 */
export function liveVoiceFor(voice: PersonaVoice | undefined, scenarioId?: string, liveVoice?: string): string {
  if (liveVoice && isLiveVoice(liveVoice)) return liveVoice;
  if (scenarioId && LIVE_VOICE_BY_SCENARIO[scenarioId]) return LIVE_VOICE_BY_SCENARIO[scenarioId];
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
