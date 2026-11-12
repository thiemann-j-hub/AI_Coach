/**
 * Preis vor dem Klick (Owner-GO 29.09.2026, Analyse COACH-CREDITS-PREISANALYSE):
 * Neben jeder kostenpflichtigen Coach-Aktion steht der MAXIMALE Paketpreis
 * („bis zu …") — fester Kurs 4,90 €/Credit (Starter, netto), identisch zu
 * Studio und Jobmap (K2, Blueprint CREDIT-MODELL-FINAL 02.09.). Kein Ledger-
 * Lookup; größere Pakete sind real günstiger, die Anzeige verspricht also nie
 * zu wenig. Client-sicher (reine Daten + Intl).
 */
export const MAX_EUR_PER_CREDIT = 4.9;

/** Ein abgeschlossener Coach-Lauf (Analyse, Rollenspiel-Auswertung, Builder-Lauf). */
export const RUN_CREDITS = 1;

export function formatMaxEur(credits: number, locale: string): string {
  const eur = credits * MAX_EUR_PER_CREDIT;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(eur);
  } catch {
    return `${eur.toFixed(2)} €`;
  }
}

/**
 * „bis zu 4,90 €" in der Sprache der Oberfläche — `hintTemplate` ist
 * `t.common.maxEurHint` („bis zu {eur}").
 */
export function maxEurHint(hintTemplate: string, locale: string, credits: number = RUN_CREDITS): string {
  return hintTemplate.replace("{eur}", formatMaxEur(credits, locale));
}

/** Rolle im Arbeitsbereich, wie `/api/users/profile` sie liefert (`workspaceRole`). */
export type WorkspaceRole = "admin" | "member";

/**
 * U23 (Owner-Entscheid 12.11.2026): Den Eurobetrag sieht nur, wer kauft — Admins und eigene Konten ohne Firma
 * (im Register ebenfalls `admin`). Lernende, deren Firma zahlt (`member`), sehen nur die Credits.
 * `null` = Rolle nicht bestimmbar (Register ohne Auskunft): Der Betrag bleibt sichtbar, lieber zu viel
 * Preis-Klarheit als zu wenig. `undefined` = Rolle lädt noch: kein Betrag, damit er bei Lernenden nicht aufblitzt.
 * Dieselbe Grenze wie beim Kauf-Link (`/api/credits`: `member` bekommt keinen).
 */
export function showEurPrice(role: WorkspaceRole | null | undefined): boolean {
  return role === "admin" || role === null;
}

/**
 * Kostenhinweis mit oder ohne Eurobetrag. `template` enthält `{eur}`; `eurText` ist der fertige Betrag
 * (z. B. aus `maxEurHint`) oder null. Ohne Betrag fällt die Klammer um `{eur}` samt Leerzeichen davor weg
 * („… kostet 1 Credit ({eur}).“ → „… kostet 1 Credit.“). Steht `{eur}` nicht in einer Klammer, gibt es den Satz
 * nur wegen des Betrags: dann kommt ein leerer Text zurück, und die Zeile entfällt.
 */
export function costNote(template: string, eurText: string | null): string {
  if (eurText != null) return template.replace("{eur}", eurText);
  const ohne = template.replace(/\s*\([^()]*\{eur\}[^()]*\)/, "");
  return ohne.includes("{eur}") ? "" : ohne;
}
