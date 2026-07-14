// src/app/api/workspace/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { MAX_WORKSPACE_MEMBERS } from "@/lib/server/credits/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Team-Uebersicht — INAKTIV (KK-1): Das lokale Team-/Workspace-Feature war Teil
 * des abgebauten PAYMENTS_ENABLED-Stacks und ist nie live gegangen (Prod laeuft
 * auf CREDITS_CENTRAL=on ohne lokales Team-Management). Die Route bleibt als
 * definierte inerte Huelle bestehen, weil das /workspace-UI sie aufruft —
 * identische Antwort wie zuvor bei PAYMENTS_ENABLED=off (enabled:false,
 * UI zeigt den „nicht aktiviert"-Hinweis).
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const { uid } = authResult;

  const rlKey = rateLimitKey(req, "workspace");
  const rlResponse = checkRateLimit(rlKey, 30, 60_000);
  if (rlResponse) return rlResponse;

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
