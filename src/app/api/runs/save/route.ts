// src/app/api/runs/save/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import {
  checkSessionOwnership,
  createRun,
  getRun,
  upsertSession,
} from "@/lib/server/runs-store";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getWorkspaceIdForUser } from "@/lib/server/credits/workspace-store";
import { getApiMessages } from "@/lib/server/get-request-locale";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sessionIdSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "sessionId must be url-safe (a-zA-Z0-9_-).");

const requestSchema = z.object({
  conversationType: z.string().min(1).max(100),
  conversationSubType: z.string().max(100).optional().nullable(),
  goal: z.string().max(500).optional().nullable(),
  transcriptText: z.string().max(500_000).optional().nullable(),
  lang: z.enum(["de", "en"]).optional().nullable(),
  jurisdiction: z.string().max(50).optional().nullable(),
  leaderLabel: z.string().max(200).optional().nullable(),
  employeeLabel: z.string().max(200).optional().nullable(),
});

const optionsSchema = z.object({
  storeTranscript: z.boolean().optional(),
});

const runIdSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "runId must be url-safe (a-zA-Z0-9_-).");

const bodySchema = z.object({
  sessionId: sessionIdSchema,
  /** Vom /api/analyze-Response uebernommene runId (Credit-Hold-Bindung). Optional. */
  runId: runIdSchema.optional(),
  request: requestSchema.optional(),
  result: z.any().optional(),
  options: optionsSchema.optional(),
});

function isObject(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function safeTrimString(v: any): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

function pickBool(v: any): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1") return true;
    if (s === "false" || s === "0") return false;
  }
  return undefined;
}

function pickRequest(body: any) {
  let req: any = isObject(body?.request) ? body.request : null;

  if (!req && isObject(body) && typeof body.conversationType === "string") {
    req = {
      conversationType: body.conversationType,
      conversationSubType: body.conversationSubType ?? null,
      goal: body.goal ?? null,
      transcriptText: body.transcriptText ?? null,
      lang: body.lang ?? null,
      jurisdiction: body.jurisdiction ?? null,
      leaderLabel: body.leaderLabel ?? null,
      employeeLabel: body.employeeLabel ?? null,
    };
  }

  if (isObject(req)) {
    const have = safeTrimString((req as any).transcriptText);
    const top = safeTrimString(body?.transcriptText);
    if (!have && top) req = { ...req, transcriptText: top };
  }

  return req ?? null;
}

function pickResult(body: any) {
  return (
    body?.result ??
    body?.analysis ??
    body?.analysisJson ??
    body?.analysisResult ??
    body?.output ??
    null
  );
}

