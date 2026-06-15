// src/app/api/runs/get/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { checkSessionOwnership, getRun } from "@/lib/server/runs-store";
import { paymentsEnabled } from "@/lib/server/credits/entitlement";
import { getApiMessages } from "@/lib/server/get-request-locale";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sessionIdSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "sessionId must be url-safe (a-zA-Z0-9_-).");

const runIdSchema = z.string().min(1).max(256);

export async function GET(req: NextRequest) {
  const apiMsg = getApiMessages(req);

  // Auth check
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const { uid } = authResult;

  // Rate limit: 30 reads per minute
  const rlKey = rateLimitKey(req, "runs-get");
  const rlResponse = checkRateLimit(rlKey, 30, 60_000, apiMsg.rateLimited);
  if (rlResponse) return rlResponse;

  const sp = req.nextUrl.searchParams;
  const sessionId = sp.get("sessionId") ?? "";
  const runId = sp.get("runId") ?? sp.get("id") ?? "";

  const p1 = sessionIdSchema.safeParse(sessionId);
  if (!p1.success) {
    return NextResponse.json(
      { ok: false, error: p1.error.flatten(), code: "BAD_SESSION_ID" },
      { status: 400 }
    );
  }

  const p2 = runIdSchema.safeParse(runId);
  if (!p2.success) {
    return NextResponse.json(
      { ok: false, error: p2.error.flatten(), code: "BAD_RUN_ID" },
      { status: 400 }
    );
  }

  try {
    const ownership = await checkSessionOwnership(sessionId, uid);
    if (!ownership.allowed) {
      return NextResponse.json(
        { ok: false, error: apiMsg.accessDenied, code: "FORBIDDEN" },
        { status: 403 }
      );
    }

    const data = await getRun(sessionId, runId);
    // Soft-geloeschte Runs sind fuer den Detail-View nicht mehr abrufbar.
    if (!data || data.deleted === true) {
      return NextResponse.json(
        { ok: false, error: apiMsg.notFound, code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        run: {
          id: data.id,
          createdAt: data.createdAt ?? null,
          conversationType: data.conversationType ?? null,
          conversationSubType: data.conversationSubType ?? null,
          goal: data.goal ?? null,
          lang: data.lang ?? null,
          jurisdiction: data.jurisdiction ?? null,
          transcriptText: data.transcriptText ?? null,
          analysisJson: data.analysisJson ?? null,
          ragContext: data.ragContext ?? null,
          scoreOverall: data.scoreOverall ?? data.analysisJson?.scores?.overall ?? null,
          summary: data.summary ?? data.analysisJson?.summary ?? null,
          rating: typeof data.rating === "number" ? data.rating : null,
        },
        // Steuert die Refund-Affordanz des Delete-Buttons: nur wenn Payments aktiv
        // sind, kann der 10-Min-Refund tatsaechlich greifen (sonst neutrales Löschen).
        paymentsEnabled: paymentsEnabled(),
      },
      { status: 200 }
    );
  } catch (err: any) {
    logger.apiError("/api/runs/get", err);
    return NextResponse.json(
      { ok: false, error: apiMsg.internalError, code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
