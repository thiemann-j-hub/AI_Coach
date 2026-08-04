import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { simulationEnabled } from "@/lib/simulation/flags";
import { getScenario } from "@/lib/simulation/scenarios";
import {
  countFinishedForScenario,
  createSimulation,
} from "@/lib/server/simulation-store";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  scenarioId: z.string().min(1).max(100),
  /**
   * Fokus-Retry (D2): EIN Vorsatz aus dem letzten Debrief; optional.
   * Grosszuegig annehmen und serverseitig kappen — ein langer nextStep darf
   * den Retry NIE scheitern lassen (User-Test-Fund 04.08.: 340-Zeichen-Hebel
   * lief in max(300) → 400 → generischer Fehler beim Nutzer).
   */
  focus: z.string().max(2000).optional(),
});

/** Harte Kappe fuer den gespeicherten Fokus (Prompt-Injektion + Doc-Groesse). */
const FOCUS_MAX_CHARS = 300;

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

    // Versuchszählung fuer Historie/Delta (D2) — best effort, blockiert nie.
    let attempt = 1;
    try {
      attempt = (await countFinishedForScenario(auth.uid, scenario.id)) + 1;
    } catch {
      /* Zählung optional */
    }
    const focus = parsed.data.focus?.trim().slice(0, FOCUS_MAX_CHARS) || null;

    const simId = crypto.randomUUID();
    const doc = await createSimulation({
      simId,
      uid: auth.uid,
      scenarioId: scenario.id,
      attempt,
      focus,
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
      attempt,
    });
    return NextResponse.json({
      ok: true,
      simulation: {
        id: doc.id,
        scenarioId: doc.scenarioId,
        status: doc.status,
        turns: doc.turns,
        attempt,
        focus,
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
