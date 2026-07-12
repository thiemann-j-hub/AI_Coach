/**
 * F-10 (Master-Blueprint §1.1, Phase 2): Stripe-Payout-Reconciliation-Report.
 *
 * Stripe zahlt keine Einzel-Charges aufs Bankkonto aus, sondern gebuendelte
 * PAYOUTS (Summe vieler Charges MINUS Gebuehren). Dieses Script stellt die
 * lueckenlose Kette her:
 *
 *   Payout -> balance_transactions -> Charge -> PaymentIntent -> Rechnung
 *
 * Der letzte Schritt funktioniert, weil Rechnungen deterministisch als
 * id = `inv:{paymentIntentId}` im Cosmos-Container `invoices` liegen
 * (invoicing.ts). Ein PaymentIntent OHNE Rechnung ist genau der F-1-Befund
 * (zentraler Kaufweg erzeugt keine Rechnung) und wird als UNMATCHED gemeldet.
 *
 * READ-ONLY: keinerlei Writes (weder Stripe noch Cosmos). Gegen TEST wie LIVE
 * lauffaehig — der Key entscheidet.
 *
 * Lauf: STRIPE_SECRET_KEY=… COSMOS_ENDPOINT=… COSMOS_KEY=… node scripts/reconcile-payouts.mjs
 * Optional: PAYOUT_LIMIT (Default 20), COSMOS_DATABASE (Default coach).
 */
import Stripe from "stripe";
import { CosmosClient } from "@azure/cosmos";

const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey) throw new Error("STRIPE_SECRET_KEY ist nicht gesetzt.");
const stripe = new Stripe(stripeKey, { apiVersion: "2025-02-24.acacia" });

const invoices = new CosmosClient({
  endpoint: process.env.COSMOS_ENDPOINT,
  key: process.env.COSMOS_KEY,
  connectionPolicy: { retryOptions: { maxRetryAttemptCount: 9, maxWaitTimeInSeconds: 60 } },
})
  .database(process.env.COSMOS_DATABASE ?? "coach")
  .container("invoices");

const PAYOUT_LIMIT = Number(process.env.PAYOUT_LIMIT ?? 20);

/** Rechnung per deterministischer ID cross-partition suchen (pk=/year unbekannt). */
async function findInvoice(paymentIntentId) {
  const { resources } = await invoices.items
    .query({
      query: "SELECT c.id, c.invoiceNumber, c.year, c.taxTreatment FROM c WHERE c.id = @id",
      parameters: [{ name: "@id", value: `inv:${paymentIntentId}` }],
    })
    .fetchAll();
  return resources[0] ?? null;
}

/** Alle balance_transactions eines Payouts (paginiert). */
async function payoutTransactions(payoutId) {
  const all = [];
  for await (const bt of stripe.balanceTransactions.list(
    { payout: payoutId, limit: 100, expand: ["data.source"] },
  )) {
    all.push(bt);
  }
  return all;
}

