// 22 Sprachen (Owner-Vorgabe 07.08.): dieselben wie die Erklärvideo-Übersetzungen
// und der Hub. Reihenfolge: Bestand zuerst (Kompatibilität), dann die Neuen.
export const locales = [
  "en", "de", "fr", "it", "es", "pl", "cs",
  "pt", "ca", "nl", "sv", "da", "nb", "fi", "et", "lv", "hu", "ro", "el", "ru", "uk", "ga",
] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export const localeNames: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
  fr: "Français",
  it: "Italiano",
  es: "Español",
  pl: "Polski",
  cs: "Čeština",
  pt: "Português",
  ca: "Català",
  nl: "Nederlands",
  sv: "Svenska",
  da: "Dansk",
  nb: "Norsk",
  fi: "Suomi",
  et: "Eesti",
  lv: "Latviešu",
  hu: "Magyar",
  ro: "Română",
  el: "Ελληνικά",
  ru: "Русский",
  uk: "Українська",
  ga: "Gaeilge",
};

/** BCP 47 tags for html lang attribute */
export const localeBcp47: Record<Locale, string> = {
  en: "en-US",
  de: "de-DE",
  fr: "fr-FR",
  it: "it-IT",
  es: "es-ES",
  pl: "pl-PL",
  cs: "cs-CZ",
  pt: "pt-PT",
  ca: "ca-ES",
  nl: "nl-NL",
  sv: "sv-SE",
  da: "da-DK",
  nb: "nb-NO",
  fi: "fi-FI",
  et: "et-EE",
  lv: "lv-LV",
  hu: "hu-HU",
  ro: "ro-RO",
  el: "el-GR",
  ru: "ru-RU",
  uk: "uk-UA",
  ga: "ga-IE",
};
