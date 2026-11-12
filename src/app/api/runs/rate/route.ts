// src/app/api/runs/rate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { rateRun, sessionAccess } from "@/lib/server/runs-store";
import { checkRateLimit } from "@/lib/rate-limit";
import { getApiMessages } from "@/lib/server/get-request-locale";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  sessionId: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/, "sessionId must be url-safe (a-zA-Z0-9_-)."),
  runId: z.string().min(1).max(256),
  rating: z.number().int().min(1).max(5),
});

export async function POST(req: NextRequest) {
  const apiMsg = getApiMessages(req);

  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const { uid } = authResult;

  // S4 (Go-Live-Prüfung 12.11.2026): je Person statt je Adresse.
  const rlResponse = checkRateLimit(`runs-rate:${uid}`, 20, 60_000, apiMsg.rateLimited);
  if (rlResponse) return rlResponse;

  try {
    const json = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { sessionId, runId, rating } = parsed.data;

    // B3 (Go-Live-Prüfung 12.11.2026): wie /api/runs/get — eigenes Sitzungsdokument, eigener Lauf. Vorher ließ sich
    // an ein fremdes Dokument (z. B. ein Spielbuch) ein Feld `rating` schreiben.
    const access = await sessionAccess(sessionId, uid);
    if (access === "foreign") {
      return NextResponse.json(
        { ok: false, error: apiMsg.accessDenied, code: "FORBIDDEN" },
        { status: 403 }
      );
    }

    const updated = access === "own" && (await rateRun(sessionId, runId, uid, rating));
    if (!updated) {
      return NextResponse.json(
        { ok: false, error: apiMsg.notFound, code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    logger.api("/api/runs/rate", "saved", { uid, sessionId, runId, rating });
    return NextResponse.json({ ok: true, rating }, { status: 200 });
  } catch (err: any) {
    logger.apiError("/api/runs/rate", err);
    return NextResponse.json(
      { ok: false, error: apiMsg.internalError, code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
