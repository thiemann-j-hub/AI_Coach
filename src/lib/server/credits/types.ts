import "server-only";

import { z } from "zod";

/**
 * Datenmodell des Credit-/Workspace-Systems.
 *
 * Architektur im Sparring mit Gemini gelockt (2026-06-14):
 *   - Eigener Container `workspaces` (pk /workspaceId) im Single-Container-
 *     Design: mehrere Doc-Typen, ALLE mit derselben workspaceId-Partition.
 *     Dadurch ist jede Mehr-Doc-Mutation via Cosmos TransactionalBatch ACID
 *     (kein Cross-Container-, kein Cross-Partition-Write im heissen Pfad).
 *   - Die bestehenden Container users/sessions/runs bleiben unveraendert;
 *     jedes User-Doc bekommt nur ein zusaetzliches `workspaceId`-Feld
 *     (Default Solo-Workspace = uid). Kein Big-Bang-PK-Reset.
 *   - Free-Run-Gate liegt UEBER dem Workspace in einem eigenen Container
 *     `domains` (pk /domain): 1 kostenlose Analyse pro verifizierter B2B-Domain.
 *
 * Konvention (wie RunDoc/SessionDoc in runs-store.ts): interne Doc-Shapes sind
 * TS-Interfaces; ein ISO-String ist der Zeitstempel (Cosmos hat keinen
 * Timestamp-Typ). Trust-Boundary-Eingaben (API-Bodies, Stripe-Metadata) werden
 * dagegen mit Zod runtime-validiert (z.infer fuer den Typ).
 */

// ===========================================================================
// Container: workspaces (pk /workspaceId) — discriminated union ueber `type`
// ===========================================================================

export type WorkspaceDocType =
  | "workspace"
  | "creditBatch"
  | "ledger"
  | "stripeEvent";

/** Gemeinsame Felder aller Docs im workspaces-Container. */
export interface WorkspaceScopedDoc {
  id: string;
  /** Partition Key. */
  workspaceId: string;
  type: WorkspaceDocType;
  /** Cosmos-ETag fuer If-Match/OCC; nur beim Lesen gesetzt, nie selbst schreiben. */
  _etag?: string;
}

export const MAX_WORKSPACE_MEMBERS = 3;

export type WorkspaceRole = "owner" | "member";

export interface WorkspaceMember {
  uid: string;
  email: string;
  role: WorkspaceRole;
  addedAt: string;
}

/**
 * Stamm-Dokument: Saldo + Mitglieder. id === workspaceId.
 * `balance` ist der denormalisierte Schnell-Saldo (gueltige Batches minus
 * offene Holds); Quelle der Wahrheit bleiben die einzelnen creditBatch-Docs.
 */
export interface WorkspaceDoc extends WorkspaceScopedDoc {
  type: "workspace";
  ownerUid: string;
  members: WorkspaceMember[]; // inkl. owner, max MAX_WORKSPACE_MEMBERS
  balance: number;
  billing?: BillingProfile;
  createdAt: string;
  updatedAt: string;
}

export type CreditSource = "free" | "purchase" | "grant";

/** Ein gekauftes/gewaehrtes Paket mit eigenem Verfall (FIFO-Konsum). */
export interface CreditBatchDoc extends WorkspaceScopedDoc {
  type: "creditBatch";
  /** Verbleibende (noch nicht verbrauchte) Credits in diesem Batch. */
  amount: number;
  /** Urspruengliche Menge — fuer Reporting, nie mutiert. */
  originalAmount: number;
  source: CreditSource;
  /** ISO; FIFO konsumiert den am fruehesten ablaufenden, noch gueltigen Batch zuerst. */
  expiresAt: string;
  createdAt: string;
  /** Stripe-Zahlungsreferenz, falls source === "purchase". */
  stripePaymentIntentId?: string;
}

export type LedgerReason =
  | "purchase"
  | "consume"
  | "refund_user_delete"
  | "refund_technical_failure"
  | "refund_hold_expired"
  | "free_grant";

export type LedgerStatus = "pending" | "settled" | "refunded";

/**
 * Eine Kontobewegung. Verbrauch laeuft als zweiphasiger Hold:
 *   reserve -> status "pending" (Saldo bereits -1, Batch bereits dekrementiert)
 *   settle  -> status "settled" (Analyse erfolgreich)
 *   refund  -> status "refunded" + Gegenbuchung (User-Delete / Technik / Hold-Verfall)
 *
 * Deterministische IDs sichern Idempotenz ueber alle drei Refund-Trigger:
 *   hold:{runId}            (Reservierung beim Analyse-Start)
 *   refund:{runId}          (Rueckbuchung — EINE Primitive, egal welcher Trigger)
 *   purchase:{stripeEventId}(Gutschrift aus Kauf)
 */
export interface LedgerDoc extends WorkspaceScopedDoc {
  type: "ledger";
  /** -1 Verbrauch, +N Kauf/Refund. */
  delta: number;
  reason: LedgerReason;
  status: LedgerStatus;
  runId?: string;
  /** Welcher Batch belastet wurde — fuer praezise Rueckbuchung in denselben Batch. */
  batchId?: string;
  /** Nur bei status === "pending": Frist, ab der ein uncatchable-Hold per Lazy Reconciliation zurueckgebucht wird. */
  holdExpiresAt?: string;
  createdAt: string;
  settledAt?: string;
}

/** Idempotenz-Anker fuer Stripe-Webhooks. id === stripe event.id (409 = bereits verarbeitet). */
export interface StripeEventDoc extends WorkspaceScopedDoc {
  type: "stripeEvent";
  eventType: string;
  processedAt: string;
}

