import { NextRequest } from "next/server";
import { defaultLocale, locales, type Locale } from "@/i18n/config";
import { getDictionary, type Dictionary } from "@/i18n/dictionaries";

/**
 * Extract the locale from an incoming API request.
 *
 * Priority:
 *  1. `x-locale` header (set by the client-side API layer)
 *  2. `NEXT_LOCALE` cookie
 *  3. defaultLocale fallback
 */
export function getRequestLocale(req: NextRequest | Request): Locale {
  // 1. Explicit header
  const header = req.headers.get("x-locale");
  if (header && locales.includes(header as Locale)) {
    return header as Locale;
  }

  // 2. Cookie (only available on NextRequest)
  const cookies = (req as NextRequest).cookies;
  if (cookies && typeof cookies.get === "function") {
    const next = cookies.get("NEXT_LOCALE")?.value;
    if (next && locales.includes(next as Locale)) {
      return next as Locale;
    }
  }

  return defaultLocale;
}

/**
 * Localized strings for user-facing API error responses,
 * resolved from the request's locale (x-locale header / cookies).
 */
export function getApiMessages(req: NextRequest | Request): Dictionary["api"] {
  return getDictionary(getRequestLocale(req)).api;
}