function euro(cents, currency = "eur") {
  return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

function entryDate(unixSeconds) {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

async function main() {
  const mode = stripeKey.startsWith("sk_live") ? "LIVE" : "TEST";
  console.log(`Payout-Reconciliation (${mode}-Modus, max. ${PAYOUT_LIMIT} Payouts)\n`);

  const report = { mode, generated: new Date().toISOString(), payouts: [], summary: {} };
  let payoutCount = 0;

  // Stripe erlaubt limit<=100 als Page-Size; die Gesamtmenge steuert der Zaehler.
  for await (const po of stripe.payouts.list({ limit: Math.min(PAYOUT_LIMIT, 100) })) {
    payoutCount++;
    if (payoutCount > PAYOUT_LIMIT) break;

    const bts = await payoutTransactions(po.id);
    // Der Payout selbst erscheint als bt type="payout" (negativ) — fuer die
    // Summen-Kontrolle zaehlen alle UEBRIGEN Transaktionen des Bundles.
    const items = bts.filter((bt) => bt.type !== "payout");
    const netSum = items.reduce((s, bt) => s + bt.net, 0);
    const feeSum = items.reduce((s, bt) => s + bt.fee, 0);
    const grossSum = items.reduce((s, bt) => s + bt.amount, 0);

    const entry = {
      payoutId: po.id,
      status: po.status,
      arrivalDate: new Date(po.arrival_date * 1000).toISOString().slice(0, 10),
      amount: po.amount,
      currency: po.currency,
      statementDescriptor: po.statement_descriptor ?? null,
      transactions: items.length,
      grossCents: grossSum,
      feeCents: feeSum,
      // Bank-Kontrolle Stufe 1: Payout-Betrag == Netto-Summe des Bundles?
      netMatchesPayout: netSum === po.amount,
      charges: [],
      unmatched: [],
      // Refunds/Disputes/Adjustments duerfen NICHT stumm in den Summen
      // verschwinden: Geldrueckfluesse brauchen einen Storno-Beleg (F-5) —
      // hier mindestens sichtbar itemisiert.
      otherTx: [],
    };

    for (const bt of items) {
      if (bt.type !== "charge" && bt.type !== "payment") {
        const src = bt.source;
        entry.otherTx.push({
          balanceTx: bt.id,
          type: bt.type,
          netCents: bt.net,
          source: typeof src === "object" && src !== null ? src.id : src ?? null,
        });
        continue;
      }
      const src = bt.source;
      const piId =
        typeof src === "object" && src !== null
          ? typeof src.payment_intent === "string"
            ? src.payment_intent
            : src.payment_intent?.id ?? null
          : null;
      if (!piId) {
        entry.unmatched.push({ balanceTx: bt.id, reason: "kein PaymentIntent an der Charge" });
        continue;
      }
      const inv = await findInvoice(piId);
      if (inv) {
        entry.charges.push({
          paymentIntent: piId,
          grossCents: bt.amount,
          feeCents: bt.fee,
          invoice: inv.invoiceNumber,
          taxTreatment: inv.taxTreatment ?? null,
        });
      } else {
        // F-1-Befund: Zahlung ohne §14-Rechnung (z. B. zentraler Kaufweg).
        entry.unmatched.push({ paymentIntent: piId, grossCents: bt.amount, reason: "KEINE Rechnung inv:{pi} in Cosmos" });
      }
    }

    report.payouts.push(entry);
    const flag = entry.unmatched.length || entry.otherTx.length ? "⚠" : "✓";
    console.log(
      `${flag} Payout ${po.id} [${po.status}] ${euro(po.amount, po.currency)} (Ankunft ${entry.arrivalDate})` +
        ` — ${entry.charges.length} Charge(s) mit Rechnung, ${entry.unmatched.length} UNMATCHED,` +
        ` ${entry.otherTx.length} Refund/Sonstige,` +
        ` Netto-Kontrolle ${entry.netMatchesPayout ? "OK" : "ABWEICHUNG"}` +
        ` (brutto ${euro(entry.grossCents)}, Gebuehren ${euro(entry.feeCents)})`
    );
    for (const o of entry.otherTx) {
      console.log(`   ⚠ ${o.type}: ${o.balanceTx} ${euro(o.netCents)} — Rueckfluss ohne Storno-Beleg-Pruefung (F-5 offen)`);
    }
    for (const u of entry.unmatched) {
      console.log(`   ⚠ UNMATCHED: ${u.paymentIntent ?? u.balanceTx} — ${u.reason}${u.grossCents ? ` (${euro(u.grossCents)})` : ""}`);
    }
  }

  // Stufe-2-Kette auch OHNE Payout beweisen: die letzten Charges direkt gegen
  // die Rechnungen matchen. Deckt im LIVE-Betrieb zusaetzlich frische Charges
  // ab, die noch in keinem Payout gebuendelt sind.
  const CHARGE_LIMIT = Number(process.env.CHARGE_LIMIT ?? 20);
  report.recentCharges = [];
  let chargeCount = 0;
  for await (const ch of stripe.charges.list({ limit: Math.min(CHARGE_LIMIT, 100) })) {
    // Nur RELEVANTE (bezahlte) Charges zaehlen gegen das Limit — sonst
    // verdraengen failed-Charges echte F-1-Kandidaten aus dem Scan.
    if (!ch.paid || ch.status !== "succeeded") continue;
    chargeCount++;
    if (chargeCount > CHARGE_LIMIT) break;
    const piId = typeof ch.payment_intent === "string" ? ch.payment_intent : ch.payment_intent?.id ?? null;
    const inv = piId ? await findInvoice(piId) : null;
    report.recentCharges.push({
      charge: ch.id,
      created: new Date(ch.created * 1000).toISOString().slice(0, 10),
      grossCents: ch.amount,
      refunded: ch.refunded,
      paymentIntent: piId,
      invoice: inv?.invoiceNumber ?? null,
    });
    const flag = inv ? "✓" : "⚠";
    console.log(
      `${flag} Charge ${ch.id} (${entryDate(ch.created)}) ${euro(ch.amount, ch.currency)} → PI ${piId ?? "—"} → ` +
        (inv ? `Rechnung ${inv.invoiceNumber}` : "KEINE Rechnung (F-1-Befund oder Fremd-Charge)")
    );
  }

  // Gegenrichtung (Kontext): wie viele Rechnungen existieren insgesamt?
  const { resources: cnt } = await invoices.items
    .query({ query: "SELECT VALUE COUNT(1) FROM c WHERE STARTSWITH(c.id, 'inv:')" })
    .fetchAll();

  report.summary = {
    payoutsScanned: report.payouts.length,
    payoutsClean: report.payouts.filter((p) => !p.unmatched.length && p.netMatchesPayout).length,
    unmatchedTotal: report.payouts.reduce((s, p) => s + p.unmatched.length, 0),
    chargesScanned: report.recentCharges.length,
    chargesWithInvoice: report.recentCharges.filter((c) => c.invoice).length,
    chargesWithoutInvoice: report.recentCharges.filter((c) => !c.invoice).length,
    invoicesInCosmos: cnt[0] ?? 0,
  };

  console.log(`\nSummary: ${JSON.stringify(report.summary)}`);
  if (payoutCount === 0) {
    console.log("(Keine Payouts im Konto — in TEST entstehen Payouts erst nach Settlement-Zyklus.)");
  }
  console.log("\nJSON-Report:");
  console.log(JSON.stringify(report, null, 1));
}

main().catch((e) => {
  console.error("Reconciliation fehlgeschlagen:", e?.message ?? e);
  process.exit(1);
});
