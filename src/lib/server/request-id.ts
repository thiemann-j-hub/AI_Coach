/**
 * W1-2 (LXT-Welle W1, Owner-GO 14.10.2026): Fehler-Nummer in jeder Fehlermeldung — Coach-Fassung.
 * Vorbild LXT (Anhang E §3.4): X-Request-ID an jeder Fehlermeldung, dieselbe Kennung im Protokoll.
 * Die Middleware vergibt `x-request-id`; `aiErrorResponse` antwortet in der Coach-Hülle
 * `{ ok:false, code:"AI_ERROR", aiCode, error, requestId }` mit passendem Status.
 * Rückwege: AI_ERROR_CONTRACT=off (alte Antwort INTERNAL_ERROR/500), REQUEST_ID_IN_UI=off.
 */
import { NextResponse } from "next/server";
import { aiErrorContractOn, aiErrorHttpStatus, aiErrorTextDe, classifyAiError } from "@/lib/ai-errors";
import { logger } from "@/lib/logger";

export const REQUEST_ID_HEADER = "x-request-id";

export function requestIdInUiOn(): boolean {
  return (process.env.REQUEST_ID_IN_UI ?? "").trim().toLowerCase() !== "off";
}

export function newRequestId(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}

export function requestIdOf(req: { headers: { get(name: string): string | null } } | undefined | null): string {
  const h = req?.headers?.get(REQUEST_ID_HEADER)?.trim();
  if (h && /^[A-Za-z0-9._-]{6,64}$/.test(h)) return h;
  return newRequestId();
}

export function aiErrorResponse(
  err: unknown,
  req: { headers: { get(name: string): string | null } } | undefined | null,
  route: string
): NextResponse {
  const requestId = requestIdOf(req);
  const showId = requestIdInUiOn();
  const headers = showId ? { [REQUEST_ID_HEADER]: requestId } : undefined;
  logger.apiError(route, err, { requestId });
  if (!aiErrorContractOn()) {
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR", ...(showId ? { requestId } : {}) },
      { status: 500, headers }
    );
  }
  const info = classifyAiError(err);
  logger.error(`[rid ${requestId}] ai_error ${info.code}: ${info.detail}`, { route, requestId, aiCode: info.code });
  return NextResponse.json(
    { ok: false, code: "AI_ERROR", aiCode: info.code, error: aiErrorTextDe(info.code), ...(showId ? { requestId } : {}) },
    { status: aiErrorHttpStatus(info.code), headers }
  );
}
