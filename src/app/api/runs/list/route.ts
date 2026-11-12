// src/app/api/runs/list/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { listRuns, sessionAccess } from "@/lib/server/runs-store";
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

export async function GET(req: NextRequest) {
  const apiMsg = getApiMessages(req);

  // Auth check
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const { uid } = authResult;

  // 30 Listenabrufe je Minute. S4 (Go-Live-Prüfung 12.11.2026): je Person statt je Adresse.
  const rlResponse = checkRateLimit(`runs-list:${uid}`, 30, 60_000, apiMsg.rateLimited);
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
    // B3 (Go-Live-Prüfung 12.11.2026): Gelesen wird nur, wenn das Sitzungsdokument existiert und der Person gehört.
    const access = await sessionAccess(sessionId, uid);
    if (access === "foreign") {
      return NextResponse.json(
        { ok: false, error: apiMsg.accessDenied, code: "FORBIDDEN" },
        { status: 403 }
      );
    }
    // Frische Sitzung ohne Analyse: Es gibt noch kein Sitzungsdokument. Leere Liste, ohne die Partition zu lesen.
    if (access === "missing") {
      return NextResponse.json({ ok: true, runs: [], hasMore: false, nextCursor: null }, { status: 200 });
    }

    const { runs, hasMore, nextCursor, badCursor } = await listRuns(
      sessionId,
      uid,
      limit,
      cursorRaw
    );
    if (badCursor) {
      return NextResponse.json(
        { ok: false, error: "Invalid cursor", code: "BAD_CURSOR" },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, runs, hasMore, nextCursor }, { status: 200 });
  } catch (err: any) {
    logger.apiError("/api/runs/list", err);
    return NextResponse.json(
      { ok: false, error: apiMsg.internalError, code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
