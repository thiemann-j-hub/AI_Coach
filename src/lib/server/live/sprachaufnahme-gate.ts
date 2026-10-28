import "server-only";

import { consentGateOn, einwilligungFehlt, getCentralMemberInfo } from "@/lib/server/credits/member-info";

/**
 * Einwilligung „Sprachaufnahme“ (Go-Live Schritt 9 Stufe C, W5-4): dieselbe Prüfung wie vor dem
 * Sprach-Token — im Sprachmodus Live geht die Stimme ebenfalls an einen Verarbeiter (Google, EU).
 * true = die Einwilligung fehlt und das Unternehmen verlangt sie. Fehler → durchlassen (fail-soft
 * wie beim Sprach-Token, mit Protokoll). Rückweg: CONSENT_GATE=off.
 */
export async function sprachaufnahmeEinwilligungFehlt(oid: string | null | undefined): Promise<boolean> {
  if (!consentGateOn() || !oid) return false;
  try {
    return einwilligungFehlt(await getCentralMemberInfo(oid), "sprachaufnahme");
  } catch (e) {
    console.error("[live-ticket] einwilligung", e instanceof Error ? e.message : e);
    return false;
  }
}
