// src/app/api/webhooks/stripe/route.ts
import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/server/credits/stripe";
import { packageCredits } from "@/lib/server/credits/stripe";
import { grantCredits } from "@/lib/server/credits/ledger";
import { createInvoice, ensureInvoicePdf } from "@/lib/server/credits/invoicing";
import { BillingProfile, StripeSessionMetadataSchema } from "@/lib/server/credits/types";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe-Webhook (Backend-Herzstueck).
 *   - Signatur-Verifikation (STRIPE_WEBHOOK_SECRET) ueber den ROHEN Body.
 *   - Idempotenz: grantCredits legt ein stripeEvent-Doc (id = event.id) im
 *     selben TransactionalBatch an -> 409 = bereits verarbeitet = no-op.
 *   - Gutschrift: credits_awarded blind aus der Price-Metadata (Fallback:
 *     Paket-Default). Kein Summen-/Quantity-Rechnen im Code.
 *   - DB-Fehler -> 500, damit Stripe den Event automatisch erneut zustellt.
 */

/** Rechnungsprofil aus den von Stripe Checkout erhobenen Kundendaten ableiten. */
function billingFromSession(session: Stripe.Checkout.Session): BillingProfile {
  const cd = session.customer_details;
  const addr = cd?.address;
  const vatId = cd?.tax_ids?.find((t) => !!t.value)?.value ?? undefined;
  return {
    companyName: cd?.name ?? "",
    addressLine1: addr?.line1 ?? "",
    addressLine2: addr?.line2 ?? undefined,
    postalCode: addr?.postal_code ?? "",
    city: addr?.city ?? "",
    country: (addr?.country ?? "").toUpperCase(),
    vatId,
  };
}

async function resolveCreditsAwarded(
  session: Stripe.Checkout.Session,
  packageId: "single" | "pack_5"
): Promise<number> {
  try {
    const items = await getStripe().checkout.sessions.listLineItems(session.id, {
      expand: ["data.price"],
      limit: 1,
    });
    const price = items.data[0]?.price;
    const fromMeta = price?.metadata?.credits_awarded;
    const parsed = fromMeta ? parseInt(fromMeta, 10) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  } catch (e) {
    logger.apiError("/api/webhooks/stripe/lineitems", e);
  }
  return packageCredits(packageId);
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "Webhook not configured" }, { status: 503 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ ok: false, error: "Missing signature" }, { status: 400 });
  }

  // ROHER Body — zwingend fuer die Signaturpruefung.
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, sig, secret);
  } catch (err: any) {
    logger.apiError("/api/webhooks/stripe/verify", err);
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      if (session.payment_status !== "paid") {
        // z. B. async-Zahlart noch nicht abgeschlossen -> ignorieren, kein Fehler.
        return NextResponse.json({ ok: true, ignored: "not_paid" }, { status: 200 });
      }

      const meta = StripeSessionMetadataSchema.safeParse(session.metadata ?? {});
      if (!meta.success) {
        logger.apiError("/api/webhooks/stripe/metadata", new Error("invalid session metadata"));
        // Kein DB-Fehler -> 200, damit Stripe nicht endlos retryed.
        return NextResponse.json({ ok: false, error: "bad metadata" }, { status: 200 });
      }
      const { workspaceId, packageId } = meta.data;

      const amount = await resolveCreditsAwarded(session, packageId);
      const paymentIntentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id;

      const res = await grantCredits({
        workspaceId,
        amount,
        source: "purchase",
        expiresInMonths: 12,
        stripeEventId: event.id,
        stripeEventType: event.type,
        stripePaymentIntentId: paymentIntentId,
      });

      logger.api("/api/webhooks/stripe", "credited", {
        workspaceId,
        amount,
        eventId: event.id,
        granted: res.granted,
      });

      // Native §14-UStG-Rechnung (best-effort: Fehler blockiert die Gutschrift
      // nicht; die gaplose Nummernvergabe macht einen Retry unkritisch).
      if (paymentIntentId) {
        try {
          const billing = billingFromSession(session);
          const invoice = await createInvoice({
            paymentIntentId,
            workspaceId,
            issuedAtIso: new Date().toISOString(),
            billing,
            chargedCents: session.amount_total ?? 0,
            // Netto-Anzeige: Stripes Aufschluesselung ist massgeblich.
            stripeNetCents: session.amount_subtotal ?? undefined,
            stripeTaxCents: session.total_details?.amount_tax ?? undefined,
            currency: session.currency ?? "eur",
            lineItemDescription: `PulseCraft Coach — ${amount} Analyse-Credit(s)`,
          });
          // EAGER-Rendering zum Ausstellungszeitpunkt (GoBD): PDF -> Blob, Pfad ans Doc.
          await ensureInvoicePdf(invoice);
        } catch (e) {
          logger.apiError("/api/webhooks/stripe/invoice", e);
        }
      }
    }

    return NextResponse.json({ ok: true, received: true }, { status: 200 });
  } catch (err: any) {
    // DB-/Verarbeitungsfehler -> 500 -> Stripe-Retry.
    logger.apiError("/api/webhooks/stripe", err);
    return NextResponse.json({ ok: false, error: "processing error" }, { status: 500 });
  }
}
