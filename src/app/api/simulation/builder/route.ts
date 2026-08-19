import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { simulationEnabled } from "@/lib/simulation/flags";
import { requireWorkspaceAdmin } from "@/lib/server/scenario-admin";
import { listWorkspaceScenarioDocs } from "@/lib/server/scenario-store";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Welle C — GET: alle Workspace-Szenarien (inkl. Drafts) für den Builder.
 * Admin-only; die Antwort enthält das VOLLE Szenario inkl. DNA — der
 * Kunden-Admin ist Autor seiner eigenen Szenarien (Synthesia-Muster: Admins
 * sehen die Instructions). Lernende sehen weiterhin nur publicScenario.
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
    return NextResponse.json({
      ok: true,
      items: docs.map((d) => ({
        id: d.id,
        status: d.status ?? "published",
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
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
