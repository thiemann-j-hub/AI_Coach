/**
 * Paket 4, C13 (12.11.2026): EINE Uhr für das Gespräch. Zug-Route, Ticket-Route, Relais (Zeit-Regie),
 * Coach-Pause und der Browser (sichtbare Uhr) rechnen alle hiermit; vorher rechnete jede Stelle selbst ab
 * `createdAt`, und die Coach-Pause hielt die Uhr nicht an.
 *
 * Diese Datei hat bewusst KEINE Server-Abhängigkeit (kein `server-only`, keine Importe): Der Browser nutzt sie auch.
 */

/** Deckel je Coach-Pause: Danach läuft die Uhr von selbst weiter (keine endlose Pause). */
export const PAUSE_MAX_JE_PAUSE_MS = 5 * 60_000;
/** Deckel aller Pausen eines Laufs zusammen. */
export const PAUSE_MAX_GESAMT_MS = 15 * 60_000;

/** Die Felder des Laufs, aus denen die Uhr rechnet (Server-Dokument und Antwort von `start`/`get` passen beide). */
export interface ZeitLauf {
  createdAt: string;
  /** Summe der abgeschlossenen Pausen in Millisekunden. */
  pausedMs?: number | null;
  /** Beginn der laufenden Pause (ISO-Zeit); fehlt oder `null` = keine Pause. */
  pauseSince?: string | null;
}

function abgeschlossenMs(lauf: Pick<ZeitLauf, "pausedMs">): number {
  const v = lauf.pausedMs;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return 0;
  return Math.min(v, PAUSE_MAX_GESAMT_MS);
}

/**
 * Dauer der LAUFENDEN Pause bis `jetzt`, gedeckelt: höchstens 5 Minuten je Pause und nur so viel, wie vom
 * Gesamtdeckel (15 Minuten) noch übrig ist. Ohne laufende Pause 0.
 */
export function laufendePauseMs(lauf: Pick<ZeitLauf, "pausedMs" | "pauseSince">, jetzt: number): number {
  if (!lauf.pauseSince) return 0;
  const seit = new Date(lauf.pauseSince).getTime();
  if (!Number.isFinite(seit)) return 0;
  const rest = PAUSE_MAX_GESAMT_MS - abgeschlossenMs(lauf);
  return Math.max(0, Math.min(jetzt - seit, PAUSE_MAX_JE_PAUSE_MS, rest));
}

/** Alle Pausen zusammen (abgeschlossene plus laufende, gedeckelt). */
export function pausenMs(lauf: Pick<ZeitLauf, "pausedMs" | "pauseSince">, jetzt: number): number {
  return abgeschlossenMs(lauf) + laufendePauseMs(lauf, jetzt);
}

/**
 * Hält die Uhr in diesem Augenblick wirklich an? `false` auch dann, wenn `pauseSince` noch steht, die Pause aber
 * ihren Deckel erreicht hat (Seite mit offener Pause verlassen).
 */
export function pauseLaeuft(lauf: Pick<ZeitLauf, "pausedMs" | "pauseSince">, jetzt: number): boolean {
  if (!lauf.pauseSince) return false;
  const seit = new Date(lauf.pauseSince).getTime();
  if (!Number.isFinite(seit)) return false;
  const deckel = Math.min(PAUSE_MAX_JE_PAUSE_MS, PAUSE_MAX_GESAMT_MS - abgeschlossenMs(lauf));
  return deckel > 0 && jetzt - seit < deckel;
}

/**
 * Wie lange hält die laufende Pause die Uhr von `jetzt` an noch an (Millisekunden bis zum Deckel)? 0 = sie läuft nicht.
 * Das Relais stellt damit seinen Wecker, der die Pause am Deckel von selbst beendet.
 */
export function pauseRestMs(lauf: Pick<ZeitLauf, "pausedMs" | "pauseSince">, jetzt: number): number {
  if (!pauseLaeuft(lauf, jetzt)) return 0;
  const seit = new Date(lauf.pauseSince as string).getTime();
  const deckel = Math.min(PAUSE_MAX_JE_PAUSE_MS, PAUSE_MAX_GESAMT_MS - abgeschlossenMs(lauf));
  return Math.max(0, deckel - (jetzt - seit));
}

/**
 * Gesprächszeit in Millisekunden: `jetzt − createdAt − abgeschlossene Pausen − laufende Pause (gedeckelt)`.
 * `jetzt` ist ein Zeitstempel wie `Date.now()`. Nie negativ; bei unlesbarem `createdAt` 0.
 */
export function gespraechsZeitMs(lauf: ZeitLauf, jetzt: number): number {
  const start = new Date(lauf.createdAt).getTime();
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, jetzt - start - pausenMs(lauf, jetzt));
}

/**
 * Pause an- oder ausschalten, direkt am Lauf (für `updateSimulation`; wiederholbar). Route und Relais nutzen beide
 * genau diese Funktion. Rückgabe `false` = es gab nichts zu ändern.
 *  - an: setzt `pauseSince`, wenn keine Pause läuft. Eine abgelaufene alte Pause wird vorher verbucht.
 *    Ist der Gesamtdeckel erreicht, beginnt keine neue Pause (die Uhr läuft weiter).
 *  - aus: verbucht die laufende Pause (gedeckelt) auf `pausedMs` und löscht `pauseSince`.
 */
export function pauseSetzen(lauf: Pick<ZeitLauf, "pausedMs" | "pauseSince">, an: boolean, jetzt: number): boolean {
  if (an && pauseLaeuft(lauf, jetzt)) return false;
  let geaendert = false;
  if (lauf.pauseSince) {
    lauf.pausedMs = pausenMs(lauf, jetzt);
    lauf.pauseSince = null;
    geaendert = true;
  }
  if (an && abgeschlossenMs(lauf) < PAUSE_MAX_GESAMT_MS) {
    lauf.pauseSince = new Date(jetzt).toISOString();
    geaendert = true;
  }
  return geaendert;
}
