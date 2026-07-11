/**
 * Cosmos NoSQL Vector Search — 1:1-Ersatz für pineconeSearchCards (pinecone.ts).
 *
 * Coach hat Pinecone (Integrated Embedding, multilingual-e5-large, 1024d) durch
 * die eigene Gemini-768-Embedding + Azure-Cosmos-Vektorsuche abgelöst. Diese Datei
 * exportiert `searchCards`, deren Rückgabe strukturell IDENTISCH zu pinecone.ts
 * `PineconeCompatResult` ist — damit bleibt generate-dynamic-feedback.ts (nutzt
 * `.count` und `.results[].metadata.chunk_text`) UNVERÄNDERT.
 *
 * ── Ein Container, triviale Partition ─────────────────────────────────────────
 * DB `coach-vec` (NEU, dedizierter Durchsatz — ein vektor-indizierter Container
 * geht NICHT auf Shared-Throughput, empirisch bei der Studio-Migration belegt),
 * Container `cards`, PK `/namespace`. Alle 418 Karten liegen im EINEN Namespace
 * `cards_v3` (triviale Partition). Vektor-Policy: /embedding, float32, 768,
 * cosine, diskANN.
 *
 * Score: `VectorDistance(c.embedding, @q)` (Container-cosine-Policy) → nearest-
 * first via `ORDER BY VectorDistance(...)` (Index-gestützt).
 *
 * Gehärtete Muster 1:1 aus Studios cosmos-vector.ts übernommen: parametrisierte
 * SQL-Filter (condToSql + Feldnamen-Whitelist, Injection-Härtung S-1), 429-Retry
 * mit Backoff, CosmosClient mit maxRetryAttemptCount=9.
 */
import { CosmosClient, type Container } from "@azure/cosmos";
import { embedText } from "@/lib/gemini-embed";

// Einheitliche Env-Var-Namen mit provision/backfill (Panel-Fund: sonst driftet
// bei einseitigem Override der Adapter auf einen leeren Container → 0 Treffer).
const VEC_DB = process.env.COSMOS_VECTOR_DATABASE || "coach-vec";
const VEC_CONTAINER = process.env.COSMOS_VECTOR_CONTAINER || "cards";
const NAMESPACE = "cards_v3";
const MAX_ATTEMPTS = 10;

// ── Rückgabe-Shape — strukturell identisch zu pinecone.ts PineconeCompatResult ──
type PineconeHit = {
  _id: string;
  _score: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fields?: Record<string, any>;
};
export type PineconeCompatResult = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any;
  hits: PineconeHit[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  matches: Array<{ id: string; score: number; metadata: Record<string, any> }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  results: Array<{ id: string; score: number; metadata: Record<string, any> }>;
  count: number;
};

/**
 * Projizierte Metadatenfelder — exakt pinecone.ts DEFAULT_FIELDS (chunk_text +
 * alle flachen Metadaten neben embedding). `metadata` des Treffers = genau diese
 * Felder (NICHT das embedding). id/score werden separat geführt (wie Pinecone).
 */
const CARD_FIELDS = [
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

// ── Lazy CosmosClient (coach-vec/cards) ──────────────────────────────────────
let _container: Container | null = null;
function container(): Container {
  if (_container) return _container;
  const endpoint = process.env.COSMOS_ENDPOINT;
  const key = process.env.COSMOS_KEY;
  if (!endpoint || !key) throw new Error("COSMOS_ENDPOINT / COSMOS_KEY not configured");
  _container = new CosmosClient({
    endpoint,
    key,
    // SDK-eigenes 429-Handling (erste Schicht), bevor unser App-Retry greift.
    connectionPolicy: {
      retryOptions: { maxRetryAttemptCount: 9, maxWaitTimeInSeconds: 60 },
    },
  })
    .database(VEC_DB)
    .container(VEC_CONTAINER);
  return _container;
}

// ── 429-Retry mit Backoff (Query) — Muster aus cosmos-vector.ts bulkWithRetry ──
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function backoffMs(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 30_000) + Math.floor(Math.random() * 250);
}
/** Throttling erkennen — auch wenn nur die Fehlermeldung „429/request rate" trägt. */
function isThrottle(e: unknown): boolean {
  const code = (e as { code?: number; statusCode?: number })?.code ?? (e as { statusCode?: number })?.statusCode;
  if (code === 429 || code === 503) return true;
  const msg = (e as Error)?.message || "";
  return /429|request rate is too large|too large|throttl/i.test(msg);
}

