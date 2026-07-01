import "server-only";

import { OperationInput } from "@azure/cosmos";
import { invoicesContainer, readItem } from "@/lib/cosmos";
import {
  BillingProfile,
  InvoiceCounterDoc,
  InvoiceDoc,
  SupplierProfile,
  TaxTreatment,
} from "./types";
import { checkVatId, isEuVatCountry, normalizeVatId } from "./vies";
import { renderInvoicePdf, INVOICE_TEMPLATE_VERSION } from "./invoice-pdf";
import { blobConfigured, invoiceBlobPath, uploadInvoicePdf } from "./invoice-blob";

/** Aussteller-Profil aus ENV (zum Ausstellungszeitpunkt eingefroren). */
export function supplierFromEnv(): SupplierProfile {
  return {
    companyName: process.env.INVOICE_SUPPLIER_NAME ?? "PulseNorth.AI",
    addressLine1: process.env.INVOICE_SUPPLIER_ADDRESS ?? "",
    postalCode: process.env.INVOICE_SUPPLIER_ZIP ?? "",
    city: process.env.INVOICE_SUPPLIER_CITY ?? "",
    country: (process.env.INVOICE_SUPPLIER_COUNTRY ?? process.env.SUPPLIER_COUNTRY ?? "DE").toUpperCase(),
    vatId: process.env.INVOICE_SUPPLIER_VATID || undefined,
    taxNumber: process.env.INVOICE_SUPPLIER_TAXNUMBER || undefined,
    email: process.env.INVOICE_SUPPLIER_EMAIL || undefined,
    iban: process.env.INVOICE_SUPPLIER_IBAN || undefined,
  };
}

/**
 * Native §14-UStG-Rechnung.
 *
 * GAPLOSE NUMMERNVERGABE (Lead-Loesung statt "Luecke akzeptieren + loggen"):
 * Counter-Doc und Invoice-Doc liegen in DERSELBEN Jahres-Partition des
 * `invoices`-Containers. Nummern-Inkrement (If-Match) und Invoice-Create laufen
 * in EINEM TransactionalBatch -> atomar. Schlaegt der Write fehl, wird der
 * Counter NICHT erhoeht => keine verlorene Nummer, kein GoBD-Verstoss.
 * Idempotenz: deterministische id inv:{paymentIntentId} (Stripe-Retry = 409).
 */

const SUPPLIER_COUNTRY = (process.env.SUPPLIER_COUNTRY ?? "DE").toUpperCase();
const STD_VAT_RATE = Number(process.env.STD_VAT_RATE ?? "0.19");
const MAX_RETRIES = 5;

// ---------------------------------------------------------------------------
// Steuerermittlung
// ---------------------------------------------------------------------------

export interface TaxDecision {
  treatment: TaxTreatment;
  rate: number; // 0.19 | 0
  note?: string; // Pflichthinweis bei Reverse-Charge
}

/**
 * v1-Scope: DE-Kunde -> 19 %; EU-Geschaeftskunde mit VIES-validierter USt-IdNr
 * -> Reverse-Charge 0 %; DE ohne USt-IdNr -> 19 % (B2C). Alles andere
 * konservativ 19 % (lieber zu viel ausweisen als zu wenig). Non-EU/OSS: v2.
 */
export function determineTax(opts: {
  customerCountry: string;
  vatValidated: boolean;
  hasVatId: boolean;
}): TaxDecision {
  const country = opts.customerCountry.toUpperCase();

  if (country === SUPPLIER_COUNTRY) {
    return { treatment: opts.hasVatId ? "domestic_19" : "domestic_b2c", rate: STD_VAT_RATE };
  }
  if (isEuVatCountry(country) && opts.hasVatId && opts.vatValidated) {
    return {
      treatment: "reverse_charge",
      rate: 0,
      note: "Steuerschuldnerschaft des Leistungsempfängers (Reverse-Charge, Art. 196 MwStSystRL).",
    };
  }
  // EU-B2C ohne valide ID / Non-EU -> konservativ Inlands-USt (v1).
  return { treatment: "domestic_19", rate: STD_VAT_RATE };
}

/**
 * Single Source of Truth (Option A, mit Gemini gelockt): das taxTreatment der
 * Rechnung wird aus Stripes TATSAECHLICHER Aufschluesselung abgeleitet — NICHT
 * aus einem unabhaengigen VIES-Check, der dem von Stripe Tax berechneten Charge
 * widersprechen koennte. Der Steuersatz kommt ebenfalls aus Stripe (tax/net).
 */
