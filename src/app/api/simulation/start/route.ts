import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { simulationEnabled } from "@/lib/simulation/flags";
import { getScenario } from "@/lib/simulation/scenarios";
import { createSimulation } from "@/lib/server/simulation-store";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  scenarioId: z.string().min(1).max(100),
});

/** POST: neue Simulation anlegen — die Persona eröffnet mit ihrer openingLine. */
export async function POST(req: NextRequest) {
  if (!simulationEnabled()) {
    return NextResponse.json(
      { ok: false, code: "SIMULATION_DISABLED" },
      { status: 503 }
    );
  }
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const rl = checkRateLimit(rateLimitKey(req, "sim-start"), 5, 60_000);
  if (rl) return rl;

  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const scenario = getScenario(parsed.data.scenarioId);
    if (!scenario) {
      return NextResponse.json(
        { ok: false, code: "UNKNOWN_SCENARIO" },
        { status: 404 }
      );
    }

    const simId = crypto.randomUUID();
    const doc = await createSimulation({
      simId,
      uid: auth.uid,
      scenarioId: scenario.id,
      openingTurn: {
        role: "persona",
        text: scenario.personaDna.openingLine,
        ts: new Date().toISOString(),
      },
    });

    logger.api("/api/simulation/start", "created", {
      uid: auth.uid,
      simId,
      scenarioId: scenario.id,
    });
    return NextResponse.json({
      ok: true,
      simulation: {
        id: doc.id,
        scenarioId: doc.scenarioId,
        status: doc.status,
        turns: doc.turns,
      },
    });
  } catch (err) {
    logger.apiError("/api/simulation/start", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
