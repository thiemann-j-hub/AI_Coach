import "server-only";

/**
 * USt-IdNr-Pruefung gegen das EU-VIES-System (REST-Endpoint).
 *
 * Bewusst best-effort + konservativ: Bei Netzfehler/Timeout/Unklarheit gilt die
 * ID als NICHT validiert -> der Aufrufer faellt dann auf die Inlands-Besteuerung
 * (19 %) zurueck statt faelschlich Reverse-Charge (0 %) zu gewaehren. Lieber zu
 * viel USt ausweisen und korrigieren als zu wenig.
 */

const VIES_BASE = "https://ec.europa.eu/taxation_customs/vies/rest-api/ms";
const TIMEOUT_MS = 6000;

/** EU-Mitgliedsstaaten (USt-IdNr-Laenderpraefixe). GR wird als EL gefuehrt. */
const EU_VAT_COUNTRIES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "HR",
  "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
]);

export interface VatCheckResult {
  /** Normalisierte Eingabe (ohne Leer-/Sonderzeichen, Uppercase). */
  vatId: string;
  countryCode: string | null;
  /** true nur bei eindeutig positiver VIES-Antwort. */
  valid: boolean;
  /** true, wenn VIES nicht erreichbar/unklar war (konservativ wie invalid behandeln). */
  inconclusive: boolean;
  checkedAt: string;
}

export function normalizeVatId(raw: string): { vatId: string; country: string | null; number: string | null } {
  const vatId = raw.replace(/[\s.-]/g, "").toUpperCase();
  const m = vatId.match(/^([A-Z]{2})([A-Z0-9]+)$/);
  if (!m) return { vatId, country: null, number: null };
  return { vatId, country: m[1], number: m[2] };
}

export function isEuVatCountry(country: string | null): boolean {
  return !!country && EU_VAT_COUNTRIES.has(country);
}

export async function checkVatId(raw: string): Promise<VatCheckResult> {
  const checkedAt = new Date().toISOString();
  const { vatId, country, number } = normalizeVatId(raw);

  if (!country || !number || !isEuVatCountry(country)) {
    return { vatId, countryCode: country, valid: false, inconclusive: false, checkedAt };
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${VIES_BASE}/${country}/vat/${number}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      return { vatId, countryCode: country, valid: false, inconclusive: true, checkedAt };
    }
    const data: any = await res.json();
    const valid = data?.isValid === true || data?.valid === true;
    return { vatId, countryCode: country, valid, inconclusive: false, checkedAt };
  } catch {
    // Timeout/Netzfehler -> inconclusive (konservativ: kein Reverse-Charge)
    return { vatId, countryCode: country, valid: false, inconclusive: true, checkedAt };
  } finally {
    clearTimeout(t);
  }
}
