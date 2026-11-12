import { NextRequest, NextResponse } from "next/server";
// RAG-Smoke gegen Cosmos-Vektor (gemini-768).
import { searchCards } from "@/lib/cosmos-cards";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { isCostCapAdmin } from "@/lib/server/cost-cap";
import { serviceRequestOk } from "@/lib/server/credits/cs-credential";

export const runtime = "nodejs";

/** Höchstzahl Treffer je Abruf. Vorher frei: mit großem topK kam die ganze Bibliothek. */
const TOP_K_MAX = 10;
const TOP_K_DEFAULT = 8;

/** topK aus der Adresse, gedeckelt auf 1 bis TOP_K_MAX (nicht exportiert: Routen-Dateien dürfen nur Routen-Felder exportieren). */
function gedeckeltesTopK(raw: string | null | undefined): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return TOP_K_DEFAULT;
  return Math.min(n, TOP_K_MAX);
}

/**
 * Paket 2, C20 (12.11.2026): Der Prüfweg ist nur noch mit Dienst-Ausweis offen (wie /api/service/*) oder für
 * Plattform-Admins (ADMIN_EMAILS). Vorher bekam jede angemeldete Person mit draft=1 und großem topK die ganze
 * Kartenbibliothek samt Entwürfen. Alle anderen sehen 404, als gäbe es die Route nicht.
 */
async function darfPruefen(req: NextRequest): Promise<boolean> {
  if (serviceRequestOk(req)) return true;
  const auth = await requireAuth(req);
  return !(auth instanceof NextResponse) && isCostCapAdmin(auth.email);
}

export async function GET(req: NextRequest) {
  if (!(await darfPruefen(req))) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Rate limit: 10 requests per minute
  const rlKey = rateLimitKey(req, "rag-smoke");
  const rlResponse = checkRateLimit(rlKey, 10, 60_000);
  if (rlResponse) return rlResponse;

  const sp = req.nextUrl.searchParams;
  const text = sp.get("text") ?? "";
  const lang = sp.get("lang") ?? undefined;
  const topK = gedeckeltesTopK(sp.get("topK") ?? sp.get("top_k"));

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
      query: { text, lang: lang ?? null, topK, filter: Object.keys(filter).length ? filter : null, includeDraft },
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
