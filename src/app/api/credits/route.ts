// src/app/api/credits/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { paymentsEnabled } from "@/lib/server/credits/entitlement";
import { creditsCentralEnabled, centralBalance } from "@/lib/server/credits/credit-service";
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

  const packages = Object.entries(CREDIT_PACKAGES).map(([id, p]) => ({ id, credits: p.credits }));
  const topUpUrl = process.env.CREDIT_TOPUP_URL || undefined;

  // CREDITS_CENTRAL=on: Saldo zentral lesen (getBalance -> credits). Kauf laeuft
  // zentral (Website) -> der Client schickt "Buy" an topUpUrl statt /api/checkout.
  if (creditsCentralEnabled()) {
    const c = await centralBalance();
    if (!c) {
      // Zentraler Dienst gestoert -> 0 + degraded-Flag (Client kann erneut laden).
      return NextResponse.json(
        { ok: true, enabled: true, central: true, degraded: true, balance: 0, workspaceId: uid, packages, ...(topUpUrl ? { topUpUrl } : {}) },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { ok: true, enabled: true, central: true, balance: c.credits, workspaceId: c.workspaceId, packages, ...(topUpUrl ? { topUpUrl } : {}) },
      { status: 200 }
    );
  }

  const enabled = paymentsEnabled();

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
