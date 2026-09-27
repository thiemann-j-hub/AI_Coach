import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { computeQualityStats, formatQualityStatsLine } from "@/lib/server/quality-stats";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/quality/stats?days=30 — Kennzahlen der Auswertungsqualität für das
 * Tagesbriefing (N4-88, Owner-GO 27.09.2026). Service-zu-Service: Header
 * `x-service-token` muss QUALITY_STATS_TOKEN entsprechen (kein Nutzer-Login,
 * keine Inhalte, nur Zähler). Ohne gesetztes Token ist die Route geschlossen.
 */
function tokenOk(req: NextRequest): boolean {
  const expected = process.env.QUALITY_STATS_TOKEN ?? "";
  const given = req.headers.get("x-service-token") ?? "";
  if (!expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  const rl = checkRateLimit(rateLimitKey(req, "quality-stats"), 30, 60_000);
  if (rl) return rl;
  if (!tokenOk(req)) {
    return NextResponse.json({ ok: false, code: "FORBIDDEN" }, { status: 403 });
  }
  try {
    const days = Number(req.nextUrl.searchParams.get("days") ?? "30");
    const stats = await computeQualityStats(Number.isFinite(days) ? days : 30);
    return NextResponse.json({ ok: true, stats, line: formatQualityStatsLine(stats) });
  } catch (err) {
    logger.apiError("/api/quality/stats", err);
    return NextResponse.json({ ok: false, code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
