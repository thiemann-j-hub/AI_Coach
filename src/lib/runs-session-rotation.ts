/**
 * B30 (Rechte-Härtung, Owner-GO 02.10.2026) — Seite „Verlauf": Wann darf sie nach einer
 * Absage von /api/runs/list still auf eine frische Sitzungs-Kennung wechseln?
 *
 * Der Wechsel heilt einen alten localStorage-Wert eines anderen Kontos (Owner-Fund
 * 04.08.). Vorher löste ihn aber JEDES 403/400 aus — auch „Konto deaktiviert" und
 * „Coach nicht freigeschaltet". Die frische Kennung bekam dieselbe Absage, die Seite
 * wechselte wieder und fragte ohne Ende nach.
 *
 * Regel: höchstens EIN Wechsel je Seitenaufruf, und nie bei einer Sperre des Kontos —
 * die wird angezeigt.
 */
const ACCOUNT_REFUSALS = new Set(["ACCOUNT_DISABLED", "APP_NOT_ENABLED"]);

export function shouldRotateSession(status: number, code: unknown, alreadyRotated: boolean): boolean {
  if (alreadyRotated) return false;
  if (status !== 403 && status !== 400) return false;
  return !(typeof code === "string" && ACCOUNT_REFUSALS.has(code));
}
