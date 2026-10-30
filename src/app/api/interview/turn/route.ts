import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { checkAndConsumeBudget, estimateTokens } from "@/lib/server/cost-cap";
import { resolveWorkspaceIdForScenarios } from "@/lib/server/scenario-store";
import { readInterview, saveInterview } from "@/lib/server/interview-store";
import { naechsterSchritt } from "@/ai/flows/interview-fuehrung";
import { INTERVIEW_MAX_ANTWORT_ZEICHEN, abschluss, interviewDefinition } from "@/lib/interview/pilot";
import { withRetry, timeoutMs } from "@/lib/with-timeout";
import { aiErrorResponse } from "@/lib/server/request-id";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LLM_TIMEOUT_MS = timeoutMs("INTERVIEW_LLM_TIMEOUT_MS", 25_000);

const requestSchema = z.object({
  id: z.string().uuid(),
  text: z.string().trim().min(1).max(INTERVIEW_MAX_ANTWORT_ZEICHEN),
});

/** Welle 6 — POST: Antwort der Person; der Interviewer fragt nach oder stellt die nächste Frage. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const rl = checkRateLimit(rateLimitKey(req, "interview-turn"), 30, 60_000);
  if (rl) return rl;
  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
    const workspaceId = await resolveWorkspaceIdForScenarios(auth.uid, auth.oid);
    const doc = await readInterview(workspaceId, parsed.data.id);
    if (!doc || doc.uid !== auth.uid) return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
    if (doc.status !== "active") return NextResponse.json({ ok: false, code: "FINISHED" }, { status: 409 });
    if (doc.fertig) return NextResponse.json({ ok: true, turns: doc.turns, fertig: true });
    const def = interviewDefinition(doc.definitionId);
    if (!def) return NextResponse.json({ ok: false, code: "UNKNOWN_INTERVIEW" }, { status: 404 });

    const budget = await checkAndConsumeBudget({ uid: auth.uid, email: auth.email, estimatedTokens: estimateTokens(parsed.data.text) });
    if (!budget.allowed && budget.response) return budget.response;

    const now = new Date().toISOString();
    doc.turns.push({ role: "person", text: parsed.data.text, frageNr: doc.frageNr, ts: now });

    const schritt = await withRetry(
      () =>
        naechsterSchritt({
          def,
          locale: doc.locale,
          kursTitel: doc.kurs.titel,
          frageNr: doc.frageNr,
          nachfragenBisher: doc.nachfragen,
          turns: doc.turns,
        }),
      { ms: LLM_TIMEOUT_MS, label: "gemini-interview", retries: 0 }
    );
    if (!schritt) {
      doc.fertig = true;
      doc.turns.push({ role: "interviewer", text: abschluss(doc.locale), frageNr: doc.frageNr, ts: new Date().toISOString() });
    } else {
      if (schritt.nachfrage) doc.nachfragen += 1;
      else {
        doc.frageNr = schritt.frageNr;
        doc.nachfragen = 0;
      }
      doc.turns.push({ role: "interviewer", text: schritt.text, frageNr: schritt.frageNr, nachfrage: schritt.nachfrage, ts: new Date().toISOString() });
    }
    await saveInterview(doc);
    return NextResponse.json({ ok: true, turns: doc.turns, fertig: doc.fertig, frageNr: doc.frageNr, gesamt: def.fragen.length });
  } catch (err) {
    logger.apiError("/api/interview/turn", err);
    return aiErrorResponse(err, req, "/api/interview/turn");
  }
}
