/**
 * R7 (Master-Blueprint §3.3) — die REINE CSRF-Origin-Entscheidung.
 * Portiert aus ai-elearning-studio (dort C2b) als geteiltes, byte-gleiches Kit:
 * ein mutierender Request mit PRÄSENTER, FREMDER Origin wird geblockt. Bis R7
 * war der einzige CSRF-Schutz das SameSite=Lax-Cookie.
 *
 * Eigenes, import-freies Modul (Edge- UND Test-sicher): die Middleware ist die
 * einzige Datei, die andere Kernmodule zieht — die Ja/Nein-Logik lebt hier als
 * reine Funktion (Origin + erlaubte Origin reingereicht, kein Request, kein env).
 */

export const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Vom CSRF-Gate ausgenommen: next-auth (eigener CSRF-State), Webhooks (server-zu-
 * server, keine Browser-Origin, signaturgeprüft), Lerner-Route (HMAC-Token, kein
 * Cookie-Auth). SEGMENT-verankert `\/(api\/(auth|webhooks)|learn)(\/|$)` — trifft
 * nur GANZE Pfad-Segmente, nicht als Substring (kein „/api/authoring"-Footgun).
 * Unverankert am Anfang → basePath-robust (trifft „/api/auth/…" wie „/coach/api/auth/…").
 * (Coach/Jobmap haben keine /learn-Route → dieser Zweig matcht dort nie, harmlos.)
 */
const RE_CSRF_EXEMPT = /\/(api\/(auth|webhooks)|learn)(\/|$)/;

export function isCsrfExempt(pathname: string): boolean {
  return RE_CSRF_EXEMPT.test(pathname);
}

/**
 * true → die Anfrage ist ein CSRF-Verstoß und MUSS geblockt werden (403). Ein
 * Verstoß ist genau: eine MUTIERENDE, NICHT-ausgenommene Anfrage mit einer
 * PRÄSENTEN Origin, die NICHT die erlaubte (AUTH_URL-)Origin ist.
 *
 * Absichtlich fail-open bei:
 *   - GET/HEAD (nicht mutating → nicht CSRF-relevant),
 *   - ausgenommenen Pfaden,
 *   - fehlender Origin (server-zu-server / curl / native → kein Browser-CSRF-Vektor),
 *   - fehlender allowedOrigin (AUTH_URL unkonfiguriert → SameSite=Lax bleibt die Abwehr).
 * Eine KAPUTTE Origin (nicht parsebar) gilt als fremd → block.
 */
export function isCsrfViolation(args: {
  method: string;
  pathname: string;
  origin: string | null | undefined;
  allowedOrigin: string | null | undefined;
}): boolean {
  const { method, pathname, origin, allowedOrigin } = args;
  if (!MUTATING_METHODS.has(method)) return false;
  if (isCsrfExempt(pathname)) return false;
  if (!origin) return false;
  if (!allowedOrigin) return false;

  let requestOrigin: string | null;
  try {
    requestOrigin = new URL(origin).origin;
  } catch {
    requestOrigin = null; // kaputte Origin → als fremd behandeln
  }
  return requestOrigin !== allowedOrigin;
}
