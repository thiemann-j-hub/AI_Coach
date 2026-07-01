/**
 * Centralized localStorage key constants.
 * Prevents magic strings scattered across components.
 *
 * PRÄFIX "coach_": unter dem Pulscraft-Hub-Front-Door teilen sich Hub, /coach,
 * /jobmap und /studio EINE Origin. Unpräfixierte Client-Storage-Keys würden sich
 * zwischen den Apps überschreiben. Deshalb tragen ALLE Coach-Client-Keys das feste
 * Präfix "coach_". (Betrifft NUR Client-Storage — Cookie-Namen/env/Hostnamen bleiben.)
 */

/** Theme preference (used by next-themes storageKey + design-preview) */
export const STORAGE_KEY_THEME = 'coach_theme';

/** Session ID for AnalyzeClient / RunsDashboardClient */
export const STORAGE_KEY_SESSION = 'coach_sessionId';

/** Alt-Key vor der Präfix-Einführung (Migration, damit laufende Sessions nicht abreißen). */
const LEGACY_SESSION_KEY = 'commscoach_sessionId';

/**
 * Einmalige, idempotente Migration alter Client-Storage-Keys auf die coach_-Präfixe.
 * Client-only; vor dem ersten Lesen der betroffenen Keys aufrufen. Aktuell nur die
 * Session (die einzige Stelle mit erhaltenswerten Bestands-Nutzerdaten); Theme/Sidebar
 * sind reine UI-Präferenzen und setzen sich einmalig auf Default zurück.
 */
export function migrateLegacyStorageKeys(): void {
  try {
    const ls = window.localStorage;
    const legacy = ls.getItem(LEGACY_SESSION_KEY);
    if (legacy !== null) {
      if (!ls.getItem(STORAGE_KEY_SESSION)) ls.setItem(STORAGE_KEY_SESSION, legacy);
      ls.removeItem(LEGACY_SESSION_KEY);
    }
  } catch {
    /* localStorage nicht verfügbar (SSR / privater Modus) — kein Abbruch */
  }
}
