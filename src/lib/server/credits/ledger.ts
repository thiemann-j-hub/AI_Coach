import "server-only";

import { OperationInput } from "@azure/cosmos";
import { queryItems, readItem, workspacesContainer } from "@/lib/cosmos";
import {
  CreditBatchDoc,
  CreditSource,
  LedgerDoc,
  LedgerReason,
  StripeEventDoc,
  WorkspaceDoc,
} from "./types";

/**
 * Credit-Ledger-Kern (Architektur mit Gemini gelockt 2026-06-14).
 *
 * Alle Mehr-Doc-Mutationen laufen als Cosmos TransactionalBatch innerhalb der
 * workspaceId-Partition -> ACID (Alles-oder-Nichts). OCC ueber ETag/If-Match
 * sichert die FIFO-Race; Konflikte (412) loest ein Read-Compute-Retry (max 3).
 *
 * Verbrauch ist ein zweiphasiger Hold:
 *   reserve -> ledger "hold:{runId}" status=pending, Saldo & Batch bereits -1
 *   settle  -> status=settled (Analyse ok)
 *   refund  -> EINE idempotente Primitive (ledger "refund:{runId}"), getriggert
 *              von User-Delete | technischem Abbruch | Hold-Verfall (lazy).
 */

const HOLD_TTL_MS = 15 * 60 * 1000; // 15 Minuten bis ein uncatchable-Hold lazy zurueckgebucht wird
const MAX_RETRIES = 3;

function nowIso(): string {
  return new Date().toISOString();
}

