import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { simulationEnabled } from "@/lib/simulation/flags";
import { PERSONA_VOICES } from "@/lib/simulation/types";
import { requireWorkspaceAdmin } from "@/lib/server/scenario-admin";
import { getScenarioForUser, setWorkspaceScenarioVoice } from "@/lib/server/scenario-store";
import { fallbackPersonaVoice, isLiveVoice } from "@/lib/simulation/live-voices";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  scenarioId: z.string().regex(/^ws-[a-z0-9-]+$/),
  // Alt: Azure-Stimme direkt. Neu (28.10.): Live-Stimme, die Azure-Stimme für den Textweg wird abgeleitet.
  voice: z.enum(PERSONA_VOICES).optional(),
  liveVoice: z.string().refine(isLiveVoice, "unbekannte Live-Stimme").optional(),
}).refine((d) => d.voice || d.liveVoice, "voice oder liveVoice");

/** O5a — POST: Stimme der Persona eines Workspace-Szenarios wählen (Admin). */
export async function POST(req: NextRequest) {
  if (!simulationEnabled()) {
    return NextResponse.json({ ok: false, code: "SIMULATION_DISABLED" }, { status: 503 });
  }
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const rl = checkRateLimit(rateLimitKey(req, "sim-builder-voice"), 20, 60_000);
  if (rl) return rl;
  const gate = await requireWorkspaceAdmin(auth);
  if (gate instanceof NextResponse) return gate;

  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
    }
    const { scenarioId, liveVoice } = parsed.data;
    let voice = parsed.data.voice;
    if (liveVoice) {
      const existing = await getScenarioForUser(auth.uid, scenarioId, auth.oid);
      voice = fallbackPersonaVoice(liveVoice, existing?.locale ?? "de");
    }
    const doc = await setWorkspaceScenarioVoice(gate.workspaceId, scenarioId, voice!, liveVoice);
    if (!doc) return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
    logger.api("/api/simulation/builder/voice", "ok", { uid: auth.uid, scenarioId: doc.id, voice, liveVoice });
    return NextResponse.json({ ok: true, id: doc.id, voice, liveVoice: doc.scenario.persona.liveVoice ?? null });
  } catch (err) {
    logger.apiError("/api/simulation/builder/voice", err);
    return NextResponse.json({ ok: false, error: "Internal server error", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
