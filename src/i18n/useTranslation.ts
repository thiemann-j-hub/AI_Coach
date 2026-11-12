"use client";

import { createContext, useContext } from "react";
import type { Dictionary } from "./dictionaries";
import type { ActiveLanguage } from "./load-dictionary";

/**
 * Paket 6, C21 (12.11.2026): Aktive Sprache samt Wörterbuch. Der AuthProvider im Wurzel-Layout setzt beides
 * zusammen: zuerst das Wörterbuch vom Server, nach einem Sprachwechsel das nachgeladene. Vorher zog dieser
 * Hook alle 22 Wörterbücher in fast jede Seite.
 */
export const TranslationContext = createContext<ActiveLanguage | null>(null);

/**
 * Returns the full dictionary for the active locale.
 *
 * Usage:
 *   const { t } = useTranslation();
 *   t.common.loading   // → "Laden…" (de) / "Loading…" (en) / …
 *   t.analyze.title     // → "Analyse" / "Analysis" / …
 */
export function useTranslation(): { t: Dictionary; locale: string } {
  const active = useContext(TranslationContext);
  // Ohne Provider gibt es kein Wörterbuch. Das Wurzel-Layout umschließt jede Seite, der Fall ist ein Baufehler.
  if (!active) throw new Error("useTranslation: AuthProvider fehlt (er steht im Wurzel-Layout).");
  return active;
}
