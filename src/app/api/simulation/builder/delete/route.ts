import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { simulationEnabled } from "@/lib/simulation/flags";
import { requireWorkspaceAdmin } from "@/lib/server/scenario-admin";
import { deleteWorkspaceScenario } from "@/lib/server/scenario-store";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  scenarioId: z.string().regex(/^ws-[a-z0-9-]+$/),
});

/**
 * Welle C — POST: Workspace-Szenario endgültig löschen (Admin). Bereits
 * gespielte Läufe behalten ihre Auswertung (die Simulation speichert alles,
 * was sie braucht); nur der Katalog-Eintrag verschwindet.
 */
export async function POST(req: NextRequest) {
  if (!simulationEnabled()) {
    return NextResponse.json({ ok: false, code: "SIMULATION_DISABLED" }, { status: 503 });
  }
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const rl = checkRateLimit(rateLimitKey(req, "sim-builder-del"), 10, 60_000);
  if (rl) return rl;
  const gate = await requireWorkspaceAdmin(auth);
  if (gate instanceof NextResponse) return gate;

  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
    }
    const ok = await deleteWorkspaceScenario(gate.workspaceId, parsed.data.scenarioId);
    if (!ok) return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
    logger.api("/api/simulation/builder/delete", "ok", {
      uid: auth.uid,
      scenarioId: parsed.data.scenarioId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.apiError("/api/simulation/builder/delete", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
