import "server-only";

import { consentGateOn, einwilligungFehlt, getCentralMemberInfo } from "@/lib/server/credits/member-info";

/**
 * Einwilligung „Sprachaufnahme“ (Go-Live Schritt 9 Stufe C, W5-4): EIN Tor vor jedem Mikrofon-Weg —
 * Sprach-Token (Diktat, Azure) und Live-Karte (Sprachmodus Live, Google, EU) fragen beide hier.
 * 01.11.2026 (Owner: „nicht übertreiben, das macht kein Wettbewerber“): Der Credit-Dienst verlangt für das Sprechen
 * keine Bestätigung mehr (Typ sprachaufnahme ist ein Hinweis, gilt nicht als Pflicht). Das Tor bleibt für den Fall,
 * dass sie wieder verlangt wird; vor dem ersten Mikrofon zeigt der Coach seinen eigenen Hinweis.
 * true = die Einwilligung fehlt und das Unternehmen verlangt sie. Fehler → durchlassen (fail-soft,
 * mit Protokoll). Rückweg: CONSENT_GATE=off.
 */
export async function sprachaufnahmeEinwilligungFehlt(oid: string | null | undefined): Promise<boolean> {
  if (!consentGateOn() || !oid) return false;
  try {
    return einwilligungFehlt(await getCentralMemberInfo(oid), "sprachaufnahme");
  } catch (e) {
    console.error("[sprachaufnahme] einwilligung", e instanceof Error ? e.message : e);
    return false;
  }
}