function plusMonthsIso(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Batch-Ausfuehrung mit einheitlicher Erfolgs-/Konflikt-Auswertung
// ---------------------------------------------------------------------------

interface BatchOutcome {
  ok: boolean;
  /** HTTP-Status des fehlgeschlagenen Ops (412 ETag, 409 Konflikt, ...). */
  status?: number;
  /** Index des fehlschlagenden Ops (nicht 424 Failed-Dependency). */
  failedIndex?: number;
  results?: any[];
}

async function executeBatch(ops: OperationInput[], pk: string): Promise<BatchOutcome> {
  try {
    const res: any = await workspacesContainer().items.batch(ops, pk);
    const results: any[] = res?.result ?? [];
    const failedIdx = results.findIndex(
      (r) => typeof r?.statusCode === "number" && r.statusCode >= 400 && r.statusCode !== 424
    );
    const topOk = res?.code === undefined || res.code < 400;
    if (failedIdx === -1 && topOk) return { ok: true, results };
    const status = failedIdx >= 0 ? results[failedIdx].statusCode : res?.code ?? 0;
    return { ok: false, status, failedIndex: failedIdx, results };
  } catch (err: any) {
    return { ok: false, status: err?.code ?? err?.statusCode ?? 0 };
  }
}

// ---------------------------------------------------------------------------
// Lesepfade
// ---------------------------------------------------------------------------

export async function getWorkspaceDoc(workspaceId: string): Promise<WorkspaceDoc | null> {
  return readItem<WorkspaceDoc>(workspacesContainer(), workspaceId, workspaceId);
}

/** Noch gueltige Batches (amount>0, nicht verfallen), FIFO-sortiert (fruehester Verfall zuerst). */
export async function listActiveBatches(workspaceId: string): Promise<CreditBatchDoc[]> {
  const now = nowIso();
  return queryItems<CreditBatchDoc>(
    workspacesContainer(),
    `SELECT * FROM c
       WHERE c.workspaceId = @ws AND c.type = 'creditBatch'
         AND c.amount > 0 AND c.expiresAt > @now
       ORDER BY c.expiresAt ASC`,
    [
      { name: "@ws", value: workspaceId },
      { name: "@now", value: now },
    ]
  );
}

/** Authoritativer Saldo = Summe gueltiger Batch-Restmengen. */
export async function getAvailableCredits(workspaceId: string): Promise<number> {
  const batches = await listActiveBatches(workspaceId);
  return batches.reduce((sum, b) => sum + (b.amount > 0 ? b.amount : 0), 0);
}

async function getLedger(workspaceId: string, id: string): Promise<LedgerDoc | null> {
  return readItem<LedgerDoc>(workspacesContainer(), id, workspaceId);
}

/**
 * Liest den Hold (hold:{runId}) eines Runs — fuer die Billing-Integritaet an der
 * Save-Grenze: ein abrechenbarer Run darf nur entstehen, wenn ein zugehoeriger,
 * NICHT erstatteter Hold existiert.
 */
export async function getHold(workspaceId: string, runId: string): Promise<LedgerDoc | null> {
  return getLedger(workspaceId, `hold:${runId}`);
}

// ---------------------------------------------------------------------------
// (i) RESERVE — Hold vor dem teuren Gemini-Call
// ---------------------------------------------------------------------------

export type ReserveResult =
  | { ok: true; held: true; batchId: string }
  | { ok: true; held: false; alreadyHeld: true } // idempotent: Hold existiert schon
  | { ok: false; reason: "insufficient_credits" }
  | { ok: false; reason: "conflict" }; // OCC nach Retries nicht aufgeloest

/**
 * Zieht atomar 1 Credit aus dem fruehesten gueltigen Batch und legt den Hold an.
 * Deterministische Ledger-ID "hold:{runId}" macht den Aufruf idempotent.
 */
export async function reserveCredit(opts: {
  workspaceId: string;
  runId: string;
}): Promise<ReserveResult> {
  const { workspaceId, runId } = opts;
  const holdId = `hold:${runId}`;

  // Idempotenz: existiert der Hold bereits, nicht erneut ziehen.
  const existing = await getLedger(workspaceId, holdId);
  if (existing) return { ok: true, held: false, alreadyHeld: true };

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const batches = await listActiveBatches(workspaceId);
    if (batches.length === 0) return { ok: false, reason: "insufficient_credits" };

    const batch = batches[0]; // FIFO: fruehester Verfall
    const ts = nowIso();
    const ledger: LedgerDoc = {
      id: holdId,
      workspaceId,
      type: "ledger",
      delta: -1,
      reason: "consume",
      status: "pending",
      runId,
      batchId: batch.id,
      holdExpiresAt: new Date(Date.now() + HOLD_TTL_MS).toISOString(),
      createdAt: ts,
    };

    const ops: OperationInput[] = [
      // 1) Batch dekrementieren mit OCC (If-Match) -> verhindert Doppel-Draw
      {
        operationType: "Patch",
        id: batch.id,
        ifMatch: batch._etag,
        resourceBody: { operations: [{ op: "incr", path: "/amount", value: -1 }] },
      } as OperationInput,
      // 2) Hold-Ledger anlegen (409 falls Race denselben holdId schrieb)
      { operationType: "Create", resourceBody: ledger as any } as OperationInput,
      // 3) Schnell-Saldo am Workspace mitfuehren
      {
        operationType: "Patch",
        id: workspaceId,
        resourceBody: {
          operations: [
            { op: "incr", path: "/balance", value: -1 },
            { op: "set", path: "/updatedAt", value: ts },
          ],
        },
      } as OperationInput,
    ];

    const outcome = await executeBatch(ops, workspaceId);
    if (outcome.ok) return { ok: true, held: true, batchId: batch.id };

    // 412 (Batch-ETag stale) oder 409 (holdId-Race) -> neu lesen & retry
    if (outcome.status === 412 || outcome.status === 409) {
      if (outcome.status === 409) {
        // Hold wurde parallel angelegt -> idempotent ok
        const again = await getLedger(workspaceId, holdId);
        if (again) return { ok: true, held: false, alreadyHeld: true };
      }
      continue;
    }
    // Unerwarteter Fehler -> nicht endlos retryen
    break;
  }
  return { ok: false, reason: "conflict" };
}

// ---------------------------------------------------------------------------
// (ii) SETTLE — Hold bestaetigen (Analyse erfolgreich)
// ---------------------------------------------------------------------------

