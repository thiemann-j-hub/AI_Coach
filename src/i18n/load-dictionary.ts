// Paket 6, C21 (12.11.2026): BROWSER-Zugriff auf die Wörterbücher. Hier steht kein Wörterbuch fest im Bündel:
// Jede Sprache ist ein eigener Chunk und wird erst geladen, wenn jemand sie wählt. Das Wörterbuch für den ersten
// Bildaufbau reicht das Wurzel-Layout vom Server herein (src/app/layout.tsx → AuthProvider).
// Der Server liest weiter alle Sprachen sofort aus ./dictionaries (server-only).
import { defaultLocale, locales, type Locale } from "./config";
import type { Dictionary } from "./dictionaries";

// Jede Zeile einzeln, damit der Bündler je Sprache einen eigenen Chunk baut (Name im Netzwerk-Reiter: i18n-de …).
const loaders: Record<Locale, () => Promise<{ default: Dictionary }>> = {
  en: () => import(/* webpackChunkName: "i18n-en" */ "./dictionaries/en.json"),
  de: () => import(/* webpackChunkName: "i18n-de" */ "./dictionaries/de.json"),
  fr: () => import(/* webpackChunkName: "i18n-fr" */ "./dictionaries/fr.json"),
  it: () => import(/* webpackChunkName: "i18n-it" */ "./dictionaries/it.json"),
  es: () => import(/* webpackChunkName: "i18n-es" */ "./dictionaries/es.json"),
  pl: () => import(/* webpackChunkName: "i18n-pl" */ "./dictionaries/pl.json"),
  cs: () => import(/* webpackChunkName: "i18n-cs" */ "./dictionaries/cs.json"),
  pt: () => import(/* webpackChunkName: "i18n-pt" */ "./dictionaries/pt.json"),
  ca: () => import(/* webpackChunkName: "i18n-ca" */ "./dictionaries/ca.json"),
  nl: () => import(/* webpackChunkName: "i18n-nl" */ "./dictionaries/nl.json"),
  sv: () => import(/* webpackChunkName: "i18n-sv" */ "./dictionaries/sv.json"),
  da: () => import(/* webpackChunkName: "i18n-da" */ "./dictionaries/da.json"),
  nb: () => import(/* webpackChunkName: "i18n-nb" */ "./dictionaries/nb.json"),
  fi: () => import(/* webpackChunkName: "i18n-fi" */ "./dictionaries/fi.json"),
  et: () => import(/* webpackChunkName: "i18n-et" */ "./dictionaries/et.json"),
  lv: () => import(/* webpackChunkName: "i18n-lv" */ "./dictionaries/lv.json"),
  hu: () => import(/* webpackChunkName: "i18n-hu" */ "./dictionaries/hu.json"),
  ro: () => import(/* webpackChunkName: "i18n-ro" */ "./dictionaries/ro.json"),
  el: () => import(/* webpackChunkName: "i18n-el" */ "./dictionaries/el.json"),
  ru: () => import(/* webpackChunkName: "i18n-ru" */ "./dictionaries/ru.json"),
  uk: () => import(/* webpackChunkName: "i18n-uk" */ "./dictionaries/uk.json"),
  ga: () => import(/* webpackChunkName: "i18n-ga" */ "./dictionaries/ga.json"),
};

/** Lädt das Wörterbuch einer Sprache nach. Unbekannte Sprache → Englisch, wie beim Server. */
export async function loadDictionary(locale: string): Promise<Dictionary> {
  const known = locales.includes(locale as Locale) ? (locale as Locale) : defaultLocale;
  return (await loaders[known]()).default;
}

export type ActiveLanguage = { locale: Locale; t: Dictionary };
export type SwitchResult =
  | { status: "ok"; t: Dictionary }
  // Eine spätere Anfrage hat diese überholt: Ihr Ergebnis gilt, dieses wird verworfen.
  | { status: "superseded" }
  // Laden gescheitert (Netz weg, Chunk nach einer Auslieferung nicht mehr da): Die alte Sprache bleibt.
  | { status: "failed" };

/**
 * Sprachwechsel ohne Durcheinander: Es gilt immer nur die jüngste Anfrage. Wer schnell zweimal wechselt
 * oder wessen Profil-Sprache gerade lädt, während er im Menü wählt, landet bei der zuletzt gewählten Sprache.
 * Was der Browser schon hat (die Sprache vom Server, frühere Wechsel), lädt er nicht noch einmal:
 * Der Weg zurück zur vorigen Sprache geht sofort und auch ohne Netz.
 */
export function createLanguageSwitcher(load: (locale: Locale) => Promise<Dictionary> = loadDictionary) {
  let latest = 0;
  const known = new Map<Locale, Dictionary>();
  return async function switchTo(locale: Locale, active: ActiveLanguage): Promise<SwitchResult> {
    const request = ++latest;
    known.set(active.locale, active.t);
    try {
      const t = known.get(locale) ?? (await load(locale));
      known.set(locale, t);
      return request === latest ? { status: "ok", t } : { status: "superseded" };
    } catch {
      return request === latest ? { status: "failed" } : { status: "superseded" };
    }
  };
}
