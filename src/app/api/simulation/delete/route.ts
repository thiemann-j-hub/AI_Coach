import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { simulationEnabled } from "@/lib/simulation/flags";
import { deleteSimulation } from "@/lib/server/simulation-store";
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
 * POST: eine Simulation endgültig löschen (Owner-Vorgabe 04.08.: Mülleimer
 * in der Liste, inkl. Datenbank). Nur eigene Docs (Ownership-Check im Store);
 * der Client bestätigt zweistufig, hier gibt es keine Wiederherstellung.
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

  const rl = checkRateLimit(rateLimitKey(req, "sim-delete"), 20, 60_000);
  if (rl) return rl;

  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const deleted = await deleteSimulation(auth.uid, parsed.data.simId);
    if (!deleted) {
      return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
    }
    logger.api("/api/simulation/delete", "deleted", {
      uid: auth.uid,
      simId: parsed.data.simId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.apiError("/api/simulation/delete", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
