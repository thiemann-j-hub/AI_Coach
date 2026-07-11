/**
 * CHATBOT (Teil C) — legt die Cosmos-Vektor-Infra für die Wissensbasis des
 * PulseNorth-Chatbots idempotent an. 1:1 dasselbe empirisch gehärtete Muster
 * wie provision-coach-vectors.ts (eigene DB ohne Shared-Throughput → dedizierter
 * Container-Durchsatz; Vektor-Index braucht dediziert).
 *
 * DB `chatbot-vec`, Container `kb`:
 *   - pk `/namespace`  (Themen-Namespaces: company, coach, jobmap, studio,
 *     pricing-meta, legal — pro Thema eine Partition)
 *   - VectorEmbeddingPolicy `/embedding` float32 768 cosine
 *   - Index diskANN (Fallback quantizedFlat); `/embedding` + `/chunk_text` aus
 *     der Standard-Indizierung ausgeschlossen (RU sparen)
 * Doc-Shape (flach): { id, namespace, embedding:number[768], chunk_text,
 *   title, source, lang, url, section, ... }
 *
 * Zusätzlich Container `chat_events` (KEIN Vektor) für Observability/§C.7:
 *   pk `/day` (Tages-Partition), TTL 90 Tage (DSGVO-Retention).
 *
 * INERT: legt nur DB+Container an, schreibt keine Daten. Idempotent.
 * Lauf (aus C:\dev\AI_Coach):
 *   COSMOS_ENDPOINT=… COSMOS_KEY=… node scripts/provision-chatbot-vec.mjs
 */
import {
  CosmosClient,
  VectorEmbeddingDataType,
  VectorEmbeddingDistanceFunction,
} from "@azure/cosmos";

const VEC_DB = process.env.CHATBOT_VECTOR_DATABASE || "chatbot-vec";
const KB_CONTAINER = process.env.CHATBOT_KB_CONTAINER || "kb";
const EVENTS_CONTAINER = process.env.CHATBOT_EVENTS_CONTAINER || "chat_events";
const DIM = 768;

function kbDef(vectorIndexType) {
  return {
    id: KB_CONTAINER,
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
      vectorIndexes: [{ path: "/embedding", type: vectorIndexType }],
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
    connectionPolicy: {
      retryOptions: { maxRetryAttemptCount: 9, maxWaitTimeInSeconds: 60 },
    },
  });

  // Eigene DB OHNE Shared-Throughput (Voraussetzung für vektor-indizierte Container)
  const { database } = await client.databases.createIfNotExists({ id: VEC_DB });
  console.log(`  ✓ DB ${VEC_DB} bereit (dediziert, kein Shared-Throughput)`);

  // KB-Container (Vektor)
  let created;
  try {
    created = await database.containers.createIfNotExists(kbDef("diskANN"), { offerThroughput: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`  ⚠ diskANN fehlgeschlagen (${msg.slice(0, 120)}) → Fallback quantizedFlat`);
    created = await database.containers.createIfNotExists(kbDef("quantizedFlat"), { offerThroughput: 400 });
  }
  const res = created.resource;
  const vidx = res?.indexingPolicy?.vectorIndexes?.[0]?.type;
  const vemb = res?.vectorEmbeddingPolicy?.vectorEmbeddings?.[0];
  console.log(
    `  ✓ ${VEC_DB}/${KB_CONTAINER}: pk=/namespace, vectorIndex=${vidx}, dim=${vemb?.dimensions}, dist=${vemb?.distanceFunction} (status ${created.statusCode})`
  );

  // chat_events-Container (kein Vektor) — Observability/§C.7, TTL 90 Tage
  const ev = await database.containers.createIfNotExists({
    id: EVENTS_CONTAINER,
    partitionKey: { paths: ["/day"] },
    defaultTtl: 60 * 60 * 24 * 90,
  });
  console.log(`  ✓ ${VEC_DB}/${EVENTS_CONTAINER}: pk=/day, ttl=90d (status ${ev.statusCode})`);

  console.log("provision-chatbot-vec: fertig (idempotent). Autoscale-Migration via az (siehe Runbook).");
}

main().catch((e) => {
  console.error("provision FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
