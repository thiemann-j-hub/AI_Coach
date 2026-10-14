"use client";
/**
 * W1-1/W1-2 (Coach): Fehlerantwort → Du-Text aus dem Wörterbuch (`aiErrors`) + „Fehler-Nr.“.
 * Reine Funktion für die Client-Seiten (SimulationClient, AnalyzeClient).
 */
import { isAiErrorCode } from "@/lib/ai-errors";

type AiErrorDict = { errorNumber: string } & Record<string, unknown>;

export function aiErrorMessage(
  dict: AiErrorDict,
  body: { aiCode?: unknown; requestId?: unknown } | null | undefined,
  res?: Response | null,
  fallback?: string
): string | null {
  const code = body?.aiCode;
  const rid =
    (typeof body?.requestId === "string" && body.requestId) ||
    res?.headers?.get("x-request-id") ||
    "";
  const idLine = rid ? " " + dict.errorNumber.replace("{id}", rid) : "";
  if (isAiErrorCode(code)) {
    const entry = dict[code] as { title?: string; next?: string } | undefined;
    if (entry?.title) return `${entry.title} ${entry.next ?? ""}`.trim() + idLine;
  }
  if (fallback) return fallback + idLine;
  return rid ? idLine.trim() : null;
}
