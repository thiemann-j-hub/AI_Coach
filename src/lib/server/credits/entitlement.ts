import "server-only";

import { NextResponse } from "next/server";
import { creditsCentralEnabled, centralReserve, centralRefund } from "./credit-service";
import { logger } from "@/lib/logger";

/**
 * Entitlement-Gate fuer den Analyse-Lauf (Point-of-Sale) — CENTRAL-ONLY.
 *
 * KK-1 (Go-Live-Blueprint): Der lokale Ledger-Zweig (PAYMENTS_ENABLED +
 * reserve/settle/refund gegen den workspaces-Container) wurde abgebaut.
 * Der zentrale CreditService ist die einzige Wallet-Wahrheit.
 *
 * Reihenfolge in POST /api/analyze:
 *   1) runId serverseitig erzeugen (bindet Spend & spaeteren Run aneinander)
 *   2) centralReserve -> finaler Spend (kein Hold) VOR dem teuren Gemini-Call
 *   3) Analyse laufen lassen
 *   4) Erfolg  -> settleEntitlement (No-Op, Spend war final)
 *      Fehler  -> compensateEntitlement (zentraler Refund mit spend-txId)
 *
 * Bei CREDITS_CENTRAL=off (z. B. lokal) greift kein Credit-Gate — die Analyse
 * laeuft unveraendert (nur cost-cap als Schutz).
 */

/** Greift das Credit-Gate fuer /api/analyze? Nur noch der zentrale Cutover-Flag. */
export function creditGateEnabled(): boolean {
  return creditsCentralEnabled();
}

export interface EntitlementGrant {
  /** Der serverseitig erzeugte Run-/Spend-Identifier; der Save muss ihn uebernehmen. */
  runId: string;
  workspaceId: string;
  /** true, wenn zentral verbraucht wurde (compensate erforderlich bei Abbruch). */
  held: boolean;
  /** Immer true: zentral verbraucht (Spend ist final, kein lokaler Hold). */
  central?: boolean;
  /** transactionId der zentralen spend-Antwort — Pflicht-Anker fuer den zentralen Refund. */
  centralTxId?: string;
}

export type EntitlementResult =
  | { ok: true; grant: EntitlementGrant }
  | { ok: false; response: NextResponse };

function topUpUrl(): string | undefined {
  // Welle D (IA-Masterplan 15.08.): fester Fallback auf DIE eine Kasse —
  // ohne Env fiel der Chip vorher still auf die interne /credits-Sackgasse.
  return process.env.CREDIT_TOPUP_URL || "https://pulsenorth.ai/preise";
}

function paywall(workspaceId: string): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      code: "INSUFFICIENT_CREDITS",
      error:
        "Kostenloses Kontingent aufgebraucht. Bitte Credits kaufen, um weitere Analysen zu starten.",
      workspaceId,
      ...(topUpUrl() ? { topUpUrl: topUpUrl() } : {}),
    },
    { status: 402 } // Payment Required
  );
}

/**
 * Verbraucht 1 Credit zentral (finaler Spend, kein Hold). Gibt bei leerem Saldo
 * eine 402-Paywall zurueck. Der Aufrufer MUSS im Fehlerfall compensate()
 * aufrufen (Refund mit der spend-transactionId).
 */
export async function reserveEntitlement(opts: {
  uid: string;
  email?: string | null;
  runId: string;
}): Promise<EntitlementResult> {
  const { runId } = opts;

  const c = await centralReserve({ runId });
  if (!c.ok) {
    if (c.reason === "insufficient") {
      return { ok: false, response: paywall(c.workspaceId) };
    }
    if (c.reason === "no_token") {
      // Kein nutzbares CreditService-Token: Refresh fehlgeschlagen
      // (error="RefreshFailed") oder alte Session vor dem Scope -> Re-Login
      // noetig. Fail-closed (kein Gratis-Run); der Client zeigt CENTRAL_REAUTH.
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

/** Bei erfolgreicher Analyse: nichts zu tun — der zentrale Spend war bereits final. */
export async function settleEntitlement(_grant: EntitlementGrant): Promise<void> {
  // Zentral: spend war bereits final (kein Hold) -> nichts zu settlen.
}

/** Bei technischem Abbruch: zentral zurueckerstatten (MIT der spend-transactionId). */
export async function compensateEntitlement(grant: EntitlementGrant): Promise<void> {
  // Refund MIT der spend-transactionId (Pflicht-Anker). Ohne sie kann der
  // zentrale Refund nicht greifen -> hart loggen (haengende Belastung).
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
}