// ===========================================================================
// Billing (native §14-UStG-Rechnung) — Profil am Workspace, Invoice als Doc
// ===========================================================================

/** Rechnungsprofil; vatId bestimmt die Reverse-Charge-Logik. */
export interface BillingProfile {
  companyName: string;
  addressLine1: string;
  addressLine2?: string;
  postalCode: string;
  city: string;
  /** ISO-3166-1 alpha-2 (z. B. "DE", "AT"). */
  country: string;
  /** USt-IdNr; bei EU-Ausland + VIES-validiert -> Reverse-Charge. */
  vatId?: string;
  vatIdValidated?: boolean;
  vatIdValidatedAt?: string;
}

export type TaxTreatment =
  | "domestic_19" // DE-Kunde: 19 % USt
  | "reverse_charge" // EU-Geschaeftskunde mit valider USt-IdNr: 0 %, Steuerschuldnerschaft des Leistungsempfaengers
  | "domestic_b2c"; // DE ohne USt-IdNr (Privat): 19 %

/**
 * Rechnung im `invoices`-Container (pk /year). Nummernzaehler liegt in derselben
 * Jahres-Partition (CounterDoc) -> atomare, gaplose Vergabe per TransactionalBatch.
 * id ist deterministisch (inv:{paymentIntentId}) => Stripe-Retry = 409 = idempotent.
 */
/** Aussteller (Leistungserbringer) — aus ENV, zum Ausstellungszeitpunkt eingefroren. */
export interface SupplierProfile {
  companyName: string;
  addressLine1: string;
  postalCode: string;
  city: string;
  country: string;
  vatId?: string; // eigene USt-IdNr
  taxNumber?: string; // Steuernummer
  email?: string;
  iban?: string;
}

export interface InvoiceDoc {
  id: string; // "inv:{paymentIntentId}"
  /** Partition Key: Kalenderjahr der Ausstellung, z. B. "2026". */
  year: string;
  type: "invoice";
  /** GoBD: fortlaufende, lueckenlose Rechnungsnummer, z. B. "RE-2026-000001". */
  invoiceNumber: string;
  /** Laufende Nummer innerhalb des Jahres (fuer den Zaehler). */
  seq: number;
  workspaceId: string;
  stripePaymentIntentId: string;
  issuedAt: string;
  /** Snapshot des Rechnungsprofils zum Ausstellungszeitpunkt (NICHT die mutable workspace.billing-Referenz). */
  billing: BillingProfile;
  /** Aussteller-Snapshot (GoBD-Unveraenderbarkeit). */
  supplier: SupplierProfile;
  netCents: number;
  taxCents: number;
  grossCents: number;
  taxRate: number; // 0.19 | 0
  taxTreatment: TaxTreatment;
  /** Pflichthinweis (z. B. Reverse-Charge) — eingefroren fuer das PDF. */
  taxNote?: string;
  /** PDF-Template-Version zum Ausstellungszeitpunkt — verhindert visuellen GoBD-Drift beim Lazy-Rerender. */
  templateVersion?: string;
  currency: string; // "eur"
  lineItemDescription: string;
  /** Blob-Pfad des eager gerenderten PDF (GoBD-immutabel); NIE base64 im Doc. */
  pdfBlobPath?: string;
  pdfRenderedAt?: string;
  _etag?: string;
}

/** Globaler, jahresweise zuruckgesetzter Nummernzaehler. id="counter", pk=year. */
export interface InvoiceCounterDoc {
  id: "counter";
  year: string;
  lastSeq: number;
  _etag?: string;
}

// ===========================================================================
// Container: domains (pk /domain) — Free-Run-Gate pro verifizierter B2B-Domain
// ===========================================================================

export interface DomainClaimDoc {
  /** === normalisierte Domain (alles nach dem @, lowercase). */
  id: string;
  /** Partition Key. */
  domain: string;
  freeRunClaimedAt: string;
  claimedByWorkspaceId: string;
  claimedByUid: string;
}

// ===========================================================================
// Pakete + Trust-Boundary (Zod): inbound API-Bodies & Stripe-Metadata
// ===========================================================================

/**
 * Kauf-Pakete. Die Stripe Price-ID kommt serverseitig aus ENV (nie aus dem
 * Client); credits_awarded liest der Webhook blind aus der Price-Metadata.
 */
export const CREDIT_PACKAGES = {
  single: { credits: 1, priceEnv: "STRIPE_PRICE_SINGLE" },
  pack_5: { credits: 5, priceEnv: "STRIPE_PRICE_PACK_5" },
} as const;

export type CreditPackageId = keyof typeof CREDIT_PACKAGES;

export const CheckoutRequestSchema = z.object({
  packageId: z.enum(["single", "pack_5"]),
  workspaceId: z.string().min(1),
});
export type CheckoutRequest = z.infer<typeof CheckoutRequestSchema>;

/** Was wir SERVER-SEITIG in die Stripe-Session-Metadata schreiben — dem Client nie vertrauen. */
export const StripeSessionMetadataSchema = z.object({
  workspaceId: z.string().min(1),
  purchasedByUid: z.string().min(1),
  packageId: z.enum(["single", "pack_5"]),
});
export type StripeSessionMetadata = z.infer<typeof StripeSessionMetadataSchema>;

/** Default-Gueltigkeit gekaufter Credits: 12 Monate. */
export const CREDIT_TTL_MONTHS = 12;
