"use client";

import { useAuth } from "@/providers/auth-provider";
import { getDictionary, type Dictionary } from "./dictionaries";

/**
 * Returns the full dictionary for the active locale.
 *
 * Usage:
 *   const { t } = useTranslation();
 *   t.common.loading   // → "Laden…" (de) / "Loading…" (en) / …
 *   t.analyze.title     // → "Analyse" / "Analysis" / …
 */
export function useTranslation(): { t: Dictionary } {
  const { locale } = useAuth();
  return { t: getDictionary(locale) };
}
