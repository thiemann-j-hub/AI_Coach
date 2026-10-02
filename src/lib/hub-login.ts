/**
 * Eine Anmeldung im Hub für alle Apps (Owner-GO 02.10.2026).
 *
 * Hinter der gemeinsamen Adresse (app.pulsenorth.ai, BASE_PATH gesetzt) liegt die
 * Anmeldekarte im Hub ("/"). Abgemeldete Besucher gehen dorthin und kommen nach der
 * Anmeldung auf die Seite zurück, die sie aufgerufen hatten (`/?next=<Pfad>`; der Hub
 * prüft das Ziel).
 *
 * Im Direktbetrieb (ohne BASE_PATH) gibt es keinen Hub davor — dann bleibt die eigene
 * Anmeldeseite des Coach zuständig.
 */
import { BASE_PATH } from "@/lib/base-path";
import { isMagicLinkOid } from "@/lib/magic-link-oid";

export function hubLoginEnabled(basePath: string = BASE_PATH): boolean {
  return basePath.length > 0;
}

/**
 * „Neu anmelden": über die Anmeldekarte im Hub statt direkt bei Microsoft?
 * (Anmeldung-Umbau Schritt 2c, 02.10.2026)
 *  - PulseNorth-Konto (Kennung "ml:…", Anmeldung ohne Microsoft): IMMER über den Hub —
 *    es hat kein Microsoft-Konto.
 *  - keine Sitzung bekannt: hinter der gemeinsamen Adresse ebenfalls über den Hub (dort
 *    stehen beide Wege zur Wahl).
 *  - Microsoft-Konto: wie bisher direkt zu Microsoft.
 */
export function reLoginViaHub(
  uid: string | null | undefined,
  basePath: string = BASE_PATH
): boolean {
  if (isMagicLinkOid(uid)) return true;
  return !uid && hubLoginEnabled(basePath);
}

/**
 * Adresse der Hub-Anmeldung mit Rücksprung. `target` ist ein Pfad der App, mit oder
 * ohne BASE_PATH davor ("/analyze" wie "/coach/analyze?x=1").
 */
export function hubLoginUrl(target: string, basePath: string = BASE_PATH): string {
  const path = target.startsWith("/") ? target : `/${target}`;
  const full =
    path === basePath || path.startsWith(`${basePath}/`) || path.startsWith(`${basePath}?`)
      ? path
      : basePath + path;
  return `/?next=${encodeURIComponent(full)}`;
}

/** Zur Hub-Anmeldung gehen; ohne Angabe ist die aktuelle Seite das Rücksprung-Ziel. */
export function goToHubLogin(target?: string): void {
  if (typeof window === "undefined") return;
  window.location.assign(
    hubLoginUrl(target ?? window.location.pathname + window.location.search)
  );
}

/**
 * Kontoauswahl nach dem Abmelden: gemeinsamer Merker aller Apps auf dieser Adresse
 * (Hub und Jobmap nutzen denselben Schlüssel). Steht er, fragt die Anmeldekarte im Hub
 * beim nächsten Anmelden nach dem Konto. Ohne nutzbaren Speicher passiert nichts.
 */
const ACCOUNT_CHOICE_KEY = "pn:konto-waehlen";

export function markAccountChoice(): void {
  try {
    window.localStorage.setItem(ACCOUNT_CHOICE_KEY, "1");
  } catch {
    /* ohne Speicher: bisheriges Verhalten */
  }
}

export function clearAccountChoice(): void {
  try {
    window.localStorage.removeItem(ACCOUNT_CHOICE_KEY);
  } catch {
    /* nichts zu tun */
  }
}
