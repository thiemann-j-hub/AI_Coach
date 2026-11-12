import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getApiMessages } from "@/lib/server/get-request-locale";
import { simulationEnabled } from "@/lib/simulation/flags";
import {
  abortDecision,
  updateSimulation,
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

  // Paket 1, C5 (12.11.2026): Begrenzung je Person statt je Adresse.
  const rl = checkRateLimit(`sim-abort:${auth.uid}`, 10, 60_000, getApiMessages(req).rateLimited);
  if (rl) return rl;

  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 }
      );
    }
    // Idempotent: erneuter Abort ist ok; ein FERTIGER Lauf wird nie abgebrochen
    // (die Auswertung ist bezahlt — sie bleibt). Entscheidung pure + getestet.
    // Paket 2, C3 (12.11.2026): Die Entscheidung fällt am frischen Lauf direkt vor dem Speichern. Vorher konnte ein
    // Abbruch, der neben der Auswertung lief, einen fertigen Lauf mit seiner alten Kopie überschreiben.
    let decision = null as ReturnType<typeof abortDecision> | null;
    const doc = await updateSimulation(auth.uid, parsed.data.simId, (lauf) => {
      decision = abortDecision(lauf.status);
      if (decision !== "abort") return false;
      lauf.status = "aborted";
    });
    if (!doc) {
      return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
    }
    if (decision === "already") {
      return NextResponse.json({ ok: true, alreadyAborted: true });
    }
    if (decision === "conflict") {
      return NextResponse.json(
        { ok: false, code: "ALREADY_FINISHED" },
        { status: 409 }
      );
    }
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
