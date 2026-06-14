// src/app/api/checkout/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getStripe, resolvePriceId, stripeConfigured } from "@/lib/server/credits/stripe";
import { getWorkspaceDoc } from "@/lib/server/credits/ledger";
import { CheckoutRequestSchema, StripeSessionMetadata } from "@/lib/server/credits/types";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function baseUrl(req: NextRequest): string {
  return (
    process.env.APP_BASE_URL ??
    process.env.NEXTAUTH_URL ??
    new URL(req.url).origin
  ).replace(/\/$/, "");
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const { uid, email } = authResult;

  const rlKey = rateLimitKey(req, "checkout");
  const rlResponse = checkRateLimit(rlKey, 10, 60_000);
  if (rlResponse) return rlResponse;

  if (!stripeConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Payment not configured", code: "NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  try {
    const json = await req.json().catch(() => null);
    const parsed = CheckoutRequestSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
    }
    const { packageId, workspaceId } = parsed.data;

    // Autorisierung: User muss Mitglied des Workspaces sein (Solo: ws === uid).
    const ws = await getWorkspaceDoc(workspaceId);
    const authorized = ws ? ws.members.some((m) => m.uid === uid) : workspaceId === uid;
    if (!authorized) {
      return NextResponse.json({ ok: false, error: "Access denied", code: "FORBIDDEN" }, { status: 403 });
    }

    const priceId = resolvePriceId(packageId);

    // Sicherheits-Anker: workspaceId/uid/packageId NUR serverseitig in die
    // Session-Metadata; dem Client wird nie vertraut.
    const metadata: StripeSessionMetadata = {
      workspaceId,
      purchasedByUid: uid,
      packageId,
    };

    const base = baseUrl(req);
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: metadata as unknown as Record<string, string>,
      // payment_intent.metadata spiegeln -> steht auch am PaymentIntent/Invoice zur Verfuegung
      payment_intent_data: { metadata: metadata as unknown as Record<string, string> },
      client_reference_id: workspaceId,
      customer_email: email ?? undefined,
      // Native Rechnung: Adresse + USt-IdNr von Stripe Checkout erheben lassen
      // (Datenerfassung), Steuerermittlung/Rechnung passieren nativ im Webhook.
      billing_address_collection: "required",
      tax_id_collection: { enabled: true },
      success_url: `${base}/credits?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/credits?status=cancelled`,
      allow_promotion_codes: true,
    });

    logger.api("/api/checkout", "session-created", { uid, workspaceId, packageId });
    return NextResponse.json({ ok: true, url: session.url, sessionId: session.id }, { status: 200 });
  } catch (err: any) {
    logger.apiError("/api/checkout", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
