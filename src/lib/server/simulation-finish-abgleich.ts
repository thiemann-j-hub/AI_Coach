/**
 * Einordnung stehengebliebener Buchungs-Vermerke (Paket 2, C8, 12.11.2026) — für `scripts/credits-abgleich.mts`.
 * Reines Modul ohne I/O: Das Skript liest die Läufe, diese Funktion sagt, was ein Vermerk bedeutet und was zu tun ist.
 * Der Vermerk selbst (`openCharge`) wird in `simulation-finish.ts` gesetzt und ausgetragen.
 */

export interface OpenChargeRow {
  id: string;
  status: "active" | "finishing" | "finished" | "aborted";
  centralSpendTxId?: string | null;
  openCharge: { key: string; at: string; txId?: string | null; workspaceId?: string | null; refundFailedAt?: string | null };
}

export type OpenChargeLage =
  /** Jung und der Lauf ist aktiv oder wird gerade ausgewertet: Die Auswertung rechnet vermutlich noch. Kein Befund. */
  | "laeuft"
  /** Kein Beleg für eine Buchung: Der Credit-Dienst antwortete nicht klar, oder der Prozess endete vor der Antwort. */
  | "unbestaetigt"
  /** Gebucht, aber keine Auswertung gespeichert und keine Rückbuchung versucht (Prozess-Ende dazwischen). */
  | "gebucht-ohne-auswertung"
  /** Gebucht, Auswertung gescheitert, Rückbuchung gescheitert: Der Credit fehlt der Person. */
  | "rueckbuchung-gescheitert"
  /** Der Lauf ist ausgewertet und trägt genau diese Buchung: nur der Vermerk blieb liegen. Kein Geld offen. */
  | "gedeckt";

export const OPEN_CHARGE_HINWEIS: Record<OpenChargeLage, string> = {
  laeuft: "Auswertung rechnet vermutlich noch – später erneut prüfen.",
  unbestaetigt: "Im Credit-Dienst mit der Kennung prüfen, ob gebucht wurde. Wenn ja: zurückgeben, sofern die Person nicht erneut auswertet (der nächste Versuch trifft dieselbe Kennung).",
  "gebucht-ohne-auswertung": "Credit ist gebucht, die Auswertung fehlt. Wertet die Person erneut aus, wird die Buchung wiederverwendet; sonst mit der Buchungsnummer zurückgeben.",
  "rueckbuchung-gescheitert": "Credit ist gebucht, die Rückbuchung scheiterte. Wertet die Person erneut aus, wird die Buchung wiederverwendet; sonst mit der Buchungsnummer zurückgeben.",
  gedeckt: "Kein Geld offen: Die gespeicherte Auswertung trägt diese Buchung. Nur der Vermerk blieb stehen.",
};

/** Ab diesem Alter gilt ein Vermerk an einem aktiven Lauf nicht mehr als „rechnet noch“ (längste Auswertung: rund 6 Minuten). */
export const OPEN_CHARGE_MIN_MINUTES = 15;

export function openChargeLage(row: OpenChargeRow, now: Date = new Date(), minMinutes = OPEN_CHARGE_MIN_MINUTES): OpenChargeLage {
  const m = row.openCharge;
  if (row.status === "finished" && m.txId && row.centralSpendTxId === m.txId) return "gedeckt";
  if (m.refundFailedAt) return "rueckbuchung-gescheitert";
  const alterMin = (now.getTime() - new Date(m.at).getTime()) / 60_000;
  // Paket 3 (12.11.2026): Während der Rechnung steht der Lauf auf `finishing`. Bleibt er dort hängen, räumt
  // GET /api/simulation/status nach 6 Minuten auf (Rückbuchung); bis dahin gilt auch er als „rechnet noch“.
  const offen = row.status === "active" || row.status === "finishing";
  if (offen && Number.isFinite(alterMin) && alterMin < minMinutes) return "laeuft";
  return m.txId ? "gebucht-ohne-auswertung" : "unbestaetigt";
}
