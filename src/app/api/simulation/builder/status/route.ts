import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { simulationEnabled } from "@/lib/simulation/flags";
import { requireWorkspaceAdmin } from "@/lib/server/scenario-admin";
import { setWorkspaceScenarioStatus } from "@/lib/server/scenario-store";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  scenarioId: z.string().regex(/^ws-[a-z0-9-]+$/),
  status: z.enum(["draft", "published"]),
});

/** Welle C — POST: Freischalten/Zurückziehen eines Workspace-Szenarios (Admin). */
export async function POST(req: NextRequest) {
  if (!simulationEnabled()) {
    return NextResponse.json({ ok: false, code: "SIMULATION_DISABLED" }, { status: 503 });
  }
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const rl = checkRateLimit(rateLimitKey(req, "sim-builder-status"), 10, 60_000);
  if (rl) return rl;
  const gate = await requireWorkspaceAdmin(auth);
  if (gate instanceof NextResponse) return gate;

  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
    }
    const doc = await setWorkspaceScenarioStatus(
      gate.workspaceId,
      parsed.data.scenarioId,
      parsed.data.status
    );
    if (!doc) {
      return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
    }
    logger.api("/api/simulation/builder/status", "ok", {
      uid: auth.uid,
      scenarioId: doc.id,
      status: doc.status,
    });
    return NextResponse.json({ ok: true, id: doc.id, status: doc.status });
  } catch (err) {
    logger.apiError("/api/simulation/builder/status", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
