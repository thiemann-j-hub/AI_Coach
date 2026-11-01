import "server-only";

import { consentGateOn, einwilligungFehlt, getCentralMemberInfo } from "@/lib/server/credits/member-info";

/**
 * Einwilligung „Sprachaufnahme“ (Go-Live Schritt 9 Stufe C, W5-4): EIN Tor vor jedem Mikrofon-Weg —
 * Sprach-Token (Diktat, Azure) und Live-Karte (Sprachmodus Live, Google, EU) fragen beide hier.
 * 01.11.2026 (Bewertung Teil 1, Owner-Ja): Seit der Fassung 2026-11-01 verlangt der Credit-Dienst die
 * Einwilligung für jedes Unternehmen; wer nur einer älteren Fassung zugestimmt hat, willigt einmal neu ein.
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
