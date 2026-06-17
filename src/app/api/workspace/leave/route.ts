// src/app/api/workspace/leave/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { paymentsEnabled } from "@/lib/server/credits/entitlement";
import { leaveWorkspace } from "@/lib/server/credits/workspace-store";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Mitglied verlaesst freiwillig sein Team. Der Owner kann nicht "leaven". */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const { uid } = authResult;

  const rlKey = rateLimitKey(req, "workspace-leave");
  const rlResponse = checkRateLimit(rlKey, 10, 60_000);
  if (rlResponse) return rlResponse;

  if (!paymentsEnabled()) {
    return NextResponse.json(
      { ok: false, error: "Feature disabled", code: "FEATURE_DISABLED" },
      { status: 403 }
    );
  }

  try {
    const r = await leaveWorkspace({ uid });
    if (r.ok) {
      logger.api("/api/workspace/leave", "left", { uid });
      return NextResponse.json({ ok: true }, { status: 200 });
    }
    const status = r.reason === "conflict" ? 409 : 400;
    return NextResponse.json({ ok: false, code: r.reason }, { status });
  } catch (err: any) {
    logger.apiError("/api/workspace/leave", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
