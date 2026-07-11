/**
 * VECTOR-QUOTA (Coach) — legt die Cosmos-Vektor-Infra für Coachs Karten
 * idempotent an. Vorbild: ai-elearning-studio/scripts/vector-migrate/
 * provision-cosmos-vectors.ts (dieselben empirisch gehärteten Muster).
 *
 * ── Empirische Korrekturen (aus der Studio-Migration übernommen): ─────────────
 * 1. Cosmos lehnt Vektor-INDIZES auf Shared-Throughput ab ("The Vector Indexing
 *    is not supported for shared throughput offer"). Ein DB-weiter Shared-
 *    Throughput schließt vektor-indizierte Container aus. Lösung: eigene DB
 *    **`coach-vec`** OHNE Shared-Throughput (createIfNotExists ohne throughput-
 *    Arg → dediziert) → der Container trägt dedizierten Durchsatz.
 * 2. Der SDK-`create` setzt auf einer frischen DB **manual** Durchsatz (min 400);
 *    Autoscale (`maxThroughput`) greift beim Create nicht durch. Darum: Container
 *    mit `offerThroughput: 400` anlegen, DANN einmalig auf Autoscale migrieren:
 *      az cosmosdb sql container throughput migrate -g pulsecraft-prod-rg \
 *        -a pulsecraft-prod-cosmos -d coach-vec -n cards -t autoscale
 *      az cosmosdb sql container throughput update -g pulsecraft-prod-rg \
 *        -a pulsecraft-prod-cosmos -d coach-vec -n cards --max-throughput 1000
 *    (Autoscale max 1000 / idle 100 RU/s ≈ €8/Mo — weit unter AI Search Basic
 *     €75/Mo). Re-Runs dieses Skripts lassen bestehenden Durchsatz unberührt
 *     (createIfNotExists = no-op).
 *
 * Vektor-Policy: `/embedding`, float32, 768, **cosine** → Score = Cosine-
 * Similarity (1.0 = identisch). Index: **diskANN**, Fallback `quantizedFlat`.
 * `/embedding` + `/chunk_text` aus der Standard-Indizierung ausgeschlossen (RU).
 *
 * Container-Doc-Shape (flach): { id, namespace:"cards_v3", embedding:number[768],
 * chunk_text, …25 Metadatenfelder }. Partition: EIN Namespace-Wert "cards_v3"
 * (alle 418 Karten, triviale Partition).
 *
 * INERT: legt nur DB+Container an, schreibt keine Daten, ändert keinen Router.
 * Idempotent. Lauf:
 *   COSMOS_ENDPOINT=… COSMOS_KEY=… npx tsx scripts/provision-coach-vectors.ts
 */
import {
  CosmosClient,
  type ContainerRequest,
  VectorEmbeddingDataType,
  VectorEmbeddingDistanceFunction,
} from "@azure/cosmos";

const VEC_DB = process.env.COSMOS_VECTOR_DATABASE || "coach-vec";
const CONTAINER = process.env.COSMOS_VECTOR_CONTAINER || "cards";
const DIM = 768;

function containerDef(vectorIndexType: "diskANN" | "quantizedFlat"): ContainerRequest {
  return {
    id: CONTAINER,
    partitionKey: { paths: ["/namespace"] },
    vectorEmbeddingPolicy: {
      vectorEmbeddings: [
        {
          path: "/embedding",
          dataType: VectorEmbeddingDataType.Float32,
          dimensions: DIM,
          distanceFunction: VectorEmbeddingDistanceFunction.Cosine,
        },
      ],
    },
    indexingPolicy: {
      indexingMode: "consistent",
      automatic: true,
      includedPaths: [{ path: "/*" }],
      excludedPaths: [{ path: "/embedding/*" }, { path: "/chunk_text/*" }, { path: '/"_etag"/?' }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vectorIndexes: [{ path: "/embedding", type: vectorIndexType }] as any,
    },
  };
}

async function main() {
  const endpoint = process.env.COSMOS_ENDPOINT;
  const key = process.env.COSMOS_KEY;
  if (!endpoint || !key) throw new Error("COSMOS_ENDPOINT/COSMOS_KEY not set");

  const client = new CosmosClient({
    endpoint,
    key,
    // SDK-eigenes 429-Handling (wie im Adapter): absorbiert Throttling je
    // Operation, bevor App-Retry greift. Wichtig bei RU-schweren Vektor-Ops.
    connectionPolicy: {
      retryOptions: { maxRetryAttemptCount: 9, maxWaitTimeInSeconds: 60 },
    },
  });

  // Eigene DB OHNE Shared-Throughput (Voraussetzung für vektor-indizierte
  // Container): kein throughput-Arg → die DB ist dediziert.
  const { database } = await client.databases.createIfNotExists({ id: VEC_DB });
  console.log(`  ✓ DB ${VEC_DB} bereit (dediziert, kein Shared-Throughput)`);

  let created;
  try {
    created = await database.containers.createIfNotExists(containerDef("diskANN"), { offerThroughput: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`  ⚠ diskANN fehlgeschlagen (${msg.slice(0, 120)}) → Fallback quantizedFlat`);
    created = await database.containers.createIfNotExists(containerDef("quantizedFlat"), { offerThroughput: 400 });
  }
  const res = created.resource;
  const vidx = (res?.indexingPolicy as { vectorIndexes?: Array<{ type: string }> })?.vectorIndexes?.[0]?.type;
  const vemb = (res?.vectorEmbeddingPolicy as { vectorEmbeddings?: Array<{ dimensions: number; distanceFunction: string }> })?.vectorEmbeddings?.[0];
  console.log(
    `  ✓ ${VEC_DB}/${CONTAINER}: pk=/namespace, vectorIndex=${vidx}, dim=${vemb?.dimensions}, dist=${vemb?.distanceFunction} (status ${created.statusCode})`
  );
  console.log("provision-coach-vectors: fertig (idempotent). Autoscale-Migration siehe Kopf-Kommentar.");
}

main().catch((e) => {
  console.error("provision FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
