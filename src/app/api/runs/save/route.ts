// src/app/api/runs/save/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sessionIdSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "sessionId must be url-safe (a-zA-Z0-9_-).");

const requestSchema = z
  .object({
    conversationType: z.string().min(1),
    conversationSubType: z.string().optional().nullable(),
    goal: z.string().optional().nullable(),
    transcriptText: z.string().optional().nullable(),
    lang: z.string().optional().nullable(),
    jurisdiction: z.string().optional().nullable(),
    leaderLabel: z.string().optional().nullable(),
    employeeLabel: z.string().optional().nullable(),
  })
  .passthrough();

const optionsSchema = z
  .object({
    storeTranscript: z.boolean().optional(),
  })
  .passthrough();

const bodySchema = z
  .object({
    sessionId: sessionIdSchema,
    request: requestSchema.optional(),
    result: z.any().optional(),
    options: optionsSchema.optional(),
  })
  .passthrough();

function isObject(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function safeTrimString(v: any): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

/**
 * Like coerceBool, but returns undefined when the value is "not provided".
 * This allows fallback chaining (storeTranscript -> saveTranscript).
 */
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
  // 1) preferred: body.request
  let req: any = isObject(body?.request) ? body.request : null;

  // 2) fallback: legacy top-level fields
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

  // 3) IMPORTANT: If UI sends transcriptText top-level (but request exists),
  // merge it in so "Transkript speichern" works.
  if (isObject(req)) {
    const have = safeTrimString((req as any).transcriptText);
    const top = safeTrimString(body?.transcriptText);
    if (!have && top) req = { ...req, transcriptText: top };
  }

  return req ?? null;
}

function pickResult(body: any) {
  // accept multiple keys to reduce UI/backend mismatch issues
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

export async function POST(req: Request) {
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

    // storeTranscript:
    // - explicit flags win (options.storeTranscript / storeTranscript / saveTranscript)
    // - otherwise: if transcriptText is provided, we store it (UI only sends it when toggle is on)
    const storeTranscriptExplicit =
      parsed.data.options?.storeTranscript ??
      pickBool((json as any).storeTranscript) ??
      pickBool((json as any).saveTranscript);

    const storeTranscript =
      typeof storeTranscriptExplicit === "boolean" ? storeTranscriptExplicit : !!transcriptCandidate;

    const transcriptText = storeTranscript && transcriptCandidate ? transcriptCandidate : null;

    // Normalize analysis fields (stable for list/detail UI)
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
    };

    const ragContext = {
      cards: Array.isArray((result as any).rag_context_cards) ? (result as any).rag_context_cards : [],
      count: typeof (result as any).rag_context_count === "number" ? (result as any).rag_context_count : null,
      error: typeof (result as any).rag_error === "string" ? (result as any).rag_error : null,
    };

    const scoreOverall =
      typeof (analysisJson.scores as any)?.overall === "number" ? (analysisJson.scores as any).overall : null;

    const db = getAdminDb();
    const sessionRef = db.collection("sessions").doc(sessionId);

    // Session touch
    await sessionRef.set({ updatedAt: FieldValue.serverTimestamp() }, { merge: true });

    const runRef = await sessionRef.collection("runs").add({
      createdAt: FieldValue.serverTimestamp(),

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
    });

    return NextResponse.json({ ok: true, runId: runRef.id }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: err?.message ?? String(err),
        code: err?.code ?? null,
        details: err?.details ?? null,
      },
      { status: 500 }
    );
  }
}
