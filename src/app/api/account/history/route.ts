import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { deleteLearningHistory } from "@/lib/server/account-delete";

export const runtime = "nodejs";

/**
 * R8 — DELETE /api/account/history
 * Löscht die Lern-Historie des eingeloggten Nutzers HART (alle runs + Radar-
 * Messpunkte). Account/Credits/Rechnungen bleiben bestehen. Auth-gated (nur die
 * eigene uid), rate-limitiert.
 */
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const rl = checkRateLimit(rateLimitKey(req, "account-history-del"), 5, 60_000);
  if (rl) return rl;

  const { uid, oid } = auth;
  try {
    const result = await deleteLearningHistory(uid, oid);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[account/history] delete failed:", e);
    return NextResponse.json({ ok: false, error: "delete_failed", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
