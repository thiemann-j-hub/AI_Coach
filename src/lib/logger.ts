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

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit("debug", msg, meta),
  info:  (msg: string, meta?: Record<string, unknown>) => emit("info",  msg, meta),
  warn:  (msg: string, meta?: Record<string, unknown>) => emit("warn",  msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit("error", msg, meta),

  /** Log an API request lifecycle event */
  api(route: string, action: string, meta?: Record<string, unknown>) {
    emit("info", `[API] ${route} – ${action}`, { route, ...meta });
  },

  /** Log an error with optional Error object */
  apiError(route: string, err: unknown, meta?: Record<string, unknown>) {
    const message = err instanceof Error ? err.message : String(err);
    emit("error", `[API] ${route} – ${message}`, {
      route,
      errorName: err instanceof Error ? err.name : undefined,
      ...meta,
    });
  },
};
