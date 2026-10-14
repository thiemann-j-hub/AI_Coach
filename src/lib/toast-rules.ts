/**
 * W1-11 (LXT-Welle W1, Owner-GO 14.10.2026): Meldungen mit Regeln.
 *
 * Vorbild LXT (Tiefenanalyse Anhang E §4.3): Snackbar-Standard 5 s, `timeout: -1` = bleibt bis zum
 * Schließen — für Fehler, Hintergrundjobs und Wartung. Unsere Fassung als reine Regel, in allen
 * vier Apps dieselbe Datei:
 *   - Fehler bleiben stehen, bis man sie schließt (Infinity) — mit Fehler-Nr., wo der Server eine mitgibt;
 *   - Erfolg, Info, Hinweis verschwinden nach 5 s;
 *   - „Laden…“-Meldungen steuert der Aufrufer (unverändert);
 *   - eine ausdrückliche Dauer des Aufrufers gewinnt immer.
 * Rot ist der Fehler-Art vorbehalten (Erfolg/Info/Warnung haben eigene Farben).
 * Rückweg: TOAST_RULES=off am Server → `/api/version` meldet `toastRules:false`, die Oberfläche
 * fällt auf die Bibliotheks-Standards zurück (Fehler verschwinden wieder von selbst).
 */

export type ToastKind = "error" | "success" | "info" | "warning" | "loading" | "default";

/** LXT-Standard: 5 s für alles, was kein Fehler ist. */
export const TOAST_DEFAULT_MS = 5000;

let rulesOn = true;

/** Wird vom Versions-Abruf gesetzt (`/api/version` → `toastRules`). Standard: an. */
export function setToastRulesOn(on: boolean): void {
  rulesOn = on;
}

export function toastRulesOn(): boolean {
  return rulesOn;
}

/**
 * Reine Regel: welche Dauer bekommt eine Meldung?
 *  - `given` (Dauer des Aufrufers) gewinnt immer,
 *  - Regeln aus → `undefined` (Bibliotheks-Standard),
 *  - Laden → `undefined` (der Aufrufer schließt oder ersetzt sie),
 *  - Fehler → `Infinity` (bleibt bis zum Schließen),
 *  - alles andere → 5 s.
 */
export function toastDuration(kind: ToastKind, given?: number, on: boolean = rulesOn): number | undefined {
  if (given !== undefined) return given;
  if (!on) return undefined;
  if (kind === "loading") return undefined;
  if (kind === "error") return Infinity;
  return TOAST_DEFAULT_MS;
}

/** Bleibt die Meldung stehen (braucht also einen Schließen-Knopf)? */
export function toastStays(duration: number | undefined): boolean {
  return duration === Infinity;
}
