/**
 * Micro-Transfer (Blueprint COACH-OPTIMIERUNG 27.09.2026, O2; Gemini Zu 3/4,
 * Owner E-4): EIN Schritt fürs echte Gespräch, vom Debrief vorgeschlagen,
 * vom Lernenden ggf. angepasst — und beim nächsten Login EINE Nachfrage.
 * Reines Modul (kein I/O): Vertrag + Texte, von Routen, Flow und UI geteilt.
 */

export type TransferOutcome = "done" | "partly" | "not" | "dismissed";

export interface Commitment {
  text: string;
  /** model = Vorschlag des Debriefs unverändert; user = vom Lernenden angepasst. */
  source: "model" | "user";
  createdAt: string;
  /** Freie Zeitangabe des Debriefs („morgen“, „bis Freitag“). */
  dueHint?: string | null;
}

export interface TransferCheck {
  outcome: TransferOutcome;
  note?: string | null;
  at: string;
}

export const COMMITMENT_MAX_CHARS = 300;
export const TRANSFER_NOTE_MAX_CHARS = 300;

/** Frühestens nach so vielen Stunden wird nachgefragt (Owner: nur beim Login, keine Mails). */
export function transferCheckMinHours(): number {
  const raw = Number(process.env.TRANSFER_CHECK_MIN_HOURS ?? "72");
  return Number.isFinite(raw) && raw >= 0 ? raw : 72;
}

export function isTransferOutcome(v: unknown): v is TransferOutcome {
  return v === "done" || v === "partly" || v === "not" || v === "dismissed";
}

/**
 * Kontextzeile für das nächste Debrief: Vorsatz + Rückmeldung aus dem Alltag.
 * `dismissed` liefert nichts — wer nicht gefragt werden wollte, bekommt es
 * auch nicht ins Debrief gespiegelt.
 */
export function buildTransferReviewText(args: {
  lang: string;
  commitmentText: string;
  outcome: TransferOutcome;
  note?: string | null;
}): string {
  if (args.outcome === "dismissed") return "";
  const text = String(args.commitmentText ?? "").trim();
  if (!text) return "";
  const note = String(args.note ?? "").trim();
  const en = args.lang === "en";
  const outcome =
    args.outcome === "done"
      ? en ? "tried it" : "hat es ausprobiert"
      : args.outcome === "partly"
        ? en ? "tried it partly" : "hat es teilweise ausprobiert"
        : en ? "did not get to it" : "ist nicht dazu gekommen";
  return en
    ? `Intention after the last debrief: "${text}" — the learner reports: ${outcome}${note ? ` ("${note}")` : ""}.`
    : `Vorsatz nach dem letzten Debrief: „${text}“ — der/die Lernende meldet zurück: ${outcome}${note ? ` („${note}“)` : ""}.`;
}
