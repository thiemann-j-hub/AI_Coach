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
