import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { simulationEnabled } from "@/lib/simulation/flags";
import {
  abortDecision,
  getSimulation,
  saveSimulation,
} from "@/lib/server/simulation-store";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  simId: z
    .string()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9-]+$/),
});

/**
 * POST: Simulation abbrechen (COACH-UX-BLUEPRINT §2.4). Idempotent, nur aus
 * `active`, kein Credit, kein LLM, kein Radar. Abgebrochene Läufe verschwinden
 * aus allen Listen (listSimulations filtert) — die Historie bleibt sauber,
 * aber es entsteht auch keine Sackgasse: der Nutzer kommt immer zur Übersicht.
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

  const rl = checkRateLimit(rateLimitKey(req, "sim-abort"), 10, 60_000);
  if (rl) return rl;

  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const doc = await getSimulation(auth.uid, parsed.data.simId);
    if (!doc) {
      return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
    }
    // Idempotent: erneuter Abort ist ok; ein FERTIGER Lauf wird nie abgebrochen
    // (die Auswertung ist bezahlt — sie bleibt). Entscheidung pure + getestet.
    const decision = abortDecision(doc.status);
    if (decision === "already") {
      return NextResponse.json({ ok: true, alreadyAborted: true });
    }
    if (decision === "conflict") {
      return NextResponse.json(
        { ok: false, code: "ALREADY_FINISHED" },
        { status: 409 }
      );
    }
    doc.status = "aborted";
    await saveSimulation(doc);
    // CP-3.2 (M9): kein uid im Abbruch-Log — "wer abgebrochen hat" gehört
    // nicht in Azure Monitor; simId genügt zur Fehlersuche.
    logger.api("/api/simulation/abort", "aborted", { simId: doc.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.apiError("/api/simulation/abort", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
