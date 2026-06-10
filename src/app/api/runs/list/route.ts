// src/app/api/runs/list/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminDb } from "@/lib/firebase-admin";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sessionIdSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "sessionId must be url-safe (a-zA-Z0-9_-).");

function toIso(v: any): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (v?.toDate) {
    try {
      return v.toDate().toISOString();
    } catch {
      return null;
    }
  }
  if (v instanceof Date) return v.toISOString();
  return null;
}

export async function GET(req: NextRequest) {
  // Auth check
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const { uid } = authResult;

  // Rate limit: 30 list requests per minute
  const rlKey = rateLimitKey(req, "runs-list");
  const rlResponse = checkRateLimit(rlKey, 30, 60_000);
  if (rlResponse) return rlResponse;

  const sp = req.nextUrl.searchParams;
  const sessionId = sp.get("sessionId") ?? "";

  const parsed = sessionIdSchema.safeParse(sessionId);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten(), code: "BAD_SESSION_ID" },
      { status: 400 }
    );
  }

  try {
    const db = getAdminDb();

    // Verify session ownership (sessions with uid field)
    const sessionSnap = await db.collection("sessions").doc(sessionId).get();
    const sessionUid = sessionSnap.data()?.uid;
    if (sessionUid && sessionUid !== uid) {
      return NextResponse.json(
        { ok: false, error: "Access denied", code: "FORBIDDEN" },
        { status: 403 }
      );
    }

    const snap = await db
      .collection("sessions")
      .doc(sessionId)
      .collection("runs")
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const runs = snap.docs.map((d) => {
      const data = d.data() as any;

      const analysisJson = data?.analysisJson ?? null;
      const scores = analysisJson?.scores ?? data?.scores ?? null;

      return {
        id: d.id,
        createdAt: toIso(data?.createdAt),
        conversationType: data?.conversationType ?? null,
        conversationSubType: data?.conversationSubType ?? null,
        goal: data?.goal ?? null,
        lang: data?.lang ?? null,
        jurisdiction: data?.jurisdiction ?? null,
        scoreOverall:
          typeof data?.scoreOverall === "number"
            ? data.scoreOverall
            : typeof scores?.overall === "number"
              ? scores.overall
              : null,
        summary:
          typeof data?.summary === "string"
            ? data.summary
            : typeof analysisJson?.summary === "string"
              ? analysisJson.summary
              : null,
        hasTranscript:
          typeof data?.transcriptText === "string" &&
          data.transcriptText.trim().length > 0,
      };
    });

    return NextResponse.json({ ok: true, runs }, { status: 200 });
  } catch (err: any) {
    logger.apiError("/api/runs/list", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