export function deriveTreatmentFromStripe(opts: {
  customerCountry: string;
  hasVatId: boolean;
  netCents: number;
  taxCents: number;
}): TaxDecision {
  const country = (opts.customerCountry || "").toUpperCase();
  const rate =
    opts.taxCents > 0 && opts.netCents > 0
      ? Math.round((opts.taxCents / opts.netCents) * 100) / 100
      : 0;

  if (opts.taxCents > 0) {
    // USt wurde erhoben: Inland (DE) oder EU-B2C (OSS, Kundenland-Satz).
    if (country === SUPPLIER_COUNTRY) {
      return { treatment: opts.hasVatId ? "domestic_19" : "domestic_b2c", rate };
    }
    return { treatment: "eu_oss", rate };
  }
  // Keine USt: EU-B2B Reverse-Charge (valide USt-IdNr) oder nicht steuerbar (Non-EU).
  if (isEuVatCountry(country) && country !== SUPPLIER_COUNTRY && opts.hasVatId) {
    return {
      treatment: "reverse_charge",
      rate: 0,
      note: "Steuerschuldnerschaft des Leistungsempfängers (Reverse-Charge, Art. 196 MwStSystRL).",
    };
  }
  return { treatment: "exempt", rate: 0, note: "Nicht im Inland steuerbare Leistung." };
}

/** Stripe-Betrag interpretieren: Reverse-Charge = reiner Netto; sonst Brutto inkl. USt. */
export function splitAmounts(chargedCents: number, decision: TaxDecision): {
  netCents: number;
  taxCents: number;
  grossCents: number;
} {
  if (decision.rate <= 0) {
    return { netCents: chargedCents, taxCents: 0, grossCents: chargedCents };
  }
  // Brutto inkl. USt -> Netto herausrechnen.
  const netCents = Math.round(chargedCents / (1 + decision.rate));
  const taxCents = chargedCents - netCents;
  return { netCents, taxCents, grossCents: chargedCents };
}

// ---------------------------------------------------------------------------
// Gaplose, atomare Nummernvergabe + Invoice-Create
// ---------------------------------------------------------------------------

async function executeInvoiceBatch(ops: OperationInput[], year: string) {
  try {
    const res: any = await invoicesContainer().items.batch(ops, year);
    const results: any[] = res?.result ?? [];
    const failedIdx = results.findIndex(
      (r) => typeof r?.statusCode === "number" && r.statusCode >= 400 && r.statusCode !== 424
    );
    const topOk = res?.code === undefined || res.code < 400;
    if (failedIdx === -1 && topOk) return { ok: true as const };
    const status = failedIdx >= 0 ? results[failedIdx].statusCode : res?.code ?? 0;
    return { ok: false as const, status };
  } catch (err: any) {
    return { ok: false as const, status: err?.code ?? err?.statusCode ?? 0 };
  }
}

export interface CreateInvoiceInput {
  paymentIntentId: string;
  workspaceId: string;
  issuedAtIso: string; // bestimmt das Jahr/die Partition
  billing: BillingProfile;
  /** Gesamtbetrag (Stripe amount_total) in Cents. */
  chargedCents: number;
  /**
   * Owner-Entscheidung: reine Netto-Anzeige ("exkl. MwSt.") -> Stripe liefert die
   * massgebliche Aufschluesselung. Wenn gesetzt, hat sie Vorrang vor der eigenen
   * Brutto-Herausrechnung (splitAmounts).
   */
  stripeNetCents?: number; // amount_subtotal
  stripeTaxCents?: number; // total_details.amount_tax
  currency: string;
  lineItemDescription: string;
}

/**
 * Erstellt (oder liefert idempotent) die Rechnung. Fuehrt VIES-Pruefung +
 * Steuerermittlung durch und vergibt die GoBD-Nummer atomar/gaplos.
 */
