import "server-only";

/**
 * Datenmodell des Credit-/Workspace-Systems — LESE-SEITE.
 *
 * KK-1 (Go-Live-Blueprint): Der lokale Geld-Stack (FIFO-Ledger, Stripe-Checkout,
 * Free-Run-Domain-Claims) wurde abgebaut; die zugehoerigen Doc-Typen
 * (creditBatch/ledger/stripeEvent/DomainClaim) und Checkout-Schemas sind mit
 * ihm gestorben. Physisch koennen Alt-Docs dieser Typen noch im workspaces-
 * Container liegen — es gibt aber keinen Code-Pfad mehr, der sie liest oder
 * schreibt. Wallet/Grants/Refunds leben im zentralen CreditService.
 *
 * Hier verbleiben:
 *   - WorkspaceDoc & Co. (Membership-Check der Rechnungs-Lese-Route)
 *   - InvoiceDoc & Co. (coach/invoices ist der ZENTRALE Rechnungs-Store;
 *     die SCHREIB-Seite lebt seit F-1 im Credit-Service-Webhook)
 */

// ===========================================================================
// Container: workspaces (pk /workspaceId)
// ===========================================================================

/** Gemeinsame Felder der (noch gelesenen) Docs im workspaces-Container. */
export interface WorkspaceScopedDoc {
  id: string;
  /** Partition Key. */
  workspaceId: string;
  type: "workspace";
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
 * Offene E-Mail-Einladung (Alt-Datenbestand des Team-Features; der Claim-Code
 * wurde mit dem lokalen Geld-Stack abgebaut, das Feld kann in Alt-Docs stehen).
 */
export interface PendingInvite {
  /** Normalisierte (lowercase, getrimmte) E-Mail des Eingeladenen. */
  email: string;
  invitedByUid: string;
  invitedAt: string;
  /** Optionales Ablaufdatum (ISO); ungesetzt = laeuft nicht ab. */
  expiresAt?: string;
}

/**
 * Stamm-Dokument: Mitglieder (+ Alt-Saldo). id === workspaceId.
 * Gelesen vom Membership-Check der Rechnungs-Route /api/invoices/[id];
 * `balance` ist der historische lokale Schnell-Saldo (Wahrheit liegt zentral).
 */
export interface WorkspaceDoc extends WorkspaceScopedDoc {
  type: "workspace";
  ownerUid: string;
  members: WorkspaceMember[]; // inkl. owner, max MAX_WORKSPACE_MEMBERS
  /** Offene E-Mail-Einladungen (Alt-Bestand). */
  pendingInvites?: PendingInvite[];
  balance: number;
  billing?: BillingProfile;
  createdAt: string;
  updatedAt: string;
}

// ===========================================================================
// Billing (native §14-UStG-Rechnung) — Lese-Typen fuer /api/invoices*
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
  | "domestic_b2c" // DE ohne USt-IdNr (Privat): 19 %
  | "eu_oss" // EU-B2C: USt des Kundenlandes (One-Stop-Shop) — von Stripe Tax berechnet
  | "exempt"; // nicht im Inland steuerbar / steuerfrei (z. B. Non-EU)

/** Aussteller (Leistungserbringer) — zum Ausstellungszeitpunkt eingefroren. */
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

/**
 * Rechnung im `invoices`-Container (pk /year). Die SCHREIB-Seite (gaplose
 * Nummernvergabe, Steuerermittlung) lebt im zentralen Credit-Service-Webhook;
 * der Coach liest und rendert fehlende PDFs lazy (ensureInvoicePdf).
 * id ist deterministisch (inv:{paymentIntentId}) => Stripe-Retry = 409 = idempotent.
 */
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

/**
 * Globaler, jahresweise zurueckgesetzter Nummernzaehler. id="counter", pk=year.
 * Wird HIER nicht mehr geschrieben (Vergabe lebt im zentralen Credit-Service-
 * Webhook, derselbe coach/invoices-Store) — Shape dokumentiert den geteilten
 * Vertrag der Jahres-Partition.
 */
export interface InvoiceCounterDoc {
  id: "counter";
  year: string;
  lastSeq: number;
  _etag?: string;
}
