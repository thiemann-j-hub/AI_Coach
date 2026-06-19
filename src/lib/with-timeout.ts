/**
 * Transport-agnostischer Timeout-Wrapper. Bound externe Calls (LLM/Pinecone),
 * deren SDKs keine AbortSignal/Timeout-Option sauber durchreichen: ein Promise.race
 * gegen einen Timeout, der mit TimeoutError rejected. Das unterliegende Request
 * laeuft ggf. im Hintergrund weiter, aber der HTTP-Handler wird freigegeben —
 * verhindert, dass ein haengender Gemini-Call den Worker (und einen offenen
 * Credit-Hold) bis zum Azure-Default (~230s) blockiert.
 */

export class TimeoutError extends Error {
  readonly code = "TIMEOUT";
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

/** Liest einen ms-Timeout aus ENV mit Fallback (z. B. LLM_TIMEOUT_MS). */
export function timeoutMs(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * withTimeout + begrenzter Retry. `factory` erzeugt je Versuch einen FRISCHEN
 * Call (wichtig: ein bereits rejectetes Promise lässt sich nicht erneut awaiten).
 * Heilt transiente Fehler (z. B. Kaltstart-Timeout des LLM beim 1. Request) —
 * der teure Call wird nur bei tatsaechlichem Fehlschlag wiederholt.
 */
export async function withRetry<T>(
  factory: () => Promise<T>,
  opts: { ms: number; label: string; retries?: number }
): Promise<T> {
  const retries = opts.retries ?? 1;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withTimeout(factory(), opts.ms, opts.label);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
