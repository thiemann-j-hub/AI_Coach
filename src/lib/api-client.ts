"use client";

import { auth } from "./firebaseClient";
import { getLocaleCookie } from "@/i18n/locale-cookie";

/**
 * Returns headers with Firebase ID token for authenticated API calls.
 * Also includes `x-locale` so API routes know the user's language.
 */
export async function authHeaders(): Promise<HeadersInit> {
  const locale = getLocaleCookie();
  const base: Record<string, string> = {
    "Content-Type": "application/json",
    "x-locale": locale,
  };

  const user = auth.currentUser;
  if (!user) return base;

  try {
    const token = await user.getIdToken();
    return { ...base, Authorization: `Bearer ${token}` };
  } catch {
    return base;
  }
}

/**
 * Wrapper for fetch that automatically includes auth headers.
 */
export async function authFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = await authHeaders();
  return fetch(url, {
    ...options,
    headers: { ...headers, ...(options.headers ?? {}) },
  });
}
