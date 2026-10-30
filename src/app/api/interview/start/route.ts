import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { kiSchalterBlockt } from "@/lib/server/credits/entitlement";
import { resolveWorkspaceIdForScenarios } from "@/lib/server/scenario-store";
import { createInterview, findActiveInterview } from "@/lib/server/interview-store";
import { eroeffnung, interviewAllowedFor, interviewDefinition } from "@/lib/interview/pilot";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  definitionId: z.string().regex(/^[a-z0-9-]{2,40}$/).default("kursfeedback"),
  kursId: z.string().trim().min(1).max(120),
  kursTitel: z.string().trim().min(1).max(200),
  locale: z.enum(["de", "en"]).default("de"),
});

/**
 * Welle 6 — POST: Interview beginnen (oder ein offenes zum selben Kurs wieder aufnehmen).
 * Pilot: nur Workspaces im COACH_INTERVIEW-Rahmen (Standard: Owner). Kostenlos bis zum Abschluss.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const rl = checkRateLimit(rateLimitKey(req, "interview-start"), 5, 60_000);
  if (rl) return rl;
  const ki = await kiSchalterBlockt();
  if (ki) return ki;
  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
    const d = parsed.data;
    const def = interviewDefinition(d.definitionId);
    if (!def) return NextResponse.json({ ok: false, code: "UNKNOWN_INTERVIEW" }, { status: 404 });
    const workspaceId = await resolveWorkspaceIdForScenarios(auth.uid, auth.oid);
    if (!interviewAllowedFor(workspaceId)) {
      return NextResponse.json({ ok: false, code: "INTERVIEW_NOT_ENABLED" }, { status: 403 });
    }
    const offen = await findActiveInterview(workspaceId, auth.uid, d.kursId);
    if (offen) {
      return NextResponse.json({ ok: true, id: offen.id, turns: offen.turns, fertig: offen.fertig, resumed: true });
    }
    const now = new Date().toISOString();
    const doc = await createInterview({
      id: crypto.randomUUID(),
      workspaceId,
      uid: auth.uid,
      definitionId: def.id,
      kurs: { id: d.kursId, titel: d.kursTitel },
      locale: d.locale,
      status: "active",
      turns: [{ role: "interviewer", text: eroeffnung(def, d.kursTitel, d.locale), frageNr: 1, ts: now }],
      frageNr: 1,
      nachfragen: 0,
      fertig: false,
      createdAt: now,
      updatedAt: now,
    });
    logger.api("/api/interview/start", "created", { uid: auth.uid, id: doc.id, kursId: d.kursId });
    return NextResponse.json({ ok: true, id: doc.id, turns: doc.turns, fertig: false, resumed: false });
  } catch (err) {
    logger.apiError("/api/interview/start", err);
    return NextResponse.json({ ok: false, code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
