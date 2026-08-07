import type { Locale } from "../config";

import en from "./en.json";
import de from "./de.json";
import fr from "./fr.json";
import it from "./it.json";
import es from "./es.json";
import pl from "./pl.json";
import cs from "./cs.json";
import pt from "./pt.json";
import ca from "./ca.json";
import nl from "./nl.json";
import sv from "./sv.json";
import da from "./da.json";
import nb from "./nb.json";
import fi from "./fi.json";
import et from "./et.json";
import lv from "./lv.json";
import hu from "./hu.json";
import ro from "./ro.json";
import el from "./el.json";
import ru from "./ru.json";
import uk from "./uk.json";
import ga from "./ga.json";

export type Dictionary = typeof en;

const dictionaries: Record<Locale, Dictionary> = {
  en,
  de,
  fr,
  it,
  es,
  pl,
  cs,
  pt,
  ca,
  nl,
  sv,
  da,
  nb,
  fi,
  et,
  lv,
  hu,
  ro,
  el,
  ru,
  uk,
  ga,
};

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale] ?? dictionaries.en;
}
