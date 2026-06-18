import "server-only";

import { NextResponse } from "next/server";
import { reserveCredit, settleHold, refundCredit } from "./ledger";
import { resolveWorkspace } from "./workspace-store";
import { creditsCentralEnabled, centralReserve, centralRefund } from "./credit-service";
import { logger } from "@/lib/logger";

/**
 * Entitlement-Gate fuer den Analyse-Lauf (Point-of-Sale).
 *
 * Reihenfolge in POST /api/analyze:
 *   1) runId serverseitig erzeugen (bindet Hold & spaeteren Run aneinander)
 *   2) Workspace aufloesen (+ Lazy Reconciliation abgelaufener Holds)
 *   3) reserveCredit -> Hold (Saldo & Batch -1) VOR dem teuren Gemini-Call
 *   4) Analyse laufen lassen
 *   5) Erfolg  -> settleHold ; Fehler -> refundCredit(technical_failure)
 *
 * Flag-gated ueber PAYMENTS_ENABLED (Default off), damit der Live-Flow erst
 * greift, wenn Workspace-Daten + Stripe provisioniert sind. Bei "off" laeuft
 * die Analyse unveraendert (nur cost-cap als Schutz).
 */

export function paymentsEnabled(): boolean {
  return (process.env.PAYMENTS_ENABLED ?? "off").toLowerCase() === "on";
}

/** Greift das Credit-Gate fuer /api/analyze? Zentral (Cutover) ODER lokal (altes Flag). */
export function creditGateEnabled(): boolean {
  return creditsCentralEnabled() || paymentsEnabled();
}

export interface EntitlementGrant {
  /** Der serverseitig erzeugte Run-/Hold-Identifier; der Save muss ihn uebernehmen. */
  runId: string;
  workspaceId: string;
  /** true, wenn ein Hold/Spend gezogen wurde (settle/compensate erforderlich). */
  held: boolean;
  /** true im CREDITS_CENTRAL-Pfad: zentral verbraucht (kein lokaler Hold). */
  central?: boolean;
  /** transactionId der zentralen spend-Antwort — Pflicht-Anker fuer den zentralen Refund. */
  centralTxId?: string;
}

export type EntitlementResult =
  | { ok: true; grant: EntitlementGrant }
  | { ok: false; response: NextResponse };

function topUpUrl(): string | undefined {
  return process.env.CREDIT_TOPUP_URL || undefined;
}

function paywall(workspaceId: string, balance?: number): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      code: "INSUFFICIENT_CREDITS",
      error:
        "Kostenloses Kontingent aufgebraucht. Bitte Credits kaufen, um weitere Analysen zu starten.",
      workspaceId,
      ...(typeof balance === "number" ? { balance } : {}),
      ...(topUpUrl() ? { topUpUrl: topUpUrl() } : {}),
    },
    { status: 402 } // Payment Required
  );
}

/**
 * Loest Workspace auf und reserviert 1 Credit. Gibt bei leerem Saldo eine
 * 402-Paywall zurueck. Der Aufrufer MUSS bei Erfolg spaeter settle() bzw. im
 * catch compensate() aufrufen.
 */
export async function reserveEntitlement(opts: {
  uid: string;
  email?: string | null;
  runId: string;
}): Promise<EntitlementResult> {
  const { uid, email, runId } = opts;

  // CREDITS_CENTRAL=on: zentraler Wallet ist die Wahrheit -> direkt zentral
  // verbrauchen (kein lokaler Hold). workspaceId kommt aus /resolve-workspace.
  if (creditsCentralEnabled()) {
    const c = await centralReserve({ runId });
    if (!c.ok) {
      if (c.reason === "insufficient") {
        return { ok: false, response: paywall(c.workspaceId) };
      }
      if (c.reason === "no_token") {
        // Session ohne CreditService-Token (z. B. alte Session vor dem Scope) ->
        // Re-Login noetig. Fail-closed (kein Gratis-Run).
        return {
          ok: false,
          response: NextResponse.json(
            { ok: false, code: "CENTRAL_REAUTH", error: "Bitte neu anmelden, um Guthaben zu nutzen." },
            { status: 401 }
          ),
        };
      }
      // zentraler Dienst gestoert -> fail-closed (kein Gratis-Run), Client kann erneut
      return {
        ok: false,
        response: NextResponse.json(
          { ok: false, code: "CENTRAL_UNAVAILABLE", error: "Guthaben-Dienst nicht erreichbar. Bitte erneut versuchen." },
          { status: 503 }
        ),
      };
    }
    return {
      ok: true,
      grant: { runId, workspaceId: c.workspaceId, held: true, central: true, centralTxId: c.transactionId },
    };
  }

  // CREDITS_CENTRAL=off: unveraenderter lokaler Pfad (altes Ledger ist die Wahrheit).
  const ws = await resolveWorkspace({ uid, email });

  const reserve = await reserveCredit({ workspaceId: ws.workspaceId, runId });
  if (!reserve.ok) {
    if (reserve.reason === "insufficient_credits") {
      return { ok: false, response: paywall(ws.workspaceId, ws.balance) };
    }
    // OCC-Konflikt nach Retries -> 409, Client kann erneut versuchen
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, code: "CREDIT_CONFLICT", error: "Bitte erneut versuchen." },
        { status: 409 }
      ),
    };
  }

  const held = reserve.held === true || (reserve as any).alreadyHeld === true;
  return { ok: true, grant: { runId, workspaceId: ws.workspaceId, held } };
}

/** Bei erfolgreicher Analyse: Hold final verbuchen. */
export async function settleEntitlement(grant: EntitlementGrant): Promise<void> {
  // Zentral: spend war bereits final (kein Hold) -> nichts zu settlen.
  if (grant.central) return;
  if (!grant.held) return;
  try {
    await settleHold({ workspaceId: grant.workspaceId, runId: grant.runId });
  } catch (err) {
    // Settle-Fehler ist unkritisch: der Hold laeuft sonst ab und wird lazy
    // zurueckgebucht — wir wollen den erfolgreichen Response nicht killen.
    console.warn("[entitlement] settle failed (hold will lazily reconcile):", err);
  }
}

/** Bei technischem Abbruch: Credit synchron zurueckbuchen (Schnellpfad). */
export async function compensateEntitlement(grant: EntitlementGrant): Promise<void> {
  // Zentral: refund MIT der spend-transactionId (Pflicht-Anker). Ohne sie kann
  // der zentrale Refund nicht greifen -> hart loggen (haengende Belastung).
  if (grant.central) {
    if (!grant.centralTxId) {
      logger.apiError(
        "/api/analyze/compensate",
        new Error("central compensate without spend transactionId"),
        { runId: grant.runId, workspaceId: grant.workspaceId }
      );
      return;
    }
    await centralRefund({
      amount: 1,
      description: "coach:refund_technical_failure",
      spendTransactionId: grant.centralTxId,
      idempotencyKey: `refund:tech:${grant.runId}`,
    });
    return;
  }

  if (!grant.held) return;
  try {
    await refundCredit({
      workspaceId: grant.workspaceId,
      runId: grant.runId,
      reason: "refund_technical_failure",
    });
  } catch (err) {
    // Schlaegt der synchrone Refund fehl, faengt die Lazy Reconciliation den
    // abgelaufenen Hold beim naechsten Workspace-Load ab (Backstop).
    console.warn("[entitlement] compensate failed (lazy reconcile is backstop):", err);
  }
}
