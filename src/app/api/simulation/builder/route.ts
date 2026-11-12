import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { simulationEnabled } from "@/lib/simulation/flags";
import { requireWorkspaceAdmin } from "@/lib/server/scenario-admin";
import { listWorkspaceScenarioDocs } from "@/lib/server/scenario-store";
import { spielbuchStatus } from "@/lib/server/spielbuch/store";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Welle C — GET: alle Workspace-Szenarien (inkl. Drafts) für den Builder.
 * Admin-only; die Antwort enthält das VOLLE Szenario inkl. DNA — der
 * Kunden-Admin ist Autor seiner eigenen Szenarien (Synthesia-Muster: Admins
 * sehen die Instructions). Lernende sehen weiterhin nur publicScenario.
 *
 * Paket 5 (12.11.2026): je Szenario zusätzlich `vorbereitung` (Stand der Rollen-Vorbereitung, C28; nur für
 * freigeschaltete Szenarien) und `freeTestEval` (freier Testlauf, Owner-Entscheid 12.11.2026; nur für die Person,
 * die das Szenario gebaut hat, denn nur ihr schenkt die Auswertung den Credit).
 */
export async function GET(req: NextRequest) {
  if (!simulationEnabled()) {
    return NextResponse.json({ ok: false, code: "SIMULATION_DISABLED" }, { status: 503 });
  }
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const gate = await requireWorkspaceAdmin(auth);
  if (gate instanceof NextResponse) return gate;

  try {
    const docs = await listWorkspaceScenarioDocs(gate.workspaceId);
    // Ein Lesezugriff je freigeschaltetem Szenario; scheitert er, fehlt nur die Anzeige.
    const vorbereitung = await Promise.all(
      docs.map((d) => ((d.status ?? "published") === "published" ? spielbuchStatus(d.scenario).catch(() => null) : null))
    );
    return NextResponse.json({
      ok: true,
      items: docs.map((d, i) => ({
        id: d.id,
        status: d.status ?? "published",
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        ...(vorbereitung[i] ? { vorbereitung: vorbereitung[i] } : {}),
        ...(d.freeTestEval && d.createdByUid === auth.uid ? { freeTestEval: d.freeTestEval } : {}),
        scenario: d.scenario,
      })),
    });
  } catch (err) {
    logger.apiError("/api/simulation/builder", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
