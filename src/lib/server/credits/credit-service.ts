import "server-only";

import { after } from "next/server";
import { auth } from "@/auth";
import { withTimeout, timeoutMs } from "@/lib/with-timeout";
import { logger } from "@/lib/logger";

/**
 * Client + Phase-1-Dual-Write-Schatten fuer den zentralen, app-uebergreifenden
 * CreditService (Strangler-Fig).
 *
 * PHASE 1 (Dual-Write): Das ALTE Coach-Ledger bleibt die Quelle der Wahrheit.
 * Nach jeder erfolgreichen credit-veraendernden Operation wird DIESELBE Operation
 * zusaetzlich als Schatten an den CreditService geschickt — mit der via
 * GET /resolve-workspace ermittelten ZENTRALEN workspaceId (NICHT lokal aus
 * getWorkspaceIdForUser ableiten). Ein Fehler hier darf den User-Flow NIE
 * abbrechen: alles ist try/catch-gekapselt und wird nur geloggt. Lesen (Balance)
 * laeuft in Phase 1 weiter AUSSCHLIESSLICH gegen das alte System.
 *
 * Komplett inert, solange CREDITS_CENTRAL != "on".
 */

export function creditsCentralEnabled(): boolean {
  return (process.env.CREDITS_CENTRAL ?? "off").toLowerCase() === "on";
}

const BASE_URL = (
  process.env.CREDIT_SERVICE_URL ?? "https://pulscraft-credit-service.azurewebsites.net/api"
).replace(/\/$/, "");

const CS_TIMEOUT_MS = timeoutMs("CREDIT_SERVICE_TIMEOUT_MS", 5_000);

export class CreditServiceError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "CreditServiceError";
  }
}

interface RequestOpts {
  body?: unknown;
  idempotencyKey?: string;
}

async function request<T>(
  token: string,
  method: "GET" | "POST",
  path: string,
  opts: RequestOpts = {}
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  const res = await withTimeout(
    fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      cache: "no-store",
    }),
    CS_TIMEOUT_MS,
    `credit-service ${method} ${path}`
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new CreditServiceError(res.status, `CreditService ${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json().catch(() => ({}))) as T;
}

// ---------------------------------------------------------------------------
// Low-level API (token explizit -> pur + testbar)
// ---------------------------------------------------------------------------

/** Zentrale Wahrheit: welcher Workspace gehoert diesem Token-Subjekt (oid). */
export async function resolveWorkspace(token: string): Promise<{ workspaceId: string }> {
  return request<{ workspaceId: string }>(token, "GET", "/resolve-workspace");
}

/** Liefert den zentralen Saldo. Contract: GET /credits -> { credits }. */
export async function getBalance(token: string, workspaceId: string): Promise<{ credits: number }> {
  return request<{ credits: number }>(token, "GET", `/workspaces/${encodeURIComponent(workspaceId)}/credits`);
}

/**
 * Verbraucht Credits (402 => zu wenig). Gleicher Contract wie refund: Body
 * { amount: positive GANZE Zahl, description? }, Header Idempotency-Key (Pflicht).
 */
export async function spend(
  token: string,
  workspaceId: string,
  opts: { amount: number; idempotencyKey: string; description?: string }
): Promise<{ balance?: number; transactionId?: string; idempotent?: boolean }> {
  return request(token, "POST", `/workspaces/${encodeURIComponent(workspaceId)}/credits/spend`, {
    body: { amount: opts.amount, description: opts.description },
    idempotencyKey: opts.idempotencyKey,
  });
}

/**
 * Erstattet Credits (Gegenstueck zu spend). FIXIERTER zentraler Contract:
 *   POST /workspaces/{id}/credits/refund
 *     Header: Authorization: Bearer <User-Token> ; Idempotency-Key (Pflicht)
 *     Body:   { amount: positive GANZE Zahl, description? }
 *     200 ->  { balance, transactionId, idempotent? }   (idempotent via Idempotency-Key)
 */
export async function refund(
  token: string,
  workspaceId: string,
  opts: { amount: number; idempotencyKey: string; description?: string }
): Promise<{ balance?: number; transactionId?: string; idempotent?: boolean }> {
  return request(token, "POST", `/workspaces/${encodeURIComponent(workspaceId)}/credits/refund`, {
    body: { amount: opts.amount, description: opts.description },
    idempotencyKey: opts.idempotencyKey,
  });
}

// ---------------------------------------------------------------------------
// Phase-1-Schatten-Schreiber (fire-and-forget, brechen NIE den User-Flow ab)
// ---------------------------------------------------------------------------

export interface ShadowOp {
  amount: number;
  idempotencyKey: string;
  /** Klartext-Vermerk: bei spend als `reason`, bei refund als `description` gesendet. */
  note?: string;
}

/**
 * Erfasst das Access-Token JETZT (im Request-Scope, garantiert verfuegbar) und
 * fuehrt resolve + spend/refund NACH der Antwort aus (after()), damit der Schatten
 * keine Latenz auf den User-Pfad legt. Faellt after() mangels Request-Scope aus,
 * laeuft es als detached Promise (Coach = persistenter App-Service-Node-Prozess).
 */
async function scheduleShadow(kind: "spend" | "refund", op: ShadowOp): Promise<void> {
  if (!creditsCentralEnabled()) return;

  let token: string | null = null;
  try {
    token = (await auth())?.accessToken ?? null;
  } catch {
    token = null;
  }

  const run = async () => {
    if (!token) {
      // Kein User-Token (sollte an den Coach-Refund/Spend-Stellen nie passieren,
      // da dort immer eine Session vorliegt) -> Schatten uebersprungen, geloggt.
      logger.api("credit-service", "shadow-skip", { reason: "no_token", kind, key: op.idempotencyKey });
      return;
    }
    try {
      const { workspaceId } = await resolveWorkspace(token);
      if (kind === "spend") {
        await spend(token, workspaceId, { amount: op.amount, idempotencyKey: op.idempotencyKey, description: op.note });
      } else {
        await refund(token, workspaceId, { amount: op.amount, idempotencyKey: op.idempotencyKey, description: op.note });
      }
      logger.api("credit-service", `shadow-${kind}-ok`, { workspaceId, key: op.idempotencyKey, amount: op.amount });
    } catch (e) {
      // 402/401/5xx/Timeout: NUR loggen — das alte System ist die Wahrheit.
      logger.apiError(`credit-service/shadow-${kind}`, e, { key: op.idempotencyKey, amount: op.amount });
    }
  };

  try {
    after(run);
  } catch {
    void run().catch(() => {});
  }
}

/** Schatten: Credit-Verbrauch (an reserve gehaengt — dort zieht das lokale Ledger). */
export async function shadowSpend(op: ShadowOp): Promise<void> {
  await scheduleShadow("spend", op);
}

/** Schatten: Credit-Erstattung (an jeder lokalen refundCredit-Stelle). */
export async function shadowRefund(op: ShadowOp): Promise<void> {
  await scheduleShadow("refund", op);
}
