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

function pickRequest(body: any) {
  if (isObject(body?.request)) return body.request;

  // Fallback: UI schickt evtl. conversationType/... top-level
  if (isObject(body) && typeof body.conversationType === "string") {
    return {
      conversationType: body.conversationType,
      conversationSubType: body.conversationSubType ?? null,
      goal: body.goal ?? null,
      transcriptText: body.transcriptText ?? null,
      lang: body.lang ?? null,
      jurisdiction: body.jurisdiction ?? null,
    };
  }

  return null;
}

function pickResult(body: any) {
  // Akzeptiere mehrere Felder, damit UI nicht ständig "Schema mismatch" produziert
  return (
    body?.result ??
    body?.analysis ??
    body?.analysisJson ??
    body?.analysisResult ??
    body?.output ??
    null
  );
}

function coerceBool(v: any): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "1" || v.toLowerCase() === "true";
  return false;
}

export async function POST(req: Request) {
  try {
    const json = await req.json().catch(() => null);
    if (!json || !isObject(json)) {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const sessionId = parsed.data.sessionId;

    const reqCandidate = pickRequest(json);
    const reqParsed = requestSchema.safeParse(reqCandidate);
    if (!reqParsed.success) {
      return NextResponse.json(
        { ok: false, error: reqParsed.error.flatten() },
        { status: 400 }
      );
    }

    const request = reqParsed.data;

    const result = pickResult(json);
    if (!isObject(result)) {
      return NextResponse.json(
        { ok: false, error: "Missing result (expected body.result)" },
        { status: 400 }
      );
    }

    const storeTranscript =
      parsed.data.options?.storeTranscript ??
      coerceBool((json as any).storeTranscript) ??
      coerceBool((json as any).saveTranscript);

    const transcriptText =
      storeTranscript && typeof request.transcriptText === "string" && request.transcriptText.trim()
        ? request.transcriptText
        : null;

    // Normalisiere Analyse-Felder (damit Liste/Detail stabil sind)
    const analysisJson = {
      summary: typeof (result as any).summary === "string" ? (result as any).summary : null,
      strengths: Array.isArray((result as any).strengths) ? (result as any).strengths : [],
      improvements: Array.isArray((result as any).improvements) ? (result as any).improvements : [],
      rewrites: Array.isArray((result as any).rewrites) ? (result as any).rewrites : [],
      riskFlags: Array.isArray((result as any).riskFlags) ? (result as any).riskFlags : [],
      scores: isObject((result as any).scores) ? (result as any).scores : {},
    };

    const ragContext = {
      cards: Array.isArray((result as any).rag_context_cards) ? (result as any).rag_context_cards : [],
      count:
        typeof (result as any).rag_context_count === "number"
          ? (result as any).rag_context_count
          : null,
      error: typeof (result as any).rag_error === "string" ? (result as any).rag_error : null,
    };

    const scoreOverall =
      typeof (analysisJson.scores as any)?.overall === "number"
        ? (analysisJson.scores as any).overall
        : null;

    const db = getAdminDb();
    const sessionRef = db.collection("sessions").doc(sessionId);

    // Session "touch" (optional, aber praktisch)
    await sessionRef.set(
      { updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );

    const runRef = await sessionRef.collection("runs").add({
      createdAt: FieldValue.serverTimestamp(),

      conversationType: request.conversationType,
      conversationSubType: request.conversationSubType ?? null,
      goal: request.goal ?? null,
      lang: request.lang ?? null,
      jurisdiction: request.jurisdiction ?? null,

      // Optional speichern
      transcriptText,

      // Analyse
      analysisJson,
      ragContext,

      // Für Listen-View
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
