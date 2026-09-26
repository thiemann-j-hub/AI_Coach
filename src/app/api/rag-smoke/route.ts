import { NextRequest, NextResponse } from "next/server";
// RAG-Smoke gegen Cosmos-Vektor (gemini-768).
import { searchCards } from "@/lib/cosmos-cards";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // Auth check
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  // Rate limit: 10 requests per minute
  const rlKey = rateLimitKey(req, "rag-smoke");
  const rlResponse = checkRateLimit(rlKey, 10, 60_000);
  if (rlResponse) return rlResponse;

  const sp = req.nextUrl.searchParams;
  const text = sp.get("text") ?? "";
  const lang = sp.get("lang") ?? undefined;
  const topK = sp.get("topK") ?? sp.get("top_k") ?? undefined;

  try {
    // V1 (25.09.): optionaler Kundenfilter, um die Treffermenge des echten
    // Analyse-Wegs live zu pruefen (jurisdiction wie buildBaseFilter: $in mit 'global').
    const jurisdiction = sp.get("jurisdiction") ?? undefined;
    const conversationType = sp.get("conversation_type") ?? undefined;
    const filter: Record<string, unknown> = {};
    if (jurisdiction) filter.jurisdiction = jurisdiction === "global" ? "global" : { $in: [jurisdiction, "global"] };
    if (conversationType) filter.conversation_type = conversationType;
    // E-4 (25.09.): draft=1 zeigt auch Entwürfe — Prüfweg vor der Freigabe
    // (scripts/publish-coach-cards.ts). Der Kundenweg sieht nur 'published'.
    const includeDraft = sp.get("draft") === "1";
    const out = await searchCards({ text, lang, topK, filter: Object.keys(filter).length ? filter : undefined, includeDraft });

    return NextResponse.json({
      ok: true,
      query: { text, lang: lang ?? null, topK: topK ?? null, filter: Object.keys(filter).length ? filter : null, includeDraft },
      count: out.count,
      results: out.results,
    });
  } catch (e: any) {
    console.error("[rag-smoke] unexpected error:", e);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
