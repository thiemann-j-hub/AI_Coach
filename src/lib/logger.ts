/**
 * Structured logger for server-side API routes.
 * Outputs JSON lines (App Service / Azure Monitor friendly).
 */

import "server-only";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...meta,
  };

  const line = JSON.stringify(entry);

  switch (level) {
    case "error":
      console.error(line);
      break;
    case "warn":
      console.warn(line);
      break;
    case "debug":
      console.debug(line);
      break;
    default:
      console.log(line);
  }
}

/** Höchstens so viele Aufruferzeilen und Zeichen des Stacks kommen ins Protokoll. */
export const STACK_MAX_FRAMES = 6;
export const STACK_MAX_CHARS = 1_200;

/**
 * Paket 6, C38 (12.11.2026): gekürzter Stack für das Protokoll. Vorher stand bei Fehlern nur die Meldung da,
 * die Stelle im Code fehlte. Nur die Aufruferzeilen („at …“), ohne die erste Zeile: Die Meldung steht schon in
 * `message`, und sie soll nicht doppelt ins Protokoll. Kein Error oder kein Stack → undefined. PURE (getestet).
 */
export function shortStack(err: unknown): string | undefined {
  if (!(err instanceof Error) || typeof err.stack !== "string") return undefined;
  const frames = err.stack
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("at "));
  if (!frames.length) return undefined;
  return frames.slice(0, STACK_MAX_FRAMES).join(" | ").slice(0, STACK_MAX_CHARS);
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit("debug", msg, meta),
  info:  (msg: string, meta?: Record<string, unknown>) => emit("info",  msg, meta),
  warn:  (msg: string, meta?: Record<string, unknown>) => emit("warn",  msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit("error", msg, meta),

  /** Log an API request lifecycle event */
  api(route: string, action: string, meta?: Record<string, unknown>) {
    emit("info", `[API] ${route} – ${action}`, { route, ...meta });
  },

  /** Log an error with optional Error object (C38: mit gekürztem Stack) */
  apiError(route: string, err: unknown, meta?: Record<string, unknown>) {
    const message = err instanceof Error ? err.message : String(err);
    emit("error", `[API] ${route} – ${message}`, {
      route,
      errorName: err instanceof Error ? err.name : undefined,
      stack: shortStack(err),
      ...meta,
    });
  },
};
