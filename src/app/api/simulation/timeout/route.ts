import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runCoachTimeout } from "@/ai/flows/simulation-coach";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { checkAndConsumeBudget, estimateTokens } from "@/lib/server/cost-cap";
import { simulationEnabled } from "@/lib/simulation/flags";
import { getScenarioForUser } from "@/lib/server/scenario-store";
import {
  SIM_MAX_TIMEOUTS,
  getSimulation,
  saveSimulation,
} from "@/lib/server/simulation-store";
import { withRetry, timeoutMs } from "@/lib/with-timeout";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LLM_TIMEOUT_MS = timeoutMs("LLM_TIMEOUT_MS", 45_000);

const requestSchema = z.object({
  simId: z
    .string()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9-]+$/),
  question: z.string().max(500).optional(),
});

/**
 * POST: Time-out-Coach (Debrief 2.0, D3) — die Szene ist angehalten, der Coach
 * gibt einen konkreten Impuls auf Basis des bisherigen Verlaufs. Max.
 * SIM_MAX_TIMEOUTS je Simulation; ohne Credit-Charge (kleiner Call), aber
 * hinter dem Token-Budget. coachNotes liegen GETRENNT von den turns: die
 * Persona hört nichts, die Auswertung bewertet nur das Gespräch.
 */
export async function POST(req: NextRequest) {
  if (!simulationEnabled()) {
    return NextResponse.json(
      { ok: false, code: "SIMULATION_DISABLED" },
      { status: 503 }
    );
  }
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const rl = checkRateLimit(rateLimitKey(req, "sim-timeout"), 6, 60_000);
  if (rl) return rl;

  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const d = parsed.data;

    const doc = await getSimulation(auth.uid, d.simId);
    if (!doc) {
      return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
    }
    if (doc.status !== "active") {
      return NextResponse.json({ ok: false, code: "ALREADY_FINISHED" }, { status: 409 });
    }
    // B2: Im Prüfungsmodus gibt es keine Coach-Pausen — eine Prüfung ist
    // eine Prüfung (Synthesia-Muster Assessment). Der Client blendet den
    // Knopf aus; dieser Riegel gilt serverseitig.
    if (doc.mode === "check") {
      return NextResponse.json({ ok: false, code: "CHECK_MODE" }, { status: 409 });
    }
    const used = doc.coachNotes?.length ?? 0;
    if (used >= SIM_MAX_TIMEOUTS) {
      return NextResponse.json(
        { ok: false, code: "TIMEOUT_LIMIT", max: SIM_MAX_TIMEOUTS },
        { status: 409 }
      );
    }
    // Erst nach etwas Gespräch ist ein Impuls sinnvoll begründbar.
    if (doc.turns.filter((t) => t.role === "user").length < 1) {
      return NextResponse.json({ ok: false, code: "TOO_EARLY" }, { status: 400 });
    }
    const scenario = await getScenarioForUser(auth.uid, doc.scenarioId);
    if (!scenario) {
      return NextResponse.json({ ok: false, code: "UNKNOWN_SCENARIO" }, { status: 410 });
    }

    const historyText = doc.turns.map((t) => t.text).join("\n");
    const budget = await checkAndConsumeBudget({
      uid: auth.uid,
      email: auth.email,
      estimatedTokens: estimateTokens(historyText, d.question ?? ""),
    });
    if (!budget.allowed && budget.response) return budget.response;

    const tip = await withRetry(
      () =>
        runCoachTimeout({
          scenario,
          turns: doc.turns,
          question: d.question,
        }),
      { ms: LLM_TIMEOUT_MS, label: "gemini-sim-timeout", retries: 1 }
    );

    doc.coachNotes = [
      ...(doc.coachNotes ?? []),
      { question: d.question?.trim() ?? "", answer: tip, ts: new Date().toISOString() },
    ];
    await saveSimulation(doc);

    logger.api("/api/simulation/timeout", "ok", {
      uid: auth.uid,
      simId: d.simId,
      used: doc.coachNotes.length,
    });
    return NextResponse.json({
      ok: true,
      tip,
      timeoutsUsed: doc.coachNotes.length,
      timeoutsMax: SIM_MAX_TIMEOUTS,
    });
  } catch (err) {
    logger.apiError("/api/simulation/timeout", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
