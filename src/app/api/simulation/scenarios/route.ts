import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { simulationEnabled } from "@/lib/simulation/flags";
import { publicScenarios } from "@/lib/simulation/scenarios";
import { weakestObservedC, type RatingLike } from "@/lib/simulation/empfehlung";
import {
  latestFinishedAny,
  listSimulations,
} from "@/lib/server/simulation-store";
import { latestRunForUid } from "@/lib/server/runs-store";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET: Szenario-Katalog (öffentliche Projektion) + letzte Simulationen des
 * Users + Einstiegs-Insight (COACH-UX-BLUEPRINT §3/W1-4): schwächste
 * beobachtete Kompetenz der jüngsten eigenen Auswertung — Run ODER Simulation,
 * die neuere gewinnt. Fail-soft: ohne Insight bleibt der Einstieg Cold Start.
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

  try {
    const recent = await listSimulations(auth.uid, 10);

    let insight: { weakestC: string; weakestName: string | null; source: "sim" | "run" } | null = null;
    try {
      const [sim, run] = await Promise.all([
        latestFinishedAny(auth.uid),
        latestRunForUid(auth.uid),
      ]);
      const pick =
        sim && run
          ? new Date(sim.finishedAt).getTime() >= new Date(run.createdAt).getTime()
            ? { src: "sim" as const, ratings: sim.competencyRatings }
            : { src: "run" as const, ratings: run.competencyRatings }
          : sim
            ? { src: "sim" as const, ratings: sim.competencyRatings }
            : run
              ? { src: "run" as const, ratings: run.competencyRatings }
              : null;
      if (pick) {
        const weakest = weakestObservedC(pick.ratings as RatingLike[] | null);
        if (weakest) {
          insight = { weakestC: weakest.id, weakestName: weakest.name, source: pick.src };
        }
      }
    } catch (err) {
      // Insight ist Komfort, nie Blocker — Einstieg degradiert auf Cold Start.
      logger.apiError("/api/simulation/scenarios insight", err);
    }

    return NextResponse.json({ ok: true, scenarios: publicScenarios(), recent, insight });
  } catch (err) {
    logger.apiError("/api/simulation/scenarios", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
