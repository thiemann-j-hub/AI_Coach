// Synthetisch signierter checkout.session.completed-Event fuer den
// Reverse-Charge-Pfad (AT-B2B mit USt-IdNr, amount_tax=0). Durchlaeuft den
// ECHTEN Webhook (Signatur-Verify -> grant -> createInvoice -> eager PDF),
// nur mit AT-Billing statt Stripe-UI. Direkter POST, signiert mit dem
// STRIPE_WEBHOOK_SECRET aus .env.local (gleiches Secret, das der Dev-Server
// laedt) -> Signatur verifiziert ohne `stripe listen`.
//
//   node scripts/provision/synthetic-rc-webhook.mjs [workspaceId]
import { readFileSync } from "node:fs";
import Stripe from "stripe";

function loadEnv() {
  try {
    const t = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
    for (const l of t.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {}
}
loadEnv();

const workspaceId = process.argv[2] || "AAAAAAAAAAAAAAAAAAAAABy7922ENpL66OHr24htU10";
const secret = process.env.STRIPE_WEBHOOK_SECRET;
const endpoint = (process.env.APP_BASE_URL || "http://localhost:9002") + "/api/webhooks/stripe";
if (!secret) { console.error("STRIPE_WEBHOOK_SECRET fehlt"); process.exit(1); }

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_dummy");

// Eindeutige IDs (inv:{paymentIntentId} muss frisch sein, sonst idempotent no-op)
const uniq = Date.now().toString(36);
const piId = "pi_test_rc_" + uniq;

const session = {
  id: "cs_test_rc_" + uniq,
  object: "checkout.session",
  payment_status: "paid",
  status: "complete",
  mode: "payment",
  currency: "eur",
  amount_subtotal: 900,           // 9,00 EUR netto
  amount_total: 900,              // = netto (keine USt bei Reverse-Charge)
  total_details: { amount_tax: 0, amount_discount: 0, amount_shipping: 0 },
  payment_intent: piId,
  client_reference_id: workspaceId,
  customer_details: {
    email: "office@example-at.test",
    name: "Pulscraft Test AT GmbH",
    address: { line1: "Stephansplatz 1", line2: null, city: "Wien", postal_code: "1010", state: null, country: "AT" },
    tax_ids: [{ type: "eu_vat", value: "ATU12345678" }],
  },
  metadata: { workspaceId, packageId: "single", purchasedByUid: workspaceId },
};

const event = {
  id: "evt_test_rc_" + uniq,
  object: "event",
  type: "checkout.session.completed",
  data: { object: session },
};

const payload = JSON.stringify(event);
const header = stripe.webhooks.generateTestHeaderString({ payload, secret });

console.log("POST", endpoint);
console.log("  event.id        =", event.id);
console.log("  payment_intent  =", piId);
console.log("  country/vat     = AT / ATU12345678 (amount_tax=0 -> Reverse-Charge)");

const res = await fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json", "stripe-signature": header },
  body: payload,
});
const text = await res.text();
console.log("\nRESPONSE", res.status, text);
