import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { requireWorkspaceAdmin } from "@/lib/server/scenario-admin";
import { listFinishedInterviews, listInterviewKurse, readBericht, saveBericht } from "@/lib/server/interview-store";
import { erstelleBericht } from "@/ai/flows/interview-bericht";
import { INTERVIEW_MIN_ANTWORTEN, interviewAllowedFor, interviewDefinition } from "@/lib/interview/pilot";
import { withRetry, timeoutMs } from "@/lib/with-timeout";
import { aiErrorResponse } from "@/lib/server/request-id";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const LLM_TIMEOUT_MS = timeoutMs("COACH_RICHTER_TIMEOUT_MS", 110_000);

/**
 * Welle 6 — GET (nur Workspace-Admins):
 *   ohne ?kurs=  → Kurse mit Interview-Zählern
 *   mit  ?kurs=  → Themenbericht, erst ab INTERVIEW_MIN_ANTWORTEN abgeschlossenen Interviews; wird am Kurs
 *                  gemerkt und nur neu erzeugt, wenn neue Interviews dazukamen. Keine Namen, keine Einzelsicht.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const gate = await requireWorkspaceAdmin(auth);
  if (gate instanceof NextResponse) return gate;
  if (!interviewAllowedFor(gate.workspaceId)) {
    return NextResponse.json({ ok: false, code: "INTERVIEW_NOT_ENABLED" }, { status: 403 });
  }
  const kursId = (req.nextUrl.searchParams.get("kurs") ?? "").trim().slice(0, 120);
  const locale = req.nextUrl.searchParams.get("locale") === "en" ? "en" : "de";
  try {
    if (!kursId) {
      const kurse = await listInterviewKurse(gate.workspaceId);
      return NextResponse.json({ ok: true, kurse, mindest: INTERVIEW_MIN_ANTWORTEN });
    }
    const docs = await listFinishedInterviews(gate.workspaceId, kursId);
    const anzahl = docs.length;
    if (anzahl < INTERVIEW_MIN_ANTWORTEN) {
      return NextResponse.json({ ok: true, anzahl, mindest: INTERVIEW_MIN_ANTWORTEN, bericht: null });
    }
    const cached = await readBericht(gate.workspaceId, kursId);
    if (cached && cached.anzahl === anzahl && cached.locale === locale) {
      return NextResponse.json({ ok: true, anzahl, mindest: INTERVIEW_MIN_ANTWORTEN, bericht: cached.bericht, erstellt: cached.createdAt });
    }
    const def = interviewDefinition(docs[0].definitionId);
    if (!def) return NextResponse.json({ ok: false, code: "UNKNOWN_INTERVIEW" }, { status: 404 });
    const bericht = await withRetry(
      () =>
        erstelleBericht({
          def,
          locale,
          kursTitel: docs[0].kurs.titel,
          interviews: docs.map((d) => d.turns.filter((t) => t.role === "person").map((t) => ({ frageNr: t.frageNr, text: t.text }))),
        }),
      { ms: LLM_TIMEOUT_MS + 20_000, label: "interview-bericht", retries: 0 }
    );
    const saved = await saveBericht({ workspaceId: gate.workspaceId, kursId, anzahl, locale, bericht, createdAt: new Date().toISOString() });
    logger.api("/api/interview/bericht", "created", { workspaceId: gate.workspaceId, kursId, anzahl });
    return NextResponse.json({ ok: true, anzahl, mindest: INTERVIEW_MIN_ANTWORTEN, bericht, erstellt: saved.createdAt });
  } catch (err) {
    logger.apiError("/api/interview/bericht", err);
    return aiErrorResponse(err, req, "/api/interview/bericht");
  }
}
