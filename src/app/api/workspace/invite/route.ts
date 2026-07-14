// src/app/api/workspace/invite/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Team-Einladung — INAKTIV (KK-1): Teil des abgebauten lokalen
 * PAYMENTS_ENABLED-Stacks (nie live; Prod laeuft auf CREDITS_CENTRAL=on).
 * Definierte inaktiv-Antwort, identisch zum frueheren PAYMENTS_ENABLED=off-
 * Verhalten, weil das /workspace-UI die Route referenziert.
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const rlKey = rateLimitKey(req, "workspace-invite");
  const rlResponse = checkRateLimit(rlKey, 10, 60_000);
  if (rlResponse) return rlResponse;

  return NextResponse.json(
    { ok: false, error: "Feature disabled", code: "FEATURE_DISABLED" },
    { status: 403 }
  );
}