type SqlParam = { name: string; value: unknown };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = Record<string, any>;

async function queryWithRetry(query: string, params: SqlParam[]): Promise<Doc[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(backoffMs(attempt));
    try {
      const { resources } = await container()
        .items.query<Doc>({ query, parameters: params as never })
        .fetchAll();
      return resources || [];
    } catch (e) {
      lastErr = e;
      if (isThrottle(e)) continue; // gedrosselt → Backoff + erneut
      throw e; // fataler Fehler → sofort hoch
    }
  }
  throw new Error(`[cosmos-cards] query nach ${MAX_ATTEMPTS} Versuchen weiter gedrosselt: ${(lastErr as Error)?.message ?? lastErr}`);
}

// ── Pinecone-Filter ($eq/$ne/$in bzw. Rohwert) → parametrisierte SQL-Bedingung ──
// WERTE laufen IMMER als SQL-Parameter (@p{n}) — nie interpoliert. FELDNAMEN
// werden gegen eine Whitelist geprüft und sonst still verworfen: ein Filter-KEY
// ist andernfalls die einzige Injection-Fläche (roh in `c.${field}`), und der
// Request-Filter reicht Keys ungeprüft durch (adversariale Review S-1).
const ALLOWED_FILTER_FIELDS = new Set<string>([
  "conversation_type",
  "jurisdiction",
  "lang",
  "card_type",
  "skill",
  "status",
  "dataset_version",
]);
function condToSql(field: string, cond: unknown, params: SqlParam[]): string | null {
  if (!ALLOWED_FILTER_FIELDS.has(field)) return null; // unbekannter Feldname → kein Prädikat
  if (cond === null || cond === undefined) return null;
  const p = () => `@p${params.length}`;
  const col = `c.${field}`;
  if (typeof cond === "object" && !Array.isArray(cond)) {
    const c = cond as Record<string, unknown>;
    if ("$eq" in c) { const n = p(); params.push({ name: n, value: c.$eq }); return `${col} = ${n}`; }
    if ("$ne" in c) { const n = p(); params.push({ name: n, value: c.$ne }); return `${col} != ${n}`; }
    if ("$in" in c && Array.isArray(c.$in)) {
      if ((c.$in as unknown[]).length === 0) return null;
      const n = p(); params.push({ name: n, value: c.$in });
      return `ARRAY_CONTAINS(${n}, ${col})`;
    }
    return null;
  }
  const n = p(); params.push({ name: n, value: cond }); return `${col} = ${n}`;
}

/**
 * WHERE-Kern: IMMER c.namespace='cards_v3', dazu Metadaten-Filter (whitelist-
 * gegated) und — separat — c.lang=@lang. `lang` wird bewusst aus dem Filter-
 * Durchlauf ausgeschlossen (autoritativ über den `lang`-Parameter), damit der
 * Lang-Fallback (ohne lang erneut) eindeutig steuerbar bleibt.
 */
function buildWhere(
  filter: Record<string, unknown> | undefined,
  lang: string | undefined,
  params: SqlParam[]
): string {
  const nsP = `@p${params.length}`;
  params.push({ name: nsP, value: NAMESPACE });
  const parts = [`c.namespace = ${nsP}`];
  if (filter) {
    for (const [field, cond] of Object.entries(filter)) {
      if (field === "lang") continue; // lang läuft separat (s.o.)
      const sql = condToSql(field, cond, params);
      if (sql) parts.push(sql);
    }
  }
  if (typeof lang === "string" && lang.trim()) {
    const langP = `@p${params.length}`;
    params.push({ name: langP, value: lang.trim() });
    parts.push(`c.lang = ${langP}`);
  }
  return parts.join(" AND ");
}

