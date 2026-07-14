// src/app/api/invoices/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { invoicesContainer, queryItems } from "@/lib/cosmos";
import { getWorkspaceDoc } from "@/lib/server/credits/workspace-store";
import { ensureInvoicePdf } from "@/lib/server/credits/invoicing";
import { blobConfigured, getInvoiceSasUrl } from "@/lib/server/credits/invoice-blob";
import { InvoiceDoc } from "@/lib/server/credits/types";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Erlaubt RE-YYYY-NNNNNN; das Jahr ist die Cosmos-Partition. */
const INVOICE_NO = /^RE-(\d{4})-\d{6}$/;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const { uid } = authResult;

  const { id } = await ctx.params;
  const m = INVOICE_NO.exec(id ?? "");
  if (!m) {
    return NextResponse.json({ ok: false, error: "Invalid invoice id" }, { status: 400 });
  }
  const year = m[1];

  try {
    const rows = await queryItems<InvoiceDoc>(
      invoicesContainer(),
      `SELECT * FROM c WHERE c.year = @y AND c.type = 'invoice' AND c.invoiceNumber = @n`,
      [
        { name: "@y", value: year },
        { name: "@n", value: id },
      ]
    );
    const invoice = rows[0];
    if (!invoice) {
      return NextResponse.json({ ok: false, error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    }

    // Zugriffskontrolle: User muss Mitglied des Rechnungs-Workspaces sein.
    const ws = await getWorkspaceDoc(invoice.workspaceId);
    const allowed = ws ? ws.members.some((mm) => mm.uid === uid) : invoice.workspaceId === uid;
    if (!allowed) {
      return NextResponse.json({ ok: false, error: "Access denied", code: "FORBIDDEN" }, { status: 403 });
    }

    if (!blobConfigured()) {
      return NextResponse.json({ ok: false, error: "PDF storage not configured", code: "NOT_CONFIGURED" }, { status: 503 });
    }

    // PDF aus dem eingefrorenen Doc rendern, falls noch nicht im Blob (Fallback).
    let blobPath = invoice.pdfBlobPath;
    if (!blobPath) {
      const ensured = await ensureInvoicePdf(invoice);
      blobPath = ensured.pdfBlobPath;
    }
    if (!blobPath) {
      return NextResponse.json({ ok: false, error: "PDF not available", code: "PDF_PENDING" }, { status: 409 });
    }

    // 302 auf kurzlebige User-Delegation-SAS: Azure traegt die Download-Last,
    // die Zugangskontrolle bleibt hier.
    const sasUrl = await getInvoiceSasUrl(blobPath, 2);
    return NextResponse.redirect(sasUrl, 302);
  } catch (err: any) {
    logger.apiError("/api/invoices/[id]", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
