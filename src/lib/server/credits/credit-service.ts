import "server-only";

import { auth } from "@/auth";
import { withTimeout, timeoutMs } from "@/lib/with-timeout";
import { logger } from "@/lib/logger";

/**
 * Client + Cutover-Helfer fuer den zentralen, app-uebergreifenden CreditService.
 *
 * CREDITS_CENTRAL=on (Read-/Write-Cutover): der zentrale Wallet ist die Quelle
 * der Wahrheit. Coach LIEST den Saldo zentral (getBalance -> credits), VERBRAUCHT
 * zentral (spend, transactionId wird je runId gespeichert) und ERSTATTET zentral
 * (refund MIT spendTransactionId). Die workspaceId kommt IMMER aus
 * GET /resolve-workspace (Membership greift dann serverseitig automatisch).
 *
 * CREDITS_CENTRAL=off: komplett inert — Coach laeuft unveraendert auf dem lokalen
 * Ledger (kein zentraler Call). Diese Helfer werden dann nirgends aufgerufen.
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
 *     Body:   { amount: positive GANZE Zahl, description, spendTransactionId }
 *             spendTransactionId = transactionId aus der spend-Antwort (PFLICHT!).
 *     200 ->  { balance, transactionId, idempotent? }
 *     422 no_matching_charge / refund_exceeds_charge ; 400 missing_spend_reference ; 403
 */
export async function refund(
  token: string,
  workspaceId: string,
  opts: { amount: number; idempotencyKey: string; description: string; spendTransactionId: string }
): Promise<{ balance?: number; transactionId?: string; idempotent?: boolean }> {
  return request(token, "POST", `/workspaces/${encodeURIComponent(workspaceId)}/credits/refund`, {
    body: { amount: opts.amount, description: opts.description, spendTransactionId: opts.spendTransactionId },
    idempotencyKey: opts.idempotencyKey,
  });
}

// ---------------------------------------------------------------------------
// Cutover-Helfer (CREDITS_CENTRAL=on): direkt, awaited, gating. Token aus der
// aktuellen Session (auth()); workspaceId IMMER aus /resolve-workspace.
// ---------------------------------------------------------------------------

async function accessToken(): Promise<string | null> {
  try {
    // auth() triggert den jwt-Callback -> ein abgelaufenes Token wird hier per
    // refresh_token erneuert. Schlaegt der Refresh fehl (error="RefreshFailed"),
    // KEIN toter Bearer mehr weiterreichen -> fail-closed (Re-Login statt 401).
    const s = await auth();
    if (!s || s.error === "RefreshFailed") return null;
    return s.accessToken ?? null;
  } catch {
    return null;
  }
}

export type CentralReserveResult =
  | { ok: true; workspaceId: string; transactionId?: string; balance?: number }
  | { ok: false; reason: "insufficient"; workspaceId: string }
  | { ok: false; reason: "no_token" | "error"; status?: number };

/**
 * ON-Pfad-Reservierung: resolve-workspace + zentral spend(1). Direkt (kein
 * Schatten) und blockierend — der Verbrauch ist der Gate. Gibt bei 402 die
 * Paywall-Info (insufficient) zurueck, bei fehlendem Token/Fehler einen
 * fail-closed-Marker (kein Gratis-Run bei Stoerung des zentralen Dienstes).
 * Die zurueckgegebene transactionId MUSS je runId gespeichert werden (Refund-Bindung).
 */
export async function centralReserve(opts: { runId: string }): Promise<CentralReserveResult> {
  const token = await accessToken();
  if (!token) return { ok: false, reason: "no_token" };

  let workspaceId: string;
  try {
    ({ workspaceId } = await resolveWorkspace(token));
  } catch (e) {
    logger.apiError("credit-service/centralReserve/resolve", e, { runId: opts.runId });
    return { ok: false, reason: "error", status: e instanceof CreditServiceError ? e.status : undefined };
  }

  try {
    const r = await spend(token, workspaceId, {
      amount: 1,
      idempotencyKey: `spend:${opts.runId}`,
      description: `coach:consume:${opts.runId}`,
    });
    return { ok: true, workspaceId, transactionId: r.transactionId, balance: r.balance };
  } catch (e) {
    if (e instanceof CreditServiceError && e.status === 402) {
      return { ok: false, reason: "insufficient", workspaceId };
    }
    logger.apiError("credit-service/centralReserve/spend", e, { runId: opts.runId });
    return { ok: false, reason: "error", status: e instanceof CreditServiceError ? e.status : undefined };
  }
}

/**
 * ON-Pfad-Erstattung: resolve-workspace + zentral refund MIT spendTransactionId
 * (Pflicht). Fail-soft fuer den HTTP-Flow (gibt ok:false zurueck statt zu werfen),
 * der Aufrufer entscheidet ueber refundPending/Retry.
 */
export async function centralRefund(opts: {
  amount: number;
  description: string;
  spendTransactionId: string;
  idempotencyKey: string;
}): Promise<{ ok: boolean }> {
  const token = await accessToken();
  if (!token) {
    logger.apiError("credit-service/centralRefund", new Error("no session token"), { key: opts.idempotencyKey });
    return { ok: false };
  }
  try {
    const { workspaceId } = await resolveWorkspace(token);
    await refund(token, workspaceId, {
      amount: opts.amount,
      description: opts.description,
      spendTransactionId: opts.spendTransactionId,
      idempotencyKey: opts.idempotencyKey,
    });
    return { ok: true };
  } catch (e) {
    logger.apiError("credit-service/centralRefund", e, { key: opts.idempotencyKey });
    return { ok: false };
  }
}

/** ON-Pfad-Saldo: resolve-workspace + getBalance -> { workspaceId, credits }. null bei Stoerung. */
export async function centralBalance(): Promise<{ workspaceId: string; credits: number } | null> {
  const token = await accessToken();
  if (!token) return null;
  try {
    const { workspaceId } = await resolveWorkspace(token);
    const { credits } = await getBalance(token, workspaceId);
    return { workspaceId, credits };
  } catch (e) {
    logger.apiError("credit-service/centralBalance", e);
    return null;
  }
}
