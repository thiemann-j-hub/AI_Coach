"use client";

import { getLocaleCookie } from "@/i18n/locale-cookie";
import { withBasePath } from "@/lib/base-path";

/**
 * Headers für API-Calls. Auth läuft seit der Azure-Migration über das
 * HTTP-only-NextAuth-Session-Cookie (wird vom Browser automatisch
 * mitgeschickt) — es gibt KEINEN Bearer-Token mehr (Playbook Gotcha 15).
 * `x-locale` informiert die API über die UI-Sprache.
 */
export async function authHeaders(): Promise<HeadersInit> {
  const locale = getLocaleCookie();
  return {
    "Content-Type": "application/json",
    "x-locale": locale,
  };
}

/**
 * B26 (02.10.2026): Fenster-Ereignis, auf das der App-Rahmen die Meldung „Sitzung
 * abgelaufen" mit dem Knopf „Neu anmelden" zeigt (SessionExpiredBanner).
 */
export const SESSION_EXPIRED_EVENT = "pn:session-expired";

// Merker je geladener Seite: ein Rahmen, der erst NACH der Meldung entsteht (Seitenwechsel
// im Coach baut den Rahmen neu auf), zeigt sie trotzdem. Die neue Anmeldung lädt die Seite
// komplett neu — damit ist der Merker wieder leer.
let sessionExpiredSeen = false;

/** Wurde auf dieser Seite schon eine abgelaufene Anmeldung gemeldet? */
export function wasSessionExpiredSeen(): boolean {
  return sessionExpiredSeen;
}

/**
 * Meldet eine abgelaufene Anmeldung an den App-Rahmen: 401 mit code CENTRAL_REAUTH
 * (Login-Tor in requireAuth oder die Analyse). Liest eine KOPIE der Antwort — der
 * Aufrufer kann den Body weiterhin selbst lesen.
 */
function announceIfSessionExpired(res: Response): void {
  if (res.status !== 401 || typeof window === "undefined") return;
  res
    .clone()
    .json()
    .then((body: { code?: unknown } | null) => {
      if (body?.code !== "CENTRAL_REAUTH") return;
      sessionExpiredSeen = true;
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    })
    .catch(() => {
      /* kein JSON → keine Meldung */
    });
}

/**
 * Wrapper for fetch that includes locale header + session cookie.
 */
export async function authFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = await authHeaders();
  // basePath voranstellen: unter dem Front Door muss `/api/...` zu `/coach/api/...`
  // werden (Browser-fetch wird von Next NICHT automatisch umgeschrieben). Externe
  // URLs + bereits praefixte Pfade laesst withBasePath unangetastet.
  const res = await fetch(withBasePath(url), {
    ...options,
    credentials: "same-origin",
    headers: { ...headers, ...(options.headers ?? {}) },
  });
  announceIfSessionExpired(res);
  return res;
}
