/**
 * Locale cookie helpers.
 *
 * Einziger Locale-Cookie ist NEXT_LOCALE. (Der frühere `__session`-Fallback
 * war ein Firebase-Hosting-CDN-Workaround — auf Azure obsolet und schädlich,
 * weil er NEXT_LOCALE überschreiben konnte.)
 */

import { defaultLocale, locales, type Locale } from "./config";

const MAX_AGE = 365 * 24 * 60 * 60; // 1 year

/** Read the current locale from cookies (client-side). */
export function getLocaleCookie(): Locale {
  if (typeof document === "undefined") return defaultLocale;

  const cookies = document.cookie.split("; ");
  const match = cookies.find((row) => row.startsWith("NEXT_LOCALE="));

  const value = match?.split("=")[1];
  if (value && locales.includes(value as Locale)) {
    return value as Locale;
  }
  return defaultLocale;
}

/** Write locale cookie (client-side). */
export function setLocaleCookie(locale: Locale): void {
  if (typeof document === "undefined") return;
  document.cookie = `NEXT_LOCALE=${locale};path=/;max-age=${MAX_AGE};samesite=lax`;
}

/** Detect the best locale from the browser's navigator.language. */
export function getBrowserLocale(): Locale {
  if (typeof navigator === "undefined") return defaultLocale;
  const browserLang = navigator.language?.split("-")[0];
  if (browserLang && locales.includes(browserLang as Locale)) {
    return browserLang as Locale;
  }
  return defaultLocale;
}