function pickPractice7Days(result: any): string | null {
  const cands = [
    result?.practice7Days,
    result?.sevenDayPractice,
    result?.practice,
    result?.exercise7Days,
    result?.exercise,
    result?.next7Days,
  ];
  for (const c of cands) {
    const s = safeTrimString(c);
    if (s) return s;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const apiMsg = getApiMessages(req);

  // Auth check
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const { uid } = authResult;

  // Rate limit: 20 saves per minute
  const rlKey = rateLimitKey(req, "runs-save");
  const rlResponse = checkRateLimit(rlKey, 20, 60_000, apiMsg.rateLimited);
  if (rlResponse) return rlResponse;

  try {
    const json = await req.json().catch(() => null);
    if (!json || !isObject(json)) {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
    }

    const sessionId = parsed.data.sessionId;

    const reqCandidate = pickRequest(json);
    const reqParsed = requestSchema.safeParse(reqCandidate);
    if (!reqParsed.success) {
      return NextResponse.json({ ok: false, error: reqParsed.error.flatten() }, { status: 400 });
    }

    const request = reqParsed.data;

    const result = pickResult(json);
    if (!isObject(result)) {
      return NextResponse.json({ ok: false, error: "Missing result (expected body.result)" }, { status: 400 });
    }

    const transcriptCandidate =
      safeTrimString((request as any).transcriptText) ??
      safeTrimString((json as any).transcriptText);

    const storeTranscriptExplicit =
      parsed.data.options?.storeTranscript ??
      pickBool((json as any).storeTranscript) ??
      pickBool((json as any).saveTranscript);

    const storeTranscript =
      typeof storeTranscriptExplicit === "boolean" ? storeTranscriptExplicit : !!transcriptCandidate;

    const transcriptText = storeTranscript && transcriptCandidate ? transcriptCandidate : null;

    const analysisJson = {
      summary: safeTrimString((result as any).summary),
      strengths: Array.isArray((result as any).strengths) ? (result as any).strengths : [],
      improvements: Array.isArray((result as any).improvements) ? (result as any).improvements : [],
      rewrites: Array.isArray((result as any).rewrites) ? (result as any).rewrites : [],
      riskFlags: Array.isArray((result as any).riskFlags) ? (result as any).riskFlags : [],
      practice7Days: pickPractice7Days(result),
      scores: isObject((result as any).scores) ? (result as any).scores : {},
      competency_ratings: Array.isArray((result as any).competency_ratings)
        ? (result as any).competency_ratings
        : [],
      competency_error: typeof (result as any).competency_error === "string" ? (result as any).competency_error : null,
      quality_notes: Array.isArray((result as any).quality_notes) ? (result as any).quality_notes : [],
    };

    const ragContext = {
      cards: Array.isArray((result as any).rag_context_cards) ? (result as any).rag_context_cards : [],
      count: typeof (result as any).rag_context_count === "number" ? (result as any).rag_context_count : null,
      error: typeof (result as any).rag_error === "string" ? (result as any).rag_error : null,
    };

    const scoreOverall =
      typeof (analysisJson.scores as any)?.overall === "number" ? (analysisJson.scores as any).overall : null;

    // Ownership VOR dem Write prüfen — verhindert Session-Übernahme durch
    // uid-Überschreiben (war beim Firestore-merge zuvor möglich).
    const ownership = await checkSessionOwnership(sessionId, uid);
    if (!ownership.allowed) {
      return NextResponse.json(
        { ok: false, error: apiMsg.accessDenied, code: "FORBIDDEN" },
        { status: 403 }
      );
    }

    // Injection-Schutz: eine vom Client uebergebene runId nur uebernehmen, wenn
    // sie - falls bereits existent - demselben Owner gehoert (sonst koennte ein
    // Angreifer fremde Run-Daten via gespoofter runId ueberschreiben).
    const existingRun = parsed.data.runId ? await getRun(sessionId, parsed.data.runId) : null;
    if (existingRun && existingRun.uid !== uid) {
      return NextResponse.json(
        { ok: false, error: apiMsg.accessDenied, code: "RUN_ID_CONFLICT" },
        { status: 409 }
      );
    }

    // Partition-Pin: existiert bereits ein (Schatten-)Run, MUSS seine gespeicherte
    // workspaceId uebernommen werden — sie ist die Partition des zentralen Spends
    // (Entitlement-Grant aus /api/analyze). Nur neu abgeleitet
    // (getWorkspaceIdForUser), wenn es noch keinen Run gibt. Verhindert, dass ein
    // Mitgliedschaftswechsel mitten im Flow Spend und Run in verschiedene
    // Partitionen spaltet (Refund/Delete liefe sonst ins Leere). Delete liest
    // dieselbe gespeicherte workspaceId.
    //
    // KK-1: Der lokale Hold-Integritaets-Check (PAYMENTS_ENABLED + getHold) wurde
    // mit dem lokalen Ledger abgebaut. Im zentralen Pfad sichert die Save-Grenze
    // der Schatten-Run aus /api/analyze (runId + centralSpendTxId werden dort
    // serverseitig gebunden; /api/analyze liefert die runId nur bei garantierter
    // Persistenz aus).
    const runWorkspaceId = existingRun?.workspaceId ?? (await getWorkspaceIdForUser(uid));

    await upsertSession(sessionId, uid);

    const runId = await createRun(
      {
        sessionId,
        uid,
        workspaceId: runWorkspaceId,
        // Zentralen Spend-Anker des (Schatten-)Runs bewahren -> Delete-Refund
        // kann zentral mit der spendTransactionId erstatten.
        centralSpendTxId: existingRun?.centralSpendTxId ?? null,

        conversationType: request.conversationType,
        conversationSubType: request.conversationSubType ?? null,
        goal: request.goal ?? null,
        lang: request.lang ?? null,
        jurisdiction: request.jurisdiction ?? null,

        transcriptText,

        analysisJson,
        ragContext,

        summary: analysisJson.summary,
        scoreOverall,
      },
      // runId aus /api/analyze uebernehmen, damit hold:{runId} / refund:{runId} matchen.
      parsed.data.runId
    );

    logger.api("/api/runs/save", "saved", { uid, sessionId, runId });
    return NextResponse.json({ ok: true, runId }, { status: 200 });
  } catch (err: any) {
    logger.apiError("/api/runs/save", err);
    return NextResponse.json(
      { ok: false, error: apiMsg.internalError, code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
