/**
 * Paket 4, C13 und U5 (12.11.2026): die sichtbare Uhr im Gespräch als reine Rechnung.
 *
 * Anlass: Die Uhr im Kopf rechnete ab `createdAt` und lief in der Coach-Pause weiter. Jetzt rechnet sie mit
 * derselben Funktion wie Zug-Route, Karte und Relais (`gespraechsZeitMs`, src/lib/simulation/zeit.ts) und steht in
 * der Pause („angehalten“). Der Server bleibt die Wahrheit; die Anzeige läuft ihm nur nicht mehr davon.
 */
import { gespraechsZeitMs, pauseLaeuft, type ZeitLauf } from './zeit';

/** Ab diesem Anteil der Zeit wird die Uhr gelb (deckungsgleich mit SIM_TIME_WARN_FRACTION der Zug-Route). */
export const UHR_WARN_ANTEIL = 0.8;

export interface UhrStand {
  /** Verbleibende Gesprächszeit in Millisekunden (nie negativ). */
  restMs: number;
  /** Anzeige „m:ss“. */
  text: string;
  /** Aufgerundete Minuten (für „Restzeit: ca. … Min.“). */
  restMin: number;
  /** Ab 80 % der Zeit. */
  warn: boolean;
  /** Die Zeit ist um. */
  um: boolean;
  /** Die Coach-Pause hält die Uhr gerade an. */
  angehalten: boolean;
}

/**
 * @param lauf     Start und Pausen des Laufs; `null`, solange der Start unbekannt ist (dann keine Uhr)
 * @param limitMs  Zeitbox des Szenarios
 * @param jetzt    Zeitstempel wie `Date.now()`
 */
export function uhrStand(lauf: ZeitLauf | null, limitMs: number, jetzt: number): UhrStand | null {
  if (!lauf || !Number.isFinite(new Date(lauf.createdAt).getTime())) return null;
  const vergangen = gespraechsZeitMs(lauf, jetzt);
  const restMs = Math.max(0, limitMs - vergangen);
  return {
    restMs,
    text: `${Math.floor(restMs / 60_000)}:${String(Math.floor((restMs % 60_000) / 1000)).padStart(2, '0')}`,
    restMin: Math.ceil(restMs / 60_000),
    warn: vergangen >= limitMs * UHR_WARN_ANTEIL,
    um: restMs === 0,
    angehalten: restMs > 0 && pauseLaeuft(lauf, jetzt),
  };
}
