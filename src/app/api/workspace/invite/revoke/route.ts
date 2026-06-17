// src/app/api/workspace/invite/revoke/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { paymentsEnabled } from "@/lib/server/credits/entitlement";
import { removePendingInvite, resolveWorkspace } from "@/lib/server/credits/workspace-store";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ email: z.string().email().max(320) });

/** Owner widerruft eine offene Einladung. Nur Owner; nur bei aktivem Bezahlsystem. */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const { uid, email } = authResult;

  const rlKey = rateLimitKey(req, "workspace-revoke");
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
      return NextResponse.json({ ok: false, error: "Only the owner can revoke", code: "NOT_OWNER" }, { status: 403 });
    }

    const r = await removePendingInvite({
      workspaceId: ws.workspaceId,
      ownerUid: uid,
      email: parsed.data.email,
    });
    if (r.ok) {
      logger.api("/api/workspace/invite/revoke", "revoked", { uid, workspaceId: ws.workspaceId });
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const status = r.reason === "not_owner" ? 403 : r.reason === "not_found" ? 404 : 409;
    return NextResponse.json({ ok: false, code: r.reason }, { status });
  } catch (err: any) {
    logger.apiError("/api/workspace/invite/revoke", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
