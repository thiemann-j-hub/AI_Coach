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
  return fetch(withBasePath(url), {
    ...options,
    credentials: "same-origin",
    headers: { ...headers, ...(options.headers ?? {}) },
  });
}
