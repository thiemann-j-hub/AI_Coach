import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { simulationEnabled } from "@/lib/simulation/flags";
import { publicScenarios } from "@/lib/simulation/scenarios";
import { listSimulations } from "@/lib/server/simulation-store";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: Szenario-Katalog (öffentliche Projektion) + letzte Simulationen des Users. */
export async function GET(req: NextRequest) {
  if (!simulationEnabled()) {
    return NextResponse.json(
      { ok: false, code: "SIMULATION_DISABLED" },
      { status: 503 }
    );
  }
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const recent = await listSimulations(auth.uid, 10);
    return NextResponse.json({ ok: true, scenarios: publicScenarios(), recent });
  } catch (err) {
    logger.apiError("/api/simulation/scenarios", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
