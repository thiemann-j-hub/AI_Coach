import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { simulationEnabled } from "@/lib/simulation/flags";
import { getScenarioForUser } from "@/lib/server/scenario-store";
import {
  getSimulation,
  latestPendingTransferCheck,
  saveSimulation,
} from "@/lib/server/simulation-store";
import {
  TRANSFER_NOTE_MAX_CHARS,
  isTransferOutcome,
  transferCheckMinHours,
} from "@/lib/simulation/transfer";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET: die EINE anstehende Nachfrage („Letzte Woche wolltest du X ausprobieren.
 * Wie lief's?“) — O2, Gemini Zu 4 / Owner E-4: nur beim Login, keine Mails,
 * frühestens nach TRANSFER_CHECK_MIN_HOURS (Default 72 h). null = nichts offen.
 */
export async function GET(req: NextRequest) {
  if (!simulationEnabled()) {
    return NextResponse.json({ ok: true, item: null });
  }
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const pending = await latestPendingTransferCheck(auth.uid, transferCheckMinHours() * 3_600_000);
    if (!pending) return NextResponse.json({ ok: true, item: null });
    const scenario = await getScenarioForUser(auth.uid, pending.scenarioId, auth.oid);
    return NextResponse.json({
      ok: true,
      item: {
        simId: pending.id,
        scenarioId: pending.scenarioId,
        scenarioTitle: scenario?.title ?? pending.scenarioId,
        personaName: scenario?.persona.name ?? null,
        text: pending.commitment.text,
        dueHint: pending.commitment.dueHint ?? null,
        finishedAt: pending.finishedAt,
      },
    });
  } catch (err) {
    logger.apiError("/api/simulation/transfer-check", err);
    // Fail-open: die Nachfrage ist ein Angebot, nie ein Blocker.
    return NextResponse.json({ ok: true, item: null });
  }
}

const postSchema = z.object({
  simId: z.string().min(8).max(64).regex(/^[A-Za-z0-9-]+$/),
  outcome: z.string(),
  note: z.string().max(TRANSFER_NOTE_MAX_CHARS).optional(),
});

/** POST: Rückmeldung speichern — done | partly | not | dismissed (= nie wieder fragen). */
export async function POST(req: NextRequest) {
  if (!simulationEnabled()) {
    return NextResponse.json({ ok: false, code: "SIMULATION_DISABLED" }, { status: 503 });
  }
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const rl = checkRateLimit(rateLimitKey(req, "sim-transfer-check"), 30, 60_000);
  if (rl) return rl;

  try {
    const parsed = postSchema.safeParse(await req.json());
    if (!parsed.success || !isTransferOutcome(parsed.data.outcome)) {
      return NextResponse.json({ ok: false, code: "BAD_REQUEST" }, { status: 400 });
    }
    const doc = await getSimulation(auth.uid, parsed.data.simId);
    if (!doc) return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
    if (doc.status !== "finished" || !doc.commitment?.text) {
      return NextResponse.json({ ok: false, code: "NO_COMMITMENT" }, { status: 409 });
    }
    doc.transferCheck = {
      outcome: parsed.data.outcome,
      note: parsed.data.note?.trim() ? parsed.data.note.trim() : null,
      at: new Date().toISOString(),
    };
    await saveSimulation(doc);
    logger.api("/api/simulation/transfer-check", "ok", {
      uid: auth.uid,
      simId: doc.id,
      outcome: parsed.data.outcome,
    });
    return NextResponse.json({ ok: true, transferCheck: doc.transferCheck });
  } catch (err) {
    logger.apiError("/api/simulation/transfer-check", err);
    return NextResponse.json({ ok: false, error: "Internal server error", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
