import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runPersonaTurn } from "@/ai/flows/simulation-persona";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { checkAndConsumeBudget, estimateTokens } from "@/lib/server/cost-cap";
import { simulationEnabled } from "@/lib/simulation/flags";
import { getScenario } from "@/lib/simulation/scenarios";
import {
  SIM_MAX_TURN_CHARS,
  SIM_MAX_USER_TURNS,
  countUserTurns,
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
  message: z.string().min(1).max(SIM_MAX_TURN_CHARS),
});

/** POST: ein Gesprächszug — Persona antwortet, beide Turns werden persistiert. */
export async function POST(req: NextRequest) {
  if (!simulationEnabled()) {
    return NextResponse.json(
      { ok: false, code: "SIMULATION_DISABLED" },
      { status: 503 }
    );
  }
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const rl = checkRateLimit(rateLimitKey(req, "sim-turn"), 20, 60_000);
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
    if (countUserTurns(doc.turns) >= SIM_MAX_USER_TURNS) {
      return NextResponse.json({ ok: false, code: "TURN_LIMIT" }, { status: 409 });
    }
    const scenario = getScenario(doc.scenarioId);
    if (!scenario) {
      return NextResponse.json({ ok: false, code: "UNKNOWN_SCENARIO" }, { status: 410 });
    }

    // Pro-User-Token-Budget: Kontext (System-Prompt + Verlauf) + neue Nachricht.
    const historyText = doc.turns.map((t) => t.text).join("\n");
    const budget = await checkAndConsumeBudget({
      uid: auth.uid,
      email: auth.email,
      estimatedTokens: estimateTokens(historyText, d.message),
    });
    if (!budget.allowed && budget.response) return budget.response;

    const reply = await withRetry(
      () =>
        runPersonaTurn({
          scenario,
          turns: doc.turns,
          userMessage: d.message,
        }),
      { ms: LLM_TIMEOUT_MS, label: "gemini-sim-turn", retries: 1 }
    );

    const now = new Date().toISOString();
    doc.turns.push({ role: "user", text: d.message, ts: now });
    doc.turns.push({ role: "persona", text: reply, ts: new Date().toISOString() });
    await saveSimulation(doc);

    logger.api("/api/simulation/turn", "ok", {
      uid: auth.uid,
      simId: d.simId,
      turns: doc.turns.length,
    });
    return NextResponse.json({
      ok: true,
      reply,
      turnCount: doc.turns.length,
      userTurnsLeft: SIM_MAX_USER_TURNS - countUserTurns(doc.turns),
    });
  } catch (err) {
    logger.apiError("/api/simulation/turn", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
