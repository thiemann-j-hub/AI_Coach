// src/app/api/runs/list/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminDb } from "@/lib/firebase-admin";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getApiMessages } from "@/lib/server/get-request-locale";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sessionIdSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "sessionId must be url-safe (a-zA-Z0-9_-).");

// Cursor = Doc-ID des letzten Runs der vorherigen Seite
const cursorSchema = z.string().min(1).max(256);

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
  const apiMsg = getApiMessages(req);

  // Auth check
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const { uid } = authResult;

  // Rate limit: 30 list requests per minute
  const rlKey = rateLimitKey(req, "runs-list");
  const rlResponse = checkRateLimit(rlKey, 30, 60_000, apiMsg.rateLimited);
  if (rlResponse) return rlResponse;

  const sp = req.nextUrl.searchParams;
  const sessionId = sp.get("sessionId") ?? "";
  // limit-Parameter der Frontends respektieren (wurde bisher ignoriert), capped 1..100
  const limitRaw = Number.parseInt(sp.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 50;
  const cursorRaw = sp.get("cursor");

  const parsed = sessionIdSchema.safeParse(sessionId);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten(), code: "BAD_SESSION_ID" },
      { status: 400 }
    );
  }

  if (cursorRaw !== null && !cursorSchema.safeParse(cursorRaw).success) {
    return NextResponse.json(
      { ok: false, error: "Invalid cursor", code: "BAD_CURSOR" },
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
        { ok: false, error: apiMsg.accessDenied, code: "FORBIDDEN" },
        { status: 403 }
      );
    }

    const runsRef = db
      .collection("sessions")
      .doc(sessionId)
      .collection("runs");

    let query = runsRef.orderBy("createdAt", "desc");

    // Cursor-Pagination: per Doc-Snapshot positionieren (robust auch bei
    // gemischten createdAt-Typen, Firestore tiebreakt automatisch über __name__)
    if (cursorRaw) {
      const cursorSnap = await runsRef.doc(cursorRaw).get();
      if (!cursorSnap.exists) {
        return NextResponse.json(
          { ok: false, error: "Invalid cursor", code: "BAD_CURSOR" },
          { status: 400 }
        );
      }
      query = query.startAfter(cursorSnap);
    }

    // Ein Dokument mehr holen, um hasMore zu bestimmen
    const snap = await query.limit(limit + 1).get();
    const hasMore = snap.docs.length > limit;
    const pageDocs = hasMore ? snap.docs.slice(0, limit) : snap.docs;

    const runs = pageDocs.map((d) => {
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

    const nextCursor = hasMore && pageDocs.length > 0 ? pageDocs[pageDocs.length - 1].id : null;

    return NextResponse.json({ ok: true, runs, hasMore, nextCursor }, { status: 200 });
  } catch (err: any) {
    logger.apiError("/api/runs/list", err);
    return NextResponse.json(
      { ok: false, error: apiMsg.internalError, code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
