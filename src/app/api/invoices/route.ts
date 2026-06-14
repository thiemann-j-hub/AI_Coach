// src/app/api/invoices/route.ts — Liste der Rechnungen des eigenen Workspaces
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { invoicesContainer, queryItems } from "@/lib/cosmos";
import { getWorkspaceIdForUser } from "@/lib/server/credits/workspace-store";
import { InvoiceDoc } from "@/lib/server/credits/types";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const { uid } = authResult;

  const rlKey = rateLimitKey(req, "invoices-list");
  const rlResponse = checkRateLimit(rlKey, 30, 60_000);
  if (rlResponse) return rlResponse;

  try {
    const workspaceId = await getWorkspaceIdForUser(uid);
    // Cross-Partition-Query (klein, B2B-Volumen) — nur die eigenen Rechnungen.
    const rows = await queryItems<InvoiceDoc>(
      invoicesContainer(),
      `SELECT c.invoiceNumber, c.issuedAt, c.netCents, c.taxCents, c.grossCents,
              c.taxRate, c.taxTreatment, c.currency
         FROM c WHERE c.type = 'invoice' AND c.workspaceId = @ws
         ORDER BY c.issuedAt DESC`,
      [{ name: "@ws", value: workspaceId }]
    );
    return NextResponse.json({ ok: true, invoices: rows }, { status: 200 });
  } catch (err: any) {
    logger.apiError("/api/invoices", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