/** Flippt nur pending->settled (Bedingung schuetzt vor Ueberschreiben eines Refunds). */
export async function settleHold(opts: {
  workspaceId: string;
  runId: string;
}): Promise<{ ok: boolean }> {
  const { workspaceId, runId } = opts;
  const holdId = `hold:${runId}`;
  try {
    await workspacesContainer()
      .item(holdId, workspaceId)
      .patch({
        operations: [
          { op: "set", path: "/status", value: "settled" },
          { op: "set", path: "/settledAt", value: nowIso() },
        ],
        condition: "FROM c WHERE c.status = 'pending'",
      } as any);
    return { ok: true };
  } catch (err: any) {
    // 412 (Bedingung verletzt: schon settled/refunded) oder 404 -> idempotent ok
    if (err?.code === 412 || err?.code === 404) return { ok: true };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// (iii)+(iv) REFUND — EINE idempotente Primitive, drei Trigger
// ---------------------------------------------------------------------------

/**
 * Bucht den Credit des Runs zurueck. Idempotent ueber deterministische
 * Ledger-ID "refund:{runId}" (409 = bereits erstattet = safe). Restauriert in
 * den urspruenglichen Batch (Refund erfolgt zeitnah, Batch noch gueltig) und
 * flippt den Hold auf refunded. Funktioniert aus pending UND settled.
 */
export async function refundCredit(opts: {
  workspaceId: string;
  runId: string;
  reason: Extract<
    LedgerReason,
    "refund_user_delete" | "refund_technical_failure" | "refund_hold_expired"
  >;
}): Promise<{ ok: boolean; refunded: boolean }> {
  const { workspaceId, runId, reason } = opts;
  const holdId = `hold:${runId}`;
  const refundId = `refund:${runId}`;

  const hold = await getLedger(workspaceId, holdId);
  if (!hold) return { ok: true, refunded: false }; // nie ein Hold gezogen -> nichts zu erstatten
  if (hold.status === "refunded") return { ok: true, refunded: false }; // schon erledigt

  const ts = nowIso();
  const refundLedger: LedgerDoc = {
    id: refundId,
    workspaceId,
    type: "ledger",
    delta: 1,
    reason,
    status: "refunded",
    runId,
    batchId: hold.batchId,
    createdAt: ts,
  };

  const ops: OperationInput[] = [
    // Gutschrift in den Ursprungs-Batch (idempotenz-geschuetzt durch den Create unten)
    ...(hold.batchId
      ? [
          {
            operationType: "Patch",
            id: hold.batchId,
            resourceBody: { operations: [{ op: "incr", path: "/amount", value: 1 }] },
          } as OperationInput,
        ]
      : []),
    // Deterministische Refund-Buchung -> 409 falls bereits erstattet => Batch rollt komplett zurueck
    { operationType: "Create", resourceBody: refundLedger as any } as OperationInput,
    // Hold als refunded markieren
    {
      operationType: "Patch",
      id: holdId,
      resourceBody: { operations: [{ op: "set", path: "/status", value: "refunded" }] },
    } as OperationInput,
    // Schnell-Saldo zuruecksetzen
    {
      operationType: "Patch",
      id: workspaceId,
      resourceBody: {
        operations: [
          { op: "incr", path: "/balance", value: 1 },
          { op: "set", path: "/updatedAt", value: ts },
        ],
      },
    } as OperationInput,
  ];

  const outcome = await executeBatch(ops, workspaceId);
  if (outcome.ok) return { ok: true, refunded: true };
  if (outcome.status === 409) return { ok: true, refunded: false }; // refund:{runId} existiert -> idempotent
  throw new Error(`refundCredit failed (status ${outcome.status}) for run ${runId}`);
}

/**
 * Lazy Reconciliation (Gemini-Optimierung): beim Workspace-Laden offene,
 * abgelaufene Holds derselben Partition zuruckbuchen. 0 Hintergrund-Infra,
 * keine Cross-Partition-Query — laeuft nur innerhalb DIESES Workspaces.
 */
export async function reconcileExpiredHolds(workspaceId: string): Promise<number> {
  const now = nowIso();
  const stale = await queryItems<LedgerDoc>(
    workspacesContainer(),
    `SELECT * FROM c
       WHERE c.workspaceId = @ws AND c.type = 'ledger'
         AND c.status = 'pending' AND IS_DEFINED(c.holdExpiresAt) AND c.holdExpiresAt < @now`,
    [
      { name: "@ws", value: workspaceId },
      { name: "@now", value: now },
    ]
  );
  let refunded = 0;
  for (const hold of stale) {
    if (!hold.runId) continue;
    const r = await refundCredit({
      workspaceId,
      runId: hold.runId,
      reason: "refund_hold_expired",
    });
    if (r.refunded) refunded++;
  }
  return refunded;
}

// ---------------------------------------------------------------------------
// GRANT / PURCHASE — Credits gutschreiben
// ---------------------------------------------------------------------------

/**
 * Schreibt ein neues Credit-Paket gut (Free-Grant oder Kauf) und fuehrt den
 * Schnell-Saldo nach. Bei Kauf: stripeEvent-Doc als Idempotenz-Anker im selben
 * Batch (id = event.id, 409 = bereits verarbeitet => kompletter Rollback).
 */
export async function grantCredits(opts: {
  workspaceId: string;
  amount: number;
  source: CreditSource;
  expiresInMonths?: number;
  /** Idempotenz fuer Kaeufe: Stripe event.id. */
  stripeEventId?: string;
  stripeEventType?: string;
  stripePaymentIntentId?: string;
}): Promise<{ ok: boolean; granted: boolean; batchId?: string }> {
  const {
    workspaceId,
    amount,
    source,
    expiresInMonths = 12,
    stripeEventId,
    stripeEventType,
    stripePaymentIntentId,
  } = opts;
  if (amount <= 0) return { ok: true, granted: false };

  const ts = nowIso();
  const batchId = stripeEventId ? `batch:${stripeEventId}` : `batch:${cryptoRandom()}`;
  const batch: CreditBatchDoc = {
    id: batchId,
    workspaceId,
    type: "creditBatch",
    amount,
    originalAmount: amount,
    source,
    expiresAt: plusMonthsIso(expiresInMonths),
    createdAt: ts,
    ...(stripePaymentIntentId ? { stripePaymentIntentId } : {}),
  };
  const ledger: LedgerDoc = {
    id: stripeEventId ? `purchase:${stripeEventId}` : `grant:${batchId}`,
    workspaceId,
    type: "ledger",
    delta: amount,
    reason: source === "purchase" ? "purchase" : "free_grant",
    status: "settled",
    batchId,
    createdAt: ts,
  };

  const ops: OperationInput[] = [];
  if (stripeEventId) {
    const evt: StripeEventDoc = {
      id: stripeEventId,
      workspaceId,
      type: "stripeEvent",
      eventType: stripeEventType ?? "unknown",
      processedAt: ts,
    };
    // Idempotenz-Anker zuerst: 409 => Event schon verarbeitet => alles rollt zurueck
    ops.push({ operationType: "Create", resourceBody: evt as any } as OperationInput);
  }
  ops.push({ operationType: "Create", resourceBody: batch as any } as OperationInput);
  ops.push({ operationType: "Create", resourceBody: ledger as any } as OperationInput);
  ops.push({
    operationType: "Patch",
    id: workspaceId,
    resourceBody: {
      operations: [
        { op: "incr", path: "/balance", value: amount },
        { op: "set", path: "/updatedAt", value: ts },
      ],
    },
  } as OperationInput);

  const outcome = await executeBatch(ops, workspaceId);
  if (outcome.ok) return { ok: true, granted: true, batchId };
  if (outcome.status === 409) return { ok: true, granted: false }; // idempotent (Event/Doc existiert)
  throw new Error(`grantCredits failed (status ${outcome.status}) for ws ${workspaceId}`);
}

function cryptoRandom(): string {
  // Genkit/Next-Runtime hat crypto global; Fallback fuer Node.
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("crypto").randomUUID();
}
