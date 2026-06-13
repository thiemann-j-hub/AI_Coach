// src/app/api/runs/rate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { checkSessionOwnership, rateRun } from "@/lib/server/runs-store";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getApiMessages } from "@/lib/server/get-request-locale";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  sessionId: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/, "sessionId must be url-safe (a-zA-Z0-9_-)."),
  runId: z.string().min(1).max(256),
  rating: z.number().int().min(1).max(5),
});

export async function POST(req: NextRequest) {
  const apiMsg = getApiMessages(req);

  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const { uid } = authResult;

  const rlResponse = checkRateLimit(rateLimitKey(req, "runs-rate"), 20, 60_000, apiMsg.rateLimited);
  if (rlResponse) return rlResponse;

  try {
    const json = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { sessionId, runId, rating } = parsed.data;

    // Ownership-Check analog zu /api/runs/get
    const ownership = await checkSessionOwnership(sessionId, uid);
    if (!ownership.allowed) {
      return NextResponse.json(
        { ok: false, error: apiMsg.accessDenied, code: "FORBIDDEN" },
        { status: 403 }
      );
    }

    const updated = await rateRun(sessionId, runId, rating);
    if (!updated) {
      return NextResponse.json(
        { ok: false, error: apiMsg.notFound, code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    logger.api("/api/runs/rate", "saved", { uid, sessionId, runId, rating });
    return NextResponse.json({ ok: true, rating }, { status: 200 });
  } catch (err: any) {
    logger.apiError("/api/runs/rate", err);
    return NextResponse.json(
      { ok: false, error: apiMsg.internalError, code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
