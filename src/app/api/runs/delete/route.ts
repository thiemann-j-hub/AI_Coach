// src/app/api/runs/delete/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import {
  checkSessionOwnership,
  clearRunRefundPending,
  markRunDeleted,
} from "@/lib/server/runs-store";
import { paymentsEnabled } from "@/lib/server/credits/entitlement";
import { getWorkspaceDoc, refundCredit } from "@/lib/server/credits/ledger";
import { shadowRefund } from "@/lib/server/credits/credit-service";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Kulanz-Fenster: Credit-Rueckgabe bei Loeschung innerhalb von 10 Minuten. */
const REFUND_WINDOW_MS = 10 * 60 * 1000;

const bodySchema = z.object({
  sessionId: z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/),
  runId: z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/),
});

export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const { uid } = authResult;

  const rlKey = rateLimitKey(req, "runs-delete");
  const rlResponse = checkRateLimit(rlKey, 20, 60_000);
  if (rlResponse) return rlResponse;

  try {
    const json = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
    }
    const { sessionId, runId } = parsed.data;

    // Ownership: Session muss dem User gehoeren.
    const ownership = await checkSessionOwnership(sessionId, uid);
    if (!ownership.allowed) {
      return NextResponse.json({ ok: false, error: "Access denied", code: "FORBIDDEN" }, { status: 403 });
    }

    // Refund nur, wenn innerhalb des Kulanz-Fensters geloescht wird.
    // refundPending=true wird VOR dem inline-Refund gesetzt, damit der
    // v1-Sweep-Backstop einen fehlgeschlagenen inline-Refund nachholen kann.
    let willRefund = false;
    const run = await markRunDeleted(sessionId, runId, false);
    if (!run) {
      return NextResponse.json({ ok: false, error: "Run not found", code: "NOT_FOUND" }, { status: 404 });
    }

    if (paymentsEnabled()) {
      const ageMs = Date.now() - new Date(run.createdAt).getTime();
      const withinWindow = Number.isFinite(ageMs) && ageMs <= REFUND_WINDOW_MS;
      const workspaceId = run.workspaceId ?? run.uid;

      // Mitgliedschafts-Revalidierung: nur erstatten, wenn der Loeschende AKTUELL
      // noch Mitglied der Run-Partition ist. Ein zwischenzeitlich aus dem Team
      // entferntes Mitglied darf den (Team-)Ledger nicht mehr bewegen — der
      // Soft-Delete oben bleibt davon unberuehrt. Solo-Partition (ws===uid) ist
      // implizit Mitgliedschaft.
      let stillMember = workspaceId === uid;
      if (!stillMember) {
        const ws = await getWorkspaceDoc(workspaceId);
        stillMember = ws ? ws.members.some((m) => m.uid === uid) : false;
      }

      willRefund = withinWindow && stillMember;
      if (withinWindow && !stillMember) {
        logger.api("/api/runs/delete", "refund-skipped-not-member", { uid, sessionId, runId, workspaceId });
      }
      if (willRefund) {
        // refundPending markieren (Backstop), dann idempotent inline erstatten.
        await markRunDeleted(sessionId, runId, true);
        try {
          await refundCredit({ workspaceId, runId, reason: "refund_user_delete" });
          await clearRunRefundPending(sessionId, runId);
          // Phase-1-Dual-Write: derselbe Refund als Schatten an den zentralen
          // CreditService-Refund-Endpunkt (inert bei CREDITS_CENTRAL=off; fail-soft).
          await shadowRefund({ amount: 1, idempotencyKey: `refund:${runId}`, note: "coach:refund_user_delete" });
        } catch (e) {
          // Inline fehlgeschlagen -> refundPending bleibt true -> v1-Sweep holt nach.
          logger.apiError("/api/runs/delete/refund", e);
        }
      }
    }

    logger.api("/api/runs/delete", "deleted", { uid, sessionId, runId, refunded: willRefund });
    return NextResponse.json({ ok: true, deleted: true, refunded: willRefund }, { status: 200 });
  } catch (err: any) {
    logger.apiError("/api/runs/delete", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
