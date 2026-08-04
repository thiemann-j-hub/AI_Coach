import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { simulationEnabled } from "@/lib/simulation/flags";
import { getSimulation } from "@/lib/server/simulation-store";
import { getScenario } from "@/lib/simulation/scenarios";
import { computeDebrief } from "@/lib/simulation/debrief";
import type { SimulationFeedbackOutput } from "@/ai/flows/simulation-feedback";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?simId= — Wiederaufnahme/Anzeige (Ownership steckt im Partition-Read). */
export async function GET(req: NextRequest) {
  if (!simulationEnabled()) {
    return NextResponse.json(
      { ok: false, code: "SIMULATION_DISABLED" },
      { status: 503 }
    );
  }
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const simId = req.nextUrl.searchParams.get("simId") ?? "";
  if (!/^[A-Za-z0-9-]{8,64}$/.test(simId)) {
    return NextResponse.json({ ok: false, code: "BAD_SIM_ID" }, { status: 400 });
  }

  try {
    const doc = await getSimulation(auth.uid, simId);
    if (!doc) {
      return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
    }

    // Debrief 2.0: Altbestand ohne gespeicherten Debrief wird beim Lesen
    // nachgerechnet (computeDebrief ist pure — gleiche Zahlen wie beim Finish).
    let debrief = doc.debriefJson ?? null;
    const fb = doc.feedbackJson as SimulationFeedbackOutput | null | undefined;
    if (!debrief && doc.status === "finished" && fb?.rubric) {
      const scenario = getScenario(doc.scenarioId);
      debrief = computeDebrief({
        rubric: fb.rubric.map((r) => ({ key: r.key, label: r.label, score: r.score })),
        checkpoints: (fb.checkpoints ?? []).map((c) => ({ id: c.id, hit: c.hit })),
        passThreshold: scenario?.assessment.passThreshold,
      });
    }

    return NextResponse.json({
      ok: true,
      simulation: {
        id: doc.id,
        scenarioId: doc.scenarioId,
        status: doc.status,
        turns: doc.turns,
        feedback: doc.feedbackJson ?? null,
        competencyRatings: doc.competencyRatings ?? null,
        competencyError: doc.competencyError ?? null,
        debrief,
        delta: doc.deltaJson ?? null,
        attempt: doc.attempt ?? 1,
        focus: doc.focus ?? null,
        coachNotes: doc.coachNotes ?? [],
      },
    });
  } catch (err) {
    logger.apiError("/api/simulation/get", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
