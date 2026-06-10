import type { Locale } from "../config";

import en from "./en.json";
import de from "./de.json";
import fr from "./fr.json";
import it from "./it.json";
import es from "./es.json";
import pl from "./pl.json";
import cs from "./cs.json";

export type Dictionary = typeof en;

const dictionaries: Record<Locale, Dictionary> = {
  en,
  de,
  fr,
  it,
  es,
  pl,
  cs,
};

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale] ?? dictionaries.en;
}
