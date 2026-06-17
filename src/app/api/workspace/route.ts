// src/app/api/workspace/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { paymentsEnabled } from "@/lib/server/credits/entitlement";
import { resolveWorkspace } from "@/lib/server/credits/workspace-store";
import { getAvailableCredits } from "@/lib/server/credits/ledger";
import { MAX_WORKSPACE_MEMBERS } from "@/lib/server/credits/types";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Team-Uebersicht: Mitglieder + offene Einladungen + freie Sitze + geteilter
 * Saldo. Mitgliedschafts-gelesener Read (resolveWorkspace liefert genau den
 * Workspace, dem der Aufrufer angehoert — Solo oder Team). Bei PAYMENTS_ENABLED=
 * off liefert die Route eine inerte Huelle (enabled:false), das UI bleibt leer.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const { uid, email } = authResult;

  const rlKey = rateLimitKey(req, "workspace");
  const rlResponse = checkRateLimit(rlKey, 30, 60_000);
  if (rlResponse) return rlResponse;

  if (!paymentsEnabled()) {
    return NextResponse.json(
      {
        ok: true,
        enabled: false,
        isOwner: true,
        workspaceId: uid,
        maxMembers: MAX_WORKSPACE_MEMBERS,
        members: [],
        pendingInvites: [],
        seatsRemaining: 0,
        balance: 0,
      },
      { status: 200 }
    );
  }

  try {
    const ws = await resolveWorkspace({ uid, email });
    const balance = await getAvailableCredits(ws.workspaceId);
    const pendingInvites = ws.pendingInvites ?? [];
    const isOwner = ws.ownerUid === uid;
    const seatsRemaining = Math.max(
      0,
      MAX_WORKSPACE_MEMBERS - ws.members.length - pendingInvites.length
    );
    return NextResponse.json(
      {
        ok: true,
        enabled: true,
        isOwner,
        workspaceId: ws.workspaceId,
        ownerUid: ws.ownerUid,
        maxMembers: MAX_WORKSPACE_MEMBERS,
        members: ws.members.map((m) => ({
          uid: m.uid,
          email: m.email,
          role: m.role,
          addedAt: m.addedAt,
        })),
        pendingInvites: pendingInvites.map((p) => ({ email: p.email, invitedAt: p.invitedAt })),
        seatsRemaining,
        balance,
      },
      { status: 200 }
    );
  } catch (err: any) {
    logger.apiError("/api/workspace", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
