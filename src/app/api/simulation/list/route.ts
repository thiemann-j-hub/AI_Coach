import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { simulationEnabled } from "@/lib/simulation/flags";
import { getScenario } from "@/lib/simulation/scenarios";
import { listSimulations } from "@/lib/server/simulation-store";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET ?limit= — Simulations-Historie fürs gemeinsame Verlaufs-Dashboard
 * (COACH-UX-BLUEPRINT §3/W1-6). Szenario-Titel wird serverseitig gejoint,
 * damit der Client keinen Katalog laden muss.
 */
export async function GET(req: NextRequest) {
  if (!simulationEnabled()) {
    return NextResponse.json(
      { ok: false, code: "SIMULATION_DISABLED" },
      { status: 503 }
    );
  }
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.trunc(rawLimit))) : 50;

  try {
    const items = (await listSimulations(auth.uid, limit)).map((r) => {
      const s = getScenario(r.scenarioId);
      return {
        ...r,
        scenarioTitle: s?.title ?? r.scenarioId,
        personaName: s?.persona.name ?? null,
      };
    });
    return NextResponse.json({ ok: true, items });
  } catch (err) {
    logger.apiError("/api/simulation/list", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
