/**
 * Refund-Affordanz beim Löschen eines Runs — geteilte SSOT für Server und Client.
 *
 * Der ECHTE Refund passiert ausschließlich serverseitig in /api/runs/delete
 * (zentraler CreditService, gebunden an run.centralSpendTxId). Dieses Modul
 * bündelt die beiden Zutaten, damit UI-Versprechen und Server-Verhalten nie
 * auseinanderlaufen:
 *
 * - refundEligibleOnDelete: der Run ist grundsätzlich erstattbar (zentraler
 *   Pfad aktiv UND spend-Transaktion gespeichert) → Feld `refundOnDelete`
 *   in /api/runs/get.
 * - refundWindowFrom: das Kulanzfenster ab createdAt — DIESELBE Rechnung
 *   entscheidet in /api/runs/delete über den Refund und im Delete-Button
 *   über die Anzeige.
 *
 * Bewusst ohne Server-Imports (kein "server-only"), damit der Client-Button
 * dieselben Konstanten/Regeln nutzen kann.
 */

/** Kulanz-Fenster: Credit-Rückgabe bei Löschung innerhalb von 10 Minuten. */
export const REFUND_WINDOW_MS = 10 * 60 * 1000;

/**
 * Grundsätzliche Erstattbarkeit eines Runs (zeitunabhängig): exakt die
 * Bedingung, unter der /api/runs/delete im Fenster real zentral erstattet —
 * CREDITS_CENTRAL an UND der Run trägt die spend-Transaktion als Anker.
 * Alt-Runs ohne txId (lokaler/gratis Pfad) sind nie zentral erstattbar.
 */
export function refundEligibleOnDelete(
  creditsCentral: boolean,
  centralSpendTxId: string | null | undefined
): boolean {
  return creditsCentral && !!centralSpendTxId;
}

/**
 * Fensterrechnung ab createdAt (ISO-String). Ungültiges/fehlendes createdAt
 * ⇒ nie im Fenster (fail-closed: lieber keine Erstattung versprechen).
 * windowEndsAtMs dient der Anzeige „Erstattung bis HH:MM“.
 */
export function refundWindowFrom(
  createdAt: string | null | undefined,
  nowMs: number
): { withinWindow: boolean; windowEndsAtMs: number | null } {
  const createdMs = createdAt ? new Date(createdAt).getTime() : NaN;
  const ageMs = nowMs - createdMs;
  return {
    withinWindow: Number.isFinite(ageMs) && ageMs <= REFUND_WINDOW_MS,
    windowEndsAtMs: Number.isFinite(createdMs) ? createdMs + REFUND_WINDOW_MS : null,
  };
}
