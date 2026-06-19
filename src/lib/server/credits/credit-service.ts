import "server-only";

import { auth } from "@/auth";
import { withTimeout, timeoutMs } from "@/lib/with-timeout";
import { logger } from "@/lib/logger";
import { getValid, type CreditTokenResult } from "./entra-token-store";

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
// Cutover-Helfer (CREDITS_CENTRAL=on): direkt, awaited, gating. Token kommt
// AUSSCHLIESSLICH aus dem Server-Store (getValid(oid), refresht bei Bedarf) —
// nie aus der Session; workspaceId IMMER aus /resolve-workspace.
// ---------------------------------------------------------------------------

/**
 * Holt das (ggf. refreshte) CreditService-Token aus dem Server-Store. Die oid
 * stammt IMMER aus der verifizierten Session (kein Client-Input → kein IDOR).
 * Kein oid → no-token (inert); refresh-failed → Re-Login (expired). Siehe §5.
 */
async function getCreditToken(): Promise<CreditTokenResult> {
  let oid: string | undefined;
  try {
    oid = (await auth())?.user?.oid;
  } catch {
    return { ok: false, reason: "no-token" };
  }
  if (!oid) return { ok: false, reason: "no-token" };
  return getValid(oid);
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
  const tok = await getCreditToken();
  // no-token (nie mit Scope eingeloggt) UND refresh-failed (Token tot) → beide
  // bedeuten am Gate: Re-Auth noetig, kein Gratis-Run (fail-closed).
  if (!tok.ok) return { ok: false, reason: "no_token" };
  const token = tok.accessToken;

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
  const tok = await getCreditToken();
  if (!tok.ok) {
    logger.apiError("credit-service/centralRefund", new Error(`no usable token (${tok.reason})`), { key: opts.idempotencyKey });
    return { ok: false };
  }
  const token = tok.accessToken;
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

/**
 * ON-Pfad-Wallet-Status fuer die UI (Blueprint §5): diskriminiert statt nur
 * „Saldo oder null", damit „Sitzung abgelaufen" nicht still als 0 erscheint.
 *  - inert   = keine oid / no-token (z. B. Bestandssession vor dem Re-Login) ODER
 *              transienter resolve/getBalance-Hiccup → UI rendert nichts (fail-open).
 *  - expired = Token tot (refresh-failed) ODER CreditService-401 → Re-Login-CTA.
 *  - active  = { workspaceId, credits }.
 */
export type CentralWalletStatus =
  | { state: "inert" }
  | { state: "expired" }
  | { state: "active"; workspaceId: string; credits: number };

export async function centralWalletStatus(): Promise<CentralWalletStatus> {
  const tok = await getCreditToken();
  if (!tok.ok) return tok.reason === "refresh-failed" ? { state: "expired" } : { state: "inert" };
  const token = tok.accessToken;
  try {
    const { workspaceId } = await resolveWorkspace(token);
    const { credits } = await getBalance(token, workspaceId);
    return { state: "active", workspaceId, credits };
  } catch (e) {
    // CreditService-401 → Token zentral abgelehnt → expired (Re-Login). Sonst
    // transienter Hiccup → inert (fail-open, kein 500, kein still-0).
    if (e instanceof CreditServiceError && e.status === 401) return { state: "expired" };
    logger.apiError("credit-service/centralWalletStatus", e);
    return { state: "inert" };
  }
}
