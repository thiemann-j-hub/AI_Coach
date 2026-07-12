import "server-only";

import Stripe from "stripe";
import { CREDIT_PACKAGES, CreditPackageId } from "./types";

/**
 * Stripe-Client + Paket-Aufloesung. Secret-Key/Webhook-Secret kommen aus ENV
 * (Key Vault). Wird lazy initialisiert, damit der Build ohne Secret durchlaeuft.
 */

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY ist nicht gesetzt.");
    // apiVersion explizit gepinnt (= Version des installierten SDK 17.7.0):
    // ohne Pin uebernimmt ein stilles SDK-Update die neue API-Version und kann
    // Live-Verhalten (Webhook-Shapes, Defaults) unbemerkt aendern.
    client = new Stripe(key, { apiVersion: "2025-02-24.acacia" });
  }
  return client;
}

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET;
}

/** Server-seitige Price-ID je Paket (nie aus dem Client lesen). */
export function resolvePriceId(packageId: CreditPackageId): string {
  const env = CREDIT_PACKAGES[packageId].priceEnv;
  const priceId = process.env[env];
  if (!priceId) throw new Error(`${env} ist nicht gesetzt.`);
  return priceId;
}

/** Default-Credits je Paket (Fallback, falls Price-Metadata credits_awarded fehlt). */
export function packageCredits(packageId: CreditPackageId): number {
  return CREDIT_PACKAGES[packageId].credits;
}
