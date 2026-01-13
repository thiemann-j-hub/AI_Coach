import { NextRequest, NextResponse } from "next/server";
import { pineconeSearchCards } from "@/lib/pinecone";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const text = sp.get("text") ?? "";
  const lang = sp.get("lang") ?? undefined;
  const topK = sp.get("topK") ?? sp.get("top_k") ?? undefined;
  const debug = sp.get("debug") === "1";

  const envStatus = debug
    ? {
        PINECONE_API_KEY: Boolean(process.env.PINECONE_API_KEY),
        PINECONE_INDEX_HOST: Boolean(process.env.PINECONE_INDEX_HOST),
        PINECONE_NAMESPACE: Boolean(process.env.PINECONE_NAMESPACE),
      }
    : undefined;

  try {
    const out = await pineconeSearchCards({ text, lang, topK });

    return NextResponse.json({
      ok: true,
      query: { text, lang: lang ?? null, topK: topK ?? null },
      count: out.count,
      results: out.results,
      raw: debug ? out.raw : undefined,
      envStatus,
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: e?.message ?? String(e),
        query: { text, lang: lang ?? null, topK: topK ?? null },
        envStatus,
      },
      { status: 500 }
    );
  }
}
