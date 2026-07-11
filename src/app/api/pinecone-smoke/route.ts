import { NextRequest, NextResponse } from "next/server";
// W5 (Pinecone-Ablösung): Smoke läuft jetzt gegen Cosmos-Vektor (gemini-768).
import { searchCards as pineconeSearchCards } from "@/lib/cosmos-cards";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // Auth check
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  // Rate limit: 10 requests per minute
  const rlKey = rateLimitKey(req, "pinecone-smoke");
  const rlResponse = checkRateLimit(rlKey, 10, 60_000);
  if (rlResponse) return rlResponse;

  const sp = req.nextUrl.searchParams;
  const text = sp.get("text") ?? "";
  const lang = sp.get("lang") ?? undefined;
  const topK = sp.get("topK") ?? sp.get("top_k") ?? undefined;

  try {
    const out = await pineconeSearchCards({ text, lang, topK });

    return NextResponse.json({
      ok: true,
      query: { text, lang: lang ?? null, topK: topK ?? null },
      count: out.count,
      results: out.results,
    });
  } catch (e: any) {
    console.error("[pinecone-smoke] unexpected error:", e);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
