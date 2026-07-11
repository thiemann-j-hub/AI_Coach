/**
 * VECTOR-QUOTA (Coach) — Backfill: cards_v3-Export → Gemini-768-Embed →
 * Cosmos-Upsert nach `coach-vec`/`cards`. Zubringer zum Vektor-Container, den
 * `scripts/provision-coach-vectors.ts` (idempotent) zuvor angelegt hat.
 *
 * Quelle:  data/cards_v3_export.json — { namespace:"cards_v3", count, records:[
 *          { id, metadata:{ chunk_text + 24 weitere Felder } } ] } (418 Karten).
 * Ziel:    coach-vec/cards, pk /namespace, EIN Namespace-Wert "cards_v3"
 *          (triviale Partition). Doc-Shape FLACH:
 *            { id, namespace:"cards_v3", embedding:number[768],
 *              chunk_text, …24 weitere Metadatenfelder }
 *          d. h. ALLE Metadatenfelder liegen flach neben id/namespace/embedding.
 * Embed:   record.metadata.chunk_text → gemini-embedding-001 (768) via embedBatch
 *          (ordnungserhaltend), identisch zum Retrieval-Pfad (gemini-embed.ts).
 *
 * Gehärtete Muster (1:1 aus ai-elearning-studio/src/lib/server/cosmos-vector.ts
 * bzw. scripts/vector-migrate/reembed-backfill.ts übernommen, NICHT neu erfunden):
 *  - CosmosClient mit connectionPolicy.retryOptions.maxRetryAttemptCount=9
 *    (SDK-eigene 429-Absorption, erste Schicht bei RU-schweren Vektor-Upserts).
 *  - bulkWithRetry: App-Retry mit Exponential-Backoff für 429/449/503 (zweite
 *    Schicht) — ohne das bricht ein Autoscale-Ramp-429 den ganzen Backfill hart ab.
 *  - Idempotent: id-stabil (record.id → Upsert = mergeOrUpsert). Re-Runs sind
 *    no-op auf den Count; DIFF-AWARE (bereits vorhandene ids werden übersprungen)
 *    → billige Re-Runs, schont Gemini-Quota. `--force` re-embedded alles.
 *  - Count-Verify am Ende: Cosmos-COUNT(namespace) == 418, sonst throw.
 *
 * INERT ggü. der App: schreibt NUR in den (getrennten) Vektor-Container, ändert
 * keinen Router, kein Live-Pfad. Lauf (Env aus .env.local: COSMOS_ENDPOINT/
 * COSMOS_KEY account-weit für pulsecraft-prod-cosmos, GEMINI_API_KEY):
 *   npx tsx scripts/backfill-coach-cards.ts [--dry-run] [--force]
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { CosmosClient, type Container } from "@azure/cosmos";
import { embedBatch } from "../src/lib/gemini-embed";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: join(here, "..", ".env.local") });

// ── Vertrag (fix — NICHT abweichen) ──────────────────────────────────────────
const NAMESPACE = "cards_v3"; // einziger Partition-Key-Wert (alle Karten)
const EXPECTED = 418; // erwartete Kartenzahl → Count-Verify-Ziel
const DIM = 768; // gemini-embedding-001 Dimensionalität (Container-Policy)
const EXPORT_PATH = join(here, "..", "data", "cards_v3_export.json");

// Ziel-DB/-Container — Defaults identisch zu provision-coach-vectors.ts.
const VEC_DB = process.env.COSMOS_VECTOR_DATABASE || "coach-vec";
const VEC_CONTAINER = process.env.COSMOS_VECTOR_CONTAINER || "cards";

// ── Tuning ───────────────────────────────────────────────────────────────────
const CHUNK = 50; // Embed+Upsert-Einheit (Progress-Granularität)
const BULK_BATCH = 25; // ≤100 (Cosmos-bulk-Limit); kleiner = weniger 429-Burst
const MAX_ATTEMPTS = 10;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force"); // ignoriert vorhandene ids → re-embed alle

// ── 429/Backoff-Helfer (aus cosmos-vector.ts) ────────────────────────────────
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function backoffMs(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 30_000) + Math.floor(Math.random() * 250);
}
/** Throttling erkennen — auch wenn nur die Fehlermeldung „429/request rate" trägt. */
function isThrottle(e: unknown): boolean {
  const code =
    (e as { code?: number; statusCode?: number })?.code ??
    (e as { statusCode?: number })?.statusCode;
  if (code === 429 || code === 503) return true;
  const msg = (e as Error)?.message || "";
  return /429|request rate is too large|too large|throttl/i.test(msg);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BulkOp = any;
type BulkResult = { statusCode: number };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = Record<string, any>;

let _container: Container | null = null;
function container(): Container {
  if (_container) return _container;
  const endpoint = process.env.COSMOS_ENDPOINT;
  const key = process.env.COSMOS_KEY;
  if (!endpoint || !key) throw new Error("COSMOS_ENDPOINT / COSMOS_KEY not set");
  _container = new CosmosClient({
    endpoint,
    key,
    // SDK-eigenes 429-Handling: absorbiert Throttling je Operation, bevor die
    // App-Retry-Schleife greift (zweite Schicht). Wichtig bei Vektor-Upserts.
    connectionPolicy: {
      retryOptions: { maxRetryAttemptCount: 9, maxWaitTimeInSeconds: 60 },
    },
  })
    .database(VEC_DB)
    .container(VEC_CONTAINER);
  return _container;
}

/**
 * Führt Bulk-Ops aus und retryt gedrosselte Ops (429/449/503) mit Backoff — 1:1
 * aus cosmos-vector.ts `bulkWithRetry`. Ganz-Request-429 (auch nur in der
 * Message) → gesamten Batch nach Backoff erneut senden.
 */
async function bulkWithRetry(label: string, ops: BulkOp[]): Promise<void> {
  let pending = ops;
  for (let attempt = 0; pending.length > 0; attempt++) {
    if (attempt >= MAX_ATTEMPTS) {
      throw new Error(
        `[backfill] ${label}: ${pending.length} Op(s) nach ${MAX_ATTEMPTS} Versuchen weiter gedrosselt`
      );
    }
    if (attempt > 0) await sleep(backoffMs(attempt));
    let res: BulkResult[];
    try {
      res = (await container().items.bulk(pending, {
        continueOnError: true,
      })) as unknown as BulkResult[];
    } catch (e) {
      if (isThrottle(e)) continue; // Request-Ebenen-429 → ganzen Batch neu
      throw e;
    }
    const retryIdx: number[] = [];
    const fatal: BulkResult[] = [];
    res.forEach((r, i) => {
      if (r.statusCode < 400) return;
      if (r.statusCode === 429 || r.statusCode === 449 || r.statusCode === 503)
        retryIdx.push(i);
      else fatal.push(r);
    });
    if (fatal.length > 0) {
      throw new Error(
        `[backfill] ${label}: ${fatal.length} Op(s) endgültig fehlgeschlagen (erste ${fatal[0].statusCode})`
      );
    }
    pending = retryIdx.map((i) => pending[i]);
  }
}

/** Zählt Docs im Ziel-Namespace (Single-Partition-Count). */
async function cosmosCount(): Promise<number> {
  const { resources } = await container()
    .items.query<number>({
      query: "SELECT VALUE COUNT(1) FROM c WHERE c.namespace = @ns",
      parameters: [{ name: "@ns", value: NAMESPACE }],
    })
    .fetchAll();
  return resources?.[0] ?? 0;
}

/** Alle bereits vorhandenen ids im Namespace (DIFF-AWARE: skip → billige Re-Runs). */
async function existingIds(): Promise<Set<string>> {
  const { resources } = await container()
    .items.query<{ id: string }>({
      query: "SELECT c.id FROM c WHERE c.namespace = @ns",
      parameters: [{ name: "@ns", value: NAMESPACE }],
    })
    .fetchAll();
  return new Set((resources || []).map((r) => r.id));
}

// ── Export-Record → flaches Cosmos-Doc ───────────────────────────────────────
type ExportRecord = { id: string; metadata: Record<string, unknown> };

/**
 * Doc-Shape (flach): ALLE Metadatenfelder (inkl. chunk_text) unverändert
 * übernehmen, dann id/namespace/embedding aufsetzen. Reihenfolge: `...metadata`
 * zuerst, damit id/namespace/embedding sicher gewinnen (metadata trägt keinen
 * dieser Schlüssel — geprüft am Export).
 */
function buildDoc(record: ExportRecord, embedding: number[]): Doc {
  return {
    ...record.metadata,
    id: record.id,
    namespace: NAMESPACE,
    embedding,
  };
}

/** Bulk-Upsert einer Doc-Liste, in BULK_BATCH-Häppchen, mit 429-Retry. */
async function upsertDocs(docs: Doc[]): Promise<void> {
  for (let i = 0; i < docs.length; i += BULK_BATCH) {
    const batch = docs.slice(i, i + BULK_BATCH);
    // partitionKey explizit (= namespace) — Cosmos adressiert Items über
    // (id, partitionKey); alle Docs teilen die eine Partition "cards_v3".
    const ops = batch.map((resourceBody) => ({
      operationType: "Upsert" as const,
      resourceBody,
      partitionKey: NAMESPACE,
    }));
    await bulkWithRetry("upsert", ops);
  }
}

async function main() {
  // Export laden + Grundvertrag prüfen.
  const raw = readFileSync(EXPORT_PATH, "utf8");
  const parsed = JSON.parse(raw) as {
    namespace?: string;
    count?: number;
    records?: ExportRecord[];
  };
  const records = parsed.records ?? [];
  if (parsed.namespace && parsed.namespace !== NAMESPACE) {
    throw new Error(
      `[backfill] Export-namespace '${parsed.namespace}' != erwartet '${NAMESPACE}'`
    );
  }
  if (records.length !== EXPECTED) {
    throw new Error(
      `[backfill] Export enthält ${records.length} Records, erwartet ${EXPECTED}`
    );
  }
  console.log(
    `[backfill] Export: ${records.length} Karten (namespace=${NAMESPACE}) → ${VEC_DB}/${VEC_CONTAINER}${
      dryRun ? " [DRY-RUN]" : ""
    }`
  );

  // Guard: chunk_text muss überall vorhanden sein (sonst Null-Vektor-Falle).
  const noText = records.filter(
    (r) => !r.metadata || typeof r.metadata.chunk_text !== "string" || (r.metadata.chunk_text as string).trim() === ""
  );
  if (noText.length > 0) {
    throw new Error(
      `[backfill] ${noText.length} Record(s) ohne chunk_text (erste id: ${noText[0]?.id}) — Embedding wäre ein Null-Vektor`
    );
  }

  if (dryRun) {
    console.log(
      `[backfill] DRY-RUN: würde ${records.length} Karten embedden+upserten (kein Gemini-Call, kein Cosmos-Write). Fertig.`
    );
    return;
  }

  // DIFF-AWARE: bereits vorhandene ids überspringen (außer --force).
  const existing = force ? new Set<string>() : await existingIds();
  if (existing.size > 0) {
    console.log(`[backfill] bereits in Cosmos: ${existing.size} — werden übersprungen (--force zum Neu-Embedden)`);
  }

  let processed = 0;
  let written = 0;
  for (let i = 0; i < records.length; i += CHUNK) {
    const slice = records.slice(i, i + CHUNK);
    const todo = slice.filter((r) => !existing.has(r.id));
    processed += slice.length;

    if (todo.length === 0) {
      console.log(`[backfill] Σ ${processed}/${records.length} (0 neu in diesem Block)`);
      continue;
    }

    // Embed (ordnungserhaltend) → Docs bauen → validieren → Upsert.
    const texts = todo.map((r) => String(r.metadata.chunk_text));
    const vectors = await embedBatch(texts);
    const docs = todo.map((r, j) => {
      const v = vectors[j];
      if (!Array.isArray(v) || v.length !== DIM) {
        throw new Error(
          `[backfill] Embedding für '${r.id}' hat Länge ${Array.isArray(v) ? v.length : "?"}, erwartet ${DIM}`
        );
      }
      return buildDoc(r, v);
    });
    await upsertDocs(docs);
    written += docs.length;
    console.log(
      `[backfill] +${docs.length} upserted (Σ neu ${written}) — Σ ${processed}/${records.length}`
    );
  }

  // Count-Verify: harte Bedingung — Cosmos-COUNT(namespace) == 418.
  const cc = await cosmosCount();
  const ok = cc === EXPECTED;
  console.log(`[backfill] COUNT-VERIFY: Cosmos ${cc} == erwartet ${EXPECTED} → ${ok ? "OK" : "DRIFT"}`);
  if (!ok) {
    throw new Error(`[backfill] Count-Drift: Cosmos ${cc} != ${EXPECTED}`);
  }
  console.log(`[backfill] fertig — ${written} neu geschrieben, ${cc} Karten im Container.`);
}

main().catch((e) => {
  console.error("backfill FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
