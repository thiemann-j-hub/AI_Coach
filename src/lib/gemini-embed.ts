/**
 * W5 (Pinecone-Ablösung) — Gemini-768-Embedding für Coach.
 *
 * Coach nutzte bisher Pinecone Integrated Embedding (multilingual-e5-large, 1024d,
 * server-seitig). Nach der Cosmos-Migration embedden wir chunk_text (Backfill) UND
 * die User-Query (Retrieval) selbst mit `gemini-embedding-001` (768d) — identisch
 * zur restlichen Plattform (Studio/Jobmap), damit Passage- und Query-Vektorraum
 * konsistent sind. Muster 1:1 aus Studio gemini.ts (embedText).
 */
import { GoogleGenAI } from "@google/genai";

const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
const DIM = 768;

let _ai: GoogleGenAI | null = null;
function ai(): GoogleGenAI {
  if (_ai) return _ai;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  _ai = new GoogleGenAI({ apiKey });
  return _ai;
}

async function withRetry<T>(fn: () => Promise<T>, label: string, max = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const status = (e as { status?: number })?.status;
      const transient = status === 429 || status === 500 || status === 503 || status === undefined;
      if (!transient || attempt === max) break;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      console.warn(`[gemini-embed] ${label} transient (status=${status}, ${attempt}/${max}), retry`);
    }
  }
  throw lastErr;
}

/** Ein Text → 768-dim Gemini-Vektor. Leerer Text → Null-Vektor (API lehnt leer ab). */
export async function embedText(text: string): Promise<number[]> {
  if (!text || text.trim().length === 0) return new Array(DIM).fill(0);
  const res = await withRetry(
    () =>
      ai().models.embedContent({
        model: EMBEDDING_MODEL,
        contents: text,
        config: { outputDimensionality: DIM },
      }),
    "embedText"
  );
  return res.embeddings?.[0]?.values ?? [];
}

/** Batch (kleine Chunks parallel, ordnungserhaltend). */
export async function embedBatch(texts: string[], concurrency = 20): Promise<number[][]> {
  const out: number[][] = new Array(texts.length);
  for (let i = 0; i < texts.length; i += concurrency) {
    const slice = texts.slice(i, i + concurrency);
    const vecs = await Promise.all(slice.map((t) => embedText(t)));
    vecs.forEach((v, j) => (out[i + j] = v));
  }
  return out;
}
