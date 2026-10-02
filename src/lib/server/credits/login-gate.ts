/**
 * B26 (Rechte-Härtung, Owner-GO 02.10.2026): Ohne gültige Anmeldung erst neu anmelden.
 *
 * Vorher: Hatte die Sitzung kein gültiges Entra-Token mehr (abgelaufen, widerrufen oder
 * nie hinterlegt), gab das zentrale Register keine Auskunft und das Tor in requireAuth
 * wurde übersprungen. Eine deaktivierte Person oder jemand ohne Coach-Freigabe kam so
 * weiter an die kostenlosen Funktionen. Die bezahlte Analyse verlangte schon immer eine
 * neue Anmeldung (CENTRAL_REAUTH).
 *
 * Rückweg ohne Neu-Auslieferung: REQUIRE_VALID_LOGIN=off stellt das alte Verhalten wieder
 * her. Pro Aufruf gelesen. Reine Logik ohne Server-Importe (testbar).
 */
export function requireValidLoginEnabled(): boolean {
  return (process.env.REQUIRE_VALID_LOGIN ?? "on").toLowerCase() !== "off";
}

/** Ergebnis-Form des Token-Speichers, soweit sie hier interessiert. */
export type TokenOutcome =
  | { ok: true }
  | { ok: false; reason: "no-token" | "refresh-failed"; transient?: true };

/**
 * Muss sich die Person neu anmelden? Ja, wenn feststeht, dass kein gültiges Token mehr
 * zu bekommen ist: nie hinterlegt (`no-token`) oder von Entra abgelehnt (`refresh-failed`).
 * Nein bei einer Störung (`transient`): dann bleibt es beim bisherigen fail-soft.
 */
export function loginRequired(tok: TokenOutcome): boolean {
  return !tok.ok && tok.transient !== true;
}