/** Eine Vektorsuche (nearest-first, Index-gestützt) → Roh-Docs (inkl. score). */
async function runVectorSearch(
  vector: number[],
  topK: number,
  filter: Record<string, unknown> | undefined,
  lang: string | undefined
): Promise<Doc[]> {
  const params: SqlParam[] = [];
  const where = buildWhere(filter, lang, params);
  const qvP = `@p${params.length}`;
  params.push({ name: qvP, value: vector });
  const cols = ["c.id", ...CARD_FIELDS.map((f) => `c.${f}`)].join(", ");
  // topK inline als sanitisierter Integer (0 Injection-Fläche) — Muster aus
  // cosmos-vector.ts (parametrisiertes TOP wird dort bewusst vermieden).
  const top = Math.max(1, Math.floor(topK));
  const query =
    `SELECT TOP ${top} ${cols}, VectorDistance(c.embedding, ${qvP}) AS score ` +
    `FROM c WHERE ${where} ORDER BY VectorDistance(c.embedding, ${qvP})`;
  return queryWithRetry(query, params);
}

/** Roh-Docs → PineconeCompatResult (metadata = CARD_FIELDS, ohne embedding/id/score). */
function toCompat(raw: Doc[]): PineconeCompatResult {
  const matches = (raw || []).map((d) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata: Record<string, any> = {};
    for (const f of CARD_FIELDS) if (d[f] !== undefined && d[f] !== null) metadata[f] = d[f];
    return { id: String(d.id ?? ""), score: Number(d.score) || 0, metadata };
  });
  const hits: PineconeHit[] = matches.map((m) => ({ _id: m.id, _score: m.score, fields: m.metadata }));
  return { raw, hits, matches, results: matches, count: matches.length };
}

/**
 * Query-Adapter, der pineconeSearchCards ersetzt.
 *
 * Ablauf: (1) Query-Text mit Gemini-768 embedden; (2) WHERE bauen (immer
 * namespace='cards_v3', Filter conversation_type/jurisdiction whitelist-gegated,
 * lang separat); (3) VectorDistance-Query TOP k nearest-first; (4) Lang-Fallback
 * (wie Coach heute in pinecone.ts): lang gesetzt UND 0 Treffer → OHNE lang erneut;
 * (5) Rückgabe im PineconeCompatResult-Shape.
 */
export async function searchCards(args: {
  text: string;
  topK?: number | string; // string zulässig (Query-Param der Smoke-Route), wie Pinecone
  lang?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filter?: Record<string, unknown>;
}): Promise<PineconeCompatResult> {
  const text = String(args?.text ?? "").trim();
  if (!text) throw new Error("Missing search text (expected args.text)");
  const rawK = typeof args?.topK === "string" ? Number(args.topK) : args?.topK;
  const topK = Number.isFinite(rawK) && (rawK as number) > 0 ? Math.floor(rawK as number) : 8;
  const lang = typeof args?.lang === "string" && args.lang.trim() ? args.lang.trim() : undefined;
  const filter = args?.filter;

  const q = await embedText(text);

  let raw = await runVectorSearch(q, topK, filter, lang);

  // Lang-Fallback: lang gesetzt UND 0 Treffer → erneut OHNE lang (pinecone.ts:85-93).
  if (lang && raw.length === 0) {
    raw = await runVectorSearch(q, topK, filter, undefined);
  }

  return toCompat(raw);
}

// ── Test-Seam (ohne echte Cosmos-Env): Fake-Container injizieren ──
export const _test = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setContainer(c: any) { _container = c as Container; },
  reset() { _container = null; },
  VEC_DB, VEC_CONTAINER, NAMESPACE, CARD_FIELDS,
  condToSql, buildWhere,
};
