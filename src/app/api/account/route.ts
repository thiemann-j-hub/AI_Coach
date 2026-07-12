import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { deleteAccount } from "@/lib/server/account-delete";

export const runtime = "nodejs";

/**
 * R8 — DELETE /api/account
 * Vollständige Löschung der personenbezogenen Daten des eingeloggten Nutzers
 * (Lern-Historie + Sessions + Nutzungs-Zähler + Entra-Token-Store + Profil).
 * Rechnungen bleiben (gesetzliche Aufbewahrung). Der Client loggt danach aus.
 *
 * Irreversibel → verlangt Bestätigung im Body: { "confirm": "DELETE" }.
 */
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const rl = checkRateLimit(rateLimitKey(req, "account-del"), 3, 60_000);
  if (rl) return rl;

  let body: { confirm?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* leerer Body → confirmation_required unten */
  }
  if (body?.confirm !== "DELETE") {
    return NextResponse.json(
      { ok: false, error: "confirmation_required", code: "CONFIRM_REQUIRED" },
      { status: 400 }
    );
  }

  const { uid, oid } = auth;
  try {
    const result = await deleteAccount(uid, oid);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[account] delete failed:", e);
    return NextResponse.json({ ok: false, error: "delete_failed", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
