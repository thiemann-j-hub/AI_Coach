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

/** Kurze Kennung ohne verwechselbare Zeichen (Edge-sicher, Web Crypto). */
function shortId(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
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
  // Hinter dem basePath (/coach) trägt pathname das Präfix — deshalb Regex statt startsWith (W1-2-Befund 14.10.).
  if (/\/api(\/|$)/.test(request.nextUrl.pathname)) {
    // W1-2 (14.10.2026): Fehler-Nummer — jede API-Anfrage bekommt eine x-request-id (vorhandene bleibt),
    // Routen loggen sie, Fehlerantworten tragen sie. Rückweg REQUEST_ID_IN_UI=off: nur im Protokoll.
    const incoming = request.headers.get("x-request-id")?.trim();
    const rid = incoming && /^[A-Za-z0-9._-]{6,64}$/.test(incoming) ? incoming : shortId();
    const headers = new Headers(request.headers);
    headers.set("x-request-id", rid);
    const res = NextResponse.next({ request: { headers } });
    if ((process.env.REQUEST_ID_IN_UI ?? "").trim().toLowerCase() !== "off") res.headers.set("x-request-id", rid);
    return res;
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
