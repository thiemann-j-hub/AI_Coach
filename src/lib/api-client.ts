"use client";

import { getLocaleCookie } from "@/i18n/locale-cookie";

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
  return fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: { ...headers, ...(options.headers ?? {}) },
  });
}
