// src/app/api/workspace/remove/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { paymentsEnabled } from "@/lib/server/credits/entitlement";
import { removeWorkspaceMember, resolveWorkspace } from "@/lib/server/credits/workspace-store";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ memberUid: z.string().min(1).max(128) });

/** Owner entfernt ein Mitglied. Owner kann sich nicht selbst entfernen. */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const { uid, email } = authResult;

  const rlKey = rateLimitKey(req, "workspace-remove");
  const rlResponse = checkRateLimit(rlKey, 10, 60_000);
  if (rlResponse) return rlResponse;

  if (!paymentsEnabled()) {
    return NextResponse.json(
      { ok: false, error: "Feature disabled", code: "FEATURE_DISABLED" },
      { status: 403 }
    );
  }

  try {
    const json = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
    }

    const ws = await resolveWorkspace({ uid, email });
    if (ws.ownerUid !== uid) {
      return NextResponse.json({ ok: false, error: "Only the owner can remove members", code: "NOT_OWNER" }, { status: 403 });
    }

    const r = await removeWorkspaceMember({
      workspaceId: ws.workspaceId,
      ownerUid: uid,
      memberUid: parsed.data.memberUid,
    });
    if (r.ok) {
      logger.api("/api/workspace/remove", "removed", { uid, workspaceId: ws.workspaceId });
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const status =
      r.reason === "not_owner"
        ? 403
        : r.reason === "not_found" || r.reason === "not_member"
          ? 404
          : r.reason === "is_owner"
            ? 400
            : 409;
    return NextResponse.json({ ok: false, code: r.reason }, { status });
  } catch (err: any) {
    logger.apiError("/api/workspace/remove", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
