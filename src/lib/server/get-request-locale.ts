import { NextRequest } from "next/server";
import { defaultLocale, locales, type Locale } from "@/i18n/config";

/**
 * Extract the locale from an incoming API request.
 *
 * Priority:
 *  1. `x-locale` header (set by the client-side API layer)
 *  2. `__session` cookie (Firebase Hosting)
 *  3. `NEXT_LOCALE` cookie (local dev)
 *  4. defaultLocale fallback
 */
export function getRequestLocale(req: NextRequest): Locale {
  // 1. Explicit header
  const header = req.headers.get("x-locale");
  if (header && locales.includes(header as Locale)) {
    return header as Locale;
  }

  // 2. Cookies
  const session = req.cookies.get("__session")?.value;
  if (session && locales.includes(session as Locale)) {
    return session as Locale;
  }

  const next = req.cookies.get("NEXT_LOCALE")?.value;
  if (next && locales.includes(next as Locale)) {
    return next as Locale;
  }

  return defaultLocale;
}
