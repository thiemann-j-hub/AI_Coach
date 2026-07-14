// src/app/api/credits/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { creditsCentralEnabled, centralWalletStatus } from "@/lib/server/credits/credit-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Anzeige-Katalog fuer die Credits-Seite. Der KAUF laeuft zentral ueber die
 * Website (topUpUrl) — die Stripe-Price-Zuordnung lebt im zentralen
 * Credit-Service, hier ist nur noch die Darstellung (KK-1: lokaler
 * Checkout/CREDIT_PACKAGES-Stack abgebaut).
 */
const DISPLAY_PACKAGES = [
  { id: "single", credits: 1 },
  { id: "pack_5", credits: 5 },
];

/** Saldo + Paket-Katalog fuer die Credits-Seite (CREDITS_CENTRAL: Saldo kommt zentral). */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const { uid } = authResult;

  const rlKey = rateLimitKey(req, "credits");
  const rlResponse = checkRateLimit(rlKey, 30, 60_000);
  if (rlResponse) return rlResponse;

  const packages = DISPLAY_PACKAGES;
  const topUpUrl = process.env.CREDIT_TOPUP_URL || undefined;

  // CREDITS_CENTRAL=on: Saldo zentral lesen — Token kommt aus dem Server-Store
  // (getValid(oid), refresht bei Bedarf). Kauf laeuft zentral (Website) -> der
  // Client schickt "Buy" an topUpUrl.
  if (creditsCentralEnabled()) {
    const w = await centralWalletStatus();
    // expired (Token tot / CreditService-401) -> Re-Login signalisieren, NICHT
    // still als „0" maskieren. Saldo + Workspace echt unbekannt (null).
    if (w.state === "expired") {
      return NextResponse.json(
        { ok: true, enabled: true, central: true, sessionExpired: true, balance: null, workspaceId: null, packages, ...(topUpUrl ? { topUpUrl } : {}) },
        { status: 200 }
      );
    }
    // inert (Bestandssession ohne Store-Doc / transienter Hiccup) -> degraded:
    // Chip versteckt, /credits zeigt „—" (kein 0-Default). Re-Login seedet den Store.
    if (w.state === "inert") {
      return NextResponse.json(
        { ok: true, enabled: true, central: true, degraded: true, balance: null, workspaceId: null, packages, ...(topUpUrl ? { topUpUrl } : {}) },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { ok: true, enabled: true, central: true, balance: w.credits, workspaceId: w.workspaceId, packages, ...(topUpUrl ? { topUpUrl } : {}) },
      { status: 200 }
    );
  }

  // CREDITS_CENTRAL=off (z. B. lokal): kein Credit-System aktiv — inerte Huelle
  // (der lokale Ledger-Pfad wurde mit KK-1 abgebaut).
  return NextResponse.json({ ok: true, enabled: false, balance: 0, workspaceId: uid, packages }, { status: 200 });
}
