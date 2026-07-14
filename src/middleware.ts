import { NextRequest, NextResponse } from "next/server";
import { locales, defaultLocale, type Locale } from "./i18n/config";
import { isCsrfViolation } from "@/lib/server/csrf-origin";

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

/** R7: erlaubte Origin = die des konfigurierten AUTH_URL (Edge-safe, deterministisch).
 *  Hinter Front Door ist der Host-Header unzuverlässig; die Browser-Origin ist dagegen
 *  IMMER die öffentliche AUTH_URL-Origin. Fehlt AUTH_URL → fail-open (SameSite=Lax bleibt). */
function allowedOrigin(): string | null {
  const raw = process.env.AUTH_URL || process.env.NEXTAUTH_URL || "";
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest) {
  // R7 (Master-Blueprint §3.3): CSRF-Origin-Check (mutating-only) — vor allem
  // anderen, auch vor dem /api-Skip, damit mutierende API-Calls ihn durchlaufen.
  if (
    isCsrfViolation({
      method: request.method,
      pathname: request.nextUrl.pathname,
      origin: request.headers.get("origin"),
      allowedOrigin: allowedOrigin(),
    })
  ) {
    return NextResponse.json(
      { error: "Cross-origin request blocked (CSRF protection)" },
      { status: 403 }
    );
  }

  // Skip API routes and static assets (Locale-Handling nur für Seiten)
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const nextLocale = request.cookies.get("NEXT_LOCALE")?.value;
  if (nextLocale && locales.includes(nextLocale as Locale)) {
    return NextResponse.next();
  }

  // First visit: detect locale from Accept-Language header and set NEXT_LOCALE.
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
  matcher: [
    "/((?!_next|favicon.ico|.*\\..*).*)",
    // R7 (C2c-Härtung): API IMMER durch die MW — auch mit Punkt im Segment, sonst
    // umginge z.B. POST /api/account/abc.x den CSRF-Check (der Punkt-Ausschluss oben
    // startete die MW gar nicht). Additiv; API überspringt Locale bereits im Code.
    "/api/:path*",
  ],
};
