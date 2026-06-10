import { NextRequest, NextResponse } from "next/server";
import { locales, defaultLocale, type Locale } from "./i18n/config";

/**
 * Pick the best locale from the Accept-Language header.
 */
function getPreferredLocale(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return defaultLocale;

  const preferred = acceptLanguage
    .split(",")
    .map((lang) => lang.split(";")[0].trim().split("-")[0])
    .find((lang) => locales.includes(lang as Locale));

  return (preferred as Locale) || defaultLocale;
}

export function middleware(request: NextRequest) {
  // Skip API routes and static assets
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Check each cookie individually – __session may contain a Firebase Auth JWT,
  // so we must validate each value is actually a known locale.
  const nextLocale = request.cookies.get("NEXT_LOCALE")?.value;
  if (nextLocale && locales.includes(nextLocale as Locale)) {
    return NextResponse.next();
  }

  const sessionLocale = request.cookies.get("__session")?.value;
  if (sessionLocale && locales.includes(sessionLocale as Locale)) {
    return NextResponse.next();
  }

  // First visit: detect locale from Accept-Language header and set NEXT_LOCALE only.
  // We do NOT overwrite __session here because it may hold a Firebase Auth token.
  const detected = getPreferredLocale(
    request.headers.get("accept-language")
  );

  const response = NextResponse.next();
  response.cookies.set("NEXT_LOCALE", detected, {
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
    sameSite: "lax",
  });

  return response;
}

export const config = {
  matcher: ["/((?!_next|favicon.ico|.*\\..*).*)"],
};
