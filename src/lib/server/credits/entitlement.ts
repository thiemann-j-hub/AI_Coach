import "server-only";

import { NextResponse } from "next/server";
import { reserveCredit, settleHold, refundCredit } from "./ledger";
import { resolveWorkspace } from "./workspace-store";

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

  return {
    ok: true,
    grant: {
      runId,
      workspaceId: ws.workspaceId,
      held: reserve.held === true || (reserve as any).alreadyHeld === true,
    },
  };
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
}

/** Bei technischem Abbruch: Credit synchron zurueckbuchen (Schnellpfad). */
export async function compensateEntitlement(grant: EntitlementGrant): Promise<void> {
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