export async function createInvoice(input: CreateInvoiceInput): Promise<InvoiceDoc> {
  const year = input.issuedAtIso.slice(0, 4);
  const id = `inv:${input.paymentIntentId}`;

  // Idempotenz: existiert die Rechnung schon, unveraendert zurueckgeben.
  const existing = await readItem<InvoiceDoc>(invoicesContainer(), id, year);
  if (existing) return existing;

  const hasVatId = !!input.billing.vatId;
  // Stripes Aufschluesselung ist die Single Source of Truth (Stripe Tax hat USt
  // + VIES bereits am Point-of-Sale berechnet). Fallback ohne Breakdown: eigener
  // VIES-Check + determineTax (z. B. lokal ohne Stripe Tax).
  const useStripeBreakdown =
    typeof input.stripeNetCents === "number" && typeof input.stripeTaxCents === "number";

  let billing = input.billing;
  let decision: TaxDecision;

  if (useStripeBreakdown) {
    decision = deriveTreatmentFromStripe({
      customerCountry: billing.country,
      hasVatId,
      netCents: input.stripeNetCents!,
      taxCents: input.stripeTaxCents!,
    });
  } else {
    let vatValidated = input.billing.vatIdValidated === true;
    if (hasVatId && !vatValidated) {
      const { country } = normalizeVatId(input.billing.vatId!);
      const check = await checkVatId(input.billing.vatId!);
      vatValidated = check.valid;
      billing = {
        ...billing,
        vatIdValidated: check.valid,
        vatIdValidatedAt: check.checkedAt,
        country: billing.country || country || "",
      };
    }
    decision = determineTax({ customerCountry: billing.country, vatValidated, hasVatId });
  }

  const { netCents, taxCents, grossCents } = useStripeBreakdown
    ? {
        netCents: input.stripeNetCents!,
        taxCents: input.stripeTaxCents!,
        grossCents: input.stripeNetCents! + input.stripeTaxCents!,
      }
    : splitAmounts(input.chargedCents, decision);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const counter = await readItem<InvoiceCounterDoc>(invoicesContainer(), "counter", year);
    const lastSeq = counter?.lastSeq ?? 0;
    const seq = lastSeq + 1;
    const invoiceNumber = `RE-${year}-${String(seq).padStart(6, "0")}`;

    const invoice: InvoiceDoc = {
      id,
      year,
      type: "invoice",
      invoiceNumber,
      seq,
      workspaceId: input.workspaceId,
      stripePaymentIntentId: input.paymentIntentId,
      issuedAt: input.issuedAtIso,
      billing,
      supplier: supplierFromEnv(),
      netCents,
      taxCents,
      grossCents,
      taxRate: decision.rate,
      taxTreatment: decision.treatment,
      ...(decision.note ? { taxNote: decision.note } : {}),
      templateVersion: INVOICE_TEMPLATE_VERSION,
      currency: input.currency,
      lineItemDescription: input.lineItemDescription,
    };

    const ops: OperationInput[] = counter
      ? [
          {
            operationType: "Patch",
            id: "counter",
            ifMatch: counter._etag,
            resourceBody: { operations: [{ op: "set", path: "/lastSeq", value: seq }] },
          } as OperationInput,
          { operationType: "Create", resourceBody: invoice as any } as OperationInput,
        ]
      : [
          {
            operationType: "Create",
            resourceBody: { id: "counter", year, lastSeq: seq } as InvoiceCounterDoc as any,
          } as OperationInput,
          { operationType: "Create", resourceBody: invoice as any } as OperationInput,
        ];

    const outcome = await executeInvoiceBatch(ops, year);
    if (outcome.ok) return invoice;

    if (outcome.status === 412) continue; // Counter-ETag stale -> neu lesen & retry
    if (outcome.status === 409) {
      // Entweder Invoice existiert bereits (idempotent) oder Counter-Create-Race.
      const again = await readItem<InvoiceDoc>(invoicesContainer(), id, year);
      if (again) return again;
      continue; // Counter wurde parallel angelegt -> retry mit Patch-Pfad
    }
    throw new Error(`createInvoice failed (status ${outcome.status}) for ${id}`);
  }
  throw new Error(`createInvoice: konnte nach ${MAX_RETRIES} Versuchen keine Nummer vergeben (${id})`);
}

/**
 * EAGER-Rendering zum Ausstellungszeitpunkt (GoBD-Unveraenderbarkeit): rendert
 * das Invoice-PDF, laedt es in den Blob Storage und persistiert den Pfad am
 * Doc. Idempotent (pdfBlobPath gesetzt -> no-op). Ohne Blob-Config (z. B. lokal)
 * wird sauber uebersprungen.
 */
export async function ensureInvoicePdf(inv: InvoiceDoc): Promise<InvoiceDoc> {
  if (inv.pdfBlobPath) return inv;
  if (!blobConfigured()) return inv;

  const path = invoiceBlobPath(inv.year, inv.invoiceNumber);
  const pdf = await renderInvoicePdf(inv);
  await uploadInvoicePdf(path, pdf);

  const ts = new Date().toISOString();
  try {
    await invoicesContainer()
      .item(inv.id, inv.year)
      .patch([
        { op: "set", path: "/pdfBlobPath", value: path },
        { op: "set", path: "/pdfRenderedAt", value: ts },
      ] as any);
  } catch {
    // Best-effort: der Pfad ist deterministisch aus (year, invoiceNumber) rekonstruierbar.
  }
  return { ...inv, pdfBlobPath: path, pdfRenderedAt: ts };
}
