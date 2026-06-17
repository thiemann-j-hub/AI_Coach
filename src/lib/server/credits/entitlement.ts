import "server-only";

import { NextResponse } from "next/server";
import { reserveCredit, settleHold, refundCredit } from "./ledger";
import { resolveWorkspace } from "./workspace-store";
import { shadowSpend, shadowRefund } from "./credit-service";

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

export interface EntitlementGrant {
  /** Der serverseitig erzeugte Run-/Hold-Identifier; der Save muss ihn uebernehmen. */
  runId: string;
  workspaceId: string;
  /** true, wenn ein Hold gezogen wurde (settle/compensate erforderlich). */
  held: boolean;
}

export type EntitlementResult =
  | { ok: true; grant: EntitlementGrant }
  | { ok: false; response: NextResponse };

function paywall(workspaceId: string, balance?: number): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      code: "INSUFFICIENT_CREDITS",
      error:
        "Kostenloses Kontingent aufgebraucht. Bitte Credits kaufen, um weitere Analysen zu starten.",
      workspaceId,
      ...(typeof balance === "number" ? { balance } : {}),
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
  // Phase-1-Dual-Write: erst ALT reserviert (= Credit lokal gezogen), danach
  // derselbe Verbrauch als Schatten an den zentralen CreditService. Bewusst an
  // RESERVE (nicht settle): so spiegelt der Schatten die lokale Saldo-Mechanik
  // (reserve -1 / refund +1; settle saldoneutral) und der Refund-Schatten am
  // Fehlerpfad geht bilanziell auf. Inert bei CREDITS_CENTRAL=off; fail-soft.
  if (held) {
    await shadowSpend({ amount: 1, idempotencyKey: `spend:${runId}`, note: `coach:consume:${runId}` });
  }

  return { ok: true, grant: { runId, workspaceId: ws.workspaceId, held } };
}

/** Bei erfolgreicher Analyse: Hold final verbuchen. */
export async function settleEntitlement(grant: EntitlementGrant): Promise<void> {
  if (!grant.held) return;
  try {
    await settleHold({ workspaceId: grant.workspaceId, runId: grant.runId });
  } catch (err) {
    // Settle-Fehler ist unkritisch: der Hold laeuft sonst ab und wird lazy
    // zurueckgebucht — wir wollen den erfolgreichen Response nicht killen.
    console.warn("[entitlement] settle failed (hold will lazily reconcile):", err);
  }
  // Settle ist saldoneutral -> KEIN Schatten hier. Der Verbrauchs-Schatten
  // haengt an reserveEntitlement (dort zieht das lokale Ledger den Credit).
}

/** Bei technischem Abbruch: Credit synchron zurueckbuchen (Schnellpfad). */
export async function compensateEntitlement(grant: EntitlementGrant): Promise<void> {
  if (!grant.held) return;
  let refunded = false;
  try {
    const r = await refundCredit({
      workspaceId: grant.workspaceId,
      runId: grant.runId,
      reason: "refund_technical_failure",
    });
    refunded = r.refunded === true;
  } catch (err) {
    // Schlaegt der synchrone Refund fehl, faengt die Lazy Reconciliation den
    // abgelaufenen Hold beim naechsten Workspace-Load ab (Backstop).
    console.warn("[entitlement] compensate failed (lazy reconcile is backstop):", err);
  }
  // Phase-1-Dual-Write: NUR wenn lokal wirklich erstattet wurde, denselben
  // Refund als Schatten an den zentralen CreditService (eigener Key, getrennt
  // vom spend-Key). Inert bei CREDITS_CENTRAL=off; fail-soft.
  if (refunded) {
    await shadowRefund({
      amount: 1,
      idempotencyKey: `refund:tech:${grant.runId}`,
      note: "coach:refund_technical_failure",
    });
  }
}
