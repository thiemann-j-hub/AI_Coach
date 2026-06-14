// src/app/api/credits/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { paymentsEnabled } from "@/lib/server/credits/entitlement";
import { resolveWorkspace } from "@/lib/server/credits/workspace-store";
import { getAvailableCredits } from "@/lib/server/credits/ledger";
import { CREDIT_PACKAGES } from "@/lib/server/credits/types";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Saldo + Paket-Katalog fuer die Credits-Seite. Loest den Workspace auf (inkl. Lazy Reconciliation). */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const { uid, email } = authResult;

  const rlKey = rateLimitKey(req, "credits");
  const rlResponse = checkRateLimit(rlKey, 30, 60_000);
  if (rlResponse) return rlResponse;

  const enabled = paymentsEnabled();
  const packages = Object.entries(CREDIT_PACKAGES).map(([id, p]) => ({ id, credits: p.credits }));

  if (!enabled) {
    return NextResponse.json({ ok: true, enabled: false, balance: 0, workspaceId: uid, packages }, { status: 200 });
  }

  try {
    const ws = await resolveWorkspace({ uid, email });
    const balance = await getAvailableCredits(ws.workspaceId);
    return NextResponse.json(
      { ok: true, enabled: true, balance, workspaceId: ws.workspaceId, packages },
      { status: 200 }
    );
  } catch (err: any) {
    logger.apiError("/api/credits", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
