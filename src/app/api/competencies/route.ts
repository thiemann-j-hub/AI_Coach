import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  transcriptText: z.string().min(1).max(500_000),
  lang: z.enum(["de", "en"]).optional(),
  leaderLabel: z.string().max(200).optional().nullable(),
  employeeLabel: z.string().max(200).optional().nullable(),
});

export async function POST(req: NextRequest) {
  // Auth check
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  // Rate limit: 10 requests per minute
  const rlKey = rateLimitKey(req, "competencies");
  const rlResponse = checkRateLimit(rlKey, 10, 60_000);
  if (rlResponse) return rlResponse;

  try {
    const json = await req.json();
    const parsed = requestSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const d = parsed.data;

    // Lazy import -> falls score-competencies kaputt ist, crasht nicht die ganze App beim Laden
    const mod: any = await import("../../../ai/flows/score-competencies");

    if (typeof mod.scoreCompetencies !== "function") {
      return NextResponse.json(
        { ok: false, error: "scoreCompetencies export missing" },
        { status: 500 }
      );
    }

    const result = await mod.scoreCompetencies({
      transcriptText: d.transcriptText,
      lang: d.lang,
      leaderLabel: d.leaderLabel ?? undefined,
      employeeLabel: d.employeeLabel ?? undefined,
    });

    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (err: any) {
    console.error("[competencies] unexpected error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
