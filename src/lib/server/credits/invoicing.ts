import "server-only";

import { invoicesContainer } from "@/lib/cosmos";
import { InvoiceDoc } from "./types";
import { renderInvoicePdf } from "./invoice-pdf";
import { blobConfigured, invoiceBlobPath, uploadInvoicePdf } from "./invoice-blob";

/**
 * Rechnungs-PDF: Lazy-Render-Fallback fuer die LESE-Route /api/invoices/[id].
 *
 * KK-1 (Go-Live-Blueprint): Die SCHREIB-Seite (createInvoice, Steuerermittlung,
 * VIES, gaplose Nummernvergabe) lebt seit F-1 im ZENTRALEN Credit-Service-
 * Webhook — dort werden Rechnungen im geteilten coach/invoices-Store erzeugt
 * (Nummern-Kontinuitaet). Der Coach liest nur noch und rendert fehlende PDFs
 * lazy aus dem eingefrorenen Doc nach.
 */

/**
 * Rendert das Invoice-PDF aus dem eingefrorenen Doc, laedt es in den Blob
 * Storage und persistiert den Pfad am Doc (GoBD: das Doc selbst ist der
 * unveraenderliche Snapshot; templateVersion pinnt das Layout). Idempotent
 * (pdfBlobPath gesetzt -> no-op). Ohne Blob-Config (z. B. lokal) wird sauber
 * uebersprungen.
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
