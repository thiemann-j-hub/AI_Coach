// src/lib/pinecone.ts
//
// Pinecone "Search with text" (Integrated Embedding) – stable per REST
// Endpoint: POST https://{INDEX_HOST}/records/namespaces/{namespace}/search
// Wichtig: X-Pinecone-Api-Version setzen.

function mustEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing environment variable: ${key}`);
  return v;
}

function cleanHost(host: string): string {
  return host.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

function isObject(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function coerceTopK(v: unknown, fallback = 5): number {
  const n =
    typeof v === "string" ? Number(v) : typeof v === "number" ? v : fallback;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

/**
 * Lazy ENV loading: verhindert 500 beim Import,
 * damit Route-try/catch sauber JSON-Errors liefern kann.
 */
function getPineconeConfig() {
  const apiKey = mustEnv("PINECONE_API_KEY");
  const indexHost = cleanHost(mustEnv("PINECONE_INDEX_HOST"));
  const namespace =
    (process.env.PINECONE_NAMESPACE ?? "__default__").trim() || "__default__";
  return { apiKey, indexHost, namespace };
}

export type PineconeSearchArgs = {
  text: string;
  topK?: number | string;
  lang?: string;
  filter?: Record<string, any>;
  fields?: string[];
};

export type PineconeHit = {
  _id: string;
  _score: number;
  fields?: Record<string, any>;
};

export type PineconeCompatResult = {
  raw: any;
  hits: PineconeHit[];
  matches: Array<{ id: string; score: number; metadata: Record<string, any> }>;
  results: Array<{ id: string; score: number; metadata: Record<string, any> }>;
  count: number;
};

const DEFAULT_FIELDS = [
  "chunk_text",
  "title",
  "card_group_id",
  "card_type",
  "card_version",
  "version",
  "dataset_version",
  "status",
  "lang",
  "conversation_type",
  "conversation_types",
  "skill",
  "skills",
  "competency_ids",
  "competency_primary",
  "competency_secondary",
  "seniority",
  "jurisdiction",
  "workplace_context",
  "level_min",
  "level_max",
  "source_id",
  "source_ref",
  "created_at",
  "updated_at",
];

type NormalizedArgs = {
  text: string;
  topK: number;
  filter?: Record<string, any>;
  fields: string[];
};

function normalizeArgs(arg1: any, arg2?: any): NormalizedArgs {
  const textCandidate =
    typeof arg1 === "string"
      ? arg1
      : arg1?.text ??
        arg1?.query?.text ??
        arg1?.query?.inputs?.text ??
        arg1?.inputs?.text ??
        arg1?.query?.inputs?.[0]?.text ??
        arg1?.inputs?.[0]?.text ??
        arg2?.text;

  const text = typeof textCandidate === "string" ? textCandidate.trim() : "";
  if (!text) {
    throw new Error(
      "Missing search text (expected arg.text OR arg.query.text OR arg.query.inputs.text OR string arg)"
    );
  }

  const topKCandidate =
    arg2?.topK ??
    arg2?.top_k ??
    arg1?.topK ??
    arg1?.top_k ??
    arg1?.query?.topK ??
    arg1?.query?.top_k ??
    arg1?.query?.topk ??
    arg1?.topk;

  const topK = coerceTopK(topKCandidate, 5);

  const filterCandidate = arg2?.filter ?? arg1?.filter ?? arg1?.query?.filter;
  const langCandidate =
    arg2?.lang ??
    arg1?.lang ??
    arg1?.query?.lang ??
    filterCandidate?.lang ??
    arg1?.query?.filter?.lang;

  let filter: Record<string, any> | undefined = isObject(filterCandidate)
    ? { ...filterCandidate }
    : undefined;

  if (typeof langCandidate === "string" && langCandidate.trim()) {
    const lang = langCandidate.trim();
    if (!filter) filter = { lang };
    else if (filter.lang === undefined) filter.lang = lang;
  }

  const fieldsCandidate = arg2?.fields ?? arg1?.fields ?? arg1?.query?.fields;
  const fields =
    Array.isArray(fieldsCandidate) && fieldsCandidate.length > 0
      ? fieldsCandidate
      : DEFAULT_FIELDS;

  return { text, topK, filter, fields };
}

async function searchWithTextViaRest(args: NormalizedArgs) {
  const { apiKey, indexHost, namespace } = getPineconeConfig();

  const url = `https://${indexHost}/records/namespaces/${encodeURIComponent(
    namespace
  )}/search`;

  const body: any = {
    query: {
      inputs: { text: args.text }, // inputs ist OBJEKT {text:"..."}
      top_k: args.topK,
    },
    fields: args.fields,
  };

  if (args.filter && Object.keys(args.filter).length > 0) {
    body.query.filter = args.filter;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Api-Key": apiKey,
      "X-Pinecone-Api-Version": "2025-10",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `Pinecone REST search failed (${res.status} ${res.statusText}): ${txt.slice(
        0,
        800
      )}`
    );
  }

  return await res.json();
}

function toCompat(raw: any): PineconeCompatResult {
  const hits: PineconeHit[] = raw?.result?.hits ?? [];

  const matches = Array.isArray(hits)
    ? hits.map((h: any) => ({
        id: String(h?._id ?? ""),
        score: Number(h?._score ?? 0),
        metadata: (h?.fields ?? {}) as Record<string, any>,
      }))
    : [];

  return {
    raw,
    hits,
    matches,
    results: matches,
    count: matches.length,
  };
}

export async function pineconeSearchCards(
  arg1: any,
  arg2?: any
): Promise<PineconeCompatResult> {
  const args = normalizeArgs(arg1, arg2);
  const raw = await searchWithTextViaRest(args);
  return toCompat(raw);
}

export const smokeSearchCards = pineconeSearchCards;
