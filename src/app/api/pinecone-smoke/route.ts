// src/app/api/pinecone-smoke/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pineconeSearchCards } from "@/lib/pinecone";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const text = sp.get("text") ?? "";
  const lang = sp.get("lang") ?? undefined;
  const topK = sp.get("topK") ?? sp.get("top_k") ?? undefined;

  const debug = sp.get("debug") === "1";

  try {
    const out = await pineconeSearchCards({ text, lang, topK });

    return NextResponse.json({
      ok: true,
      query: { text, lang: lang ?? null, topK: topK ?? null },
      count: out.count,
      results: out.results,
      raw: debug ? out.raw : undefined,
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: e?.message ?? String(e),
        query: { text, lang: lang ?? null, topK: topK ?? null },
      },
      { status: 500 }
    );
  }
}