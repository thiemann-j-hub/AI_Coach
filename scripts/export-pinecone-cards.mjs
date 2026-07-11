/**
 * W5-1 EXPORT-FIRST (Pinecone-Ablösung) — sichert den EINZIGEN Coach-Karten-Korpus.
 *
 * Die 418 Karten existieren NUR im Pinecone-Index script-coach-cards / cards_v3
 * (kein Dataset/Seed im Repo). Dieser Export ist die einzige Korpus-Kopie und die
 * Quelle für den Re-Embed-Backfill nach Cosmos (Pinecone-Vektoren sind e5-large-
 * 1024 aus Integrated Embedding → unbrauchbar; wir re-embedden chunk_text mit
 * gemini-768). Wir speichern chunk_text + alle Metadaten, NICHT die Vektoren.
 *
 * Lauf: PINECONE_API_KEY=… PINECONE_INDEX_HOST=… PINECONE_NAMESPACE=cards_v3 \
 *       node scripts/export-pinecone-cards.mjs
 * Output: data/cards_v3_export.json  (ins Repo committen!)
 */
import { writeFileSync } from "node:fs";

const HOST = process.env.PINECONE_INDEX_HOST;
const NS = process.env.PINECONE_NAMESPACE || "cards_v3";
const KEY = process.env.PINECONE_API_KEY;
if (!HOST || !KEY) { console.error("PINECONE_INDEX_HOST/API_KEY fehlen"); process.exit(1); }
const H = { "Api-Key": KEY, "X-Pinecone-Api-Version": "2025-10", Accept: "application/json" };

async function listAllIds() {
  const ids = [];
  let next = null;
  do {
    const u = new URL(`https://${HOST}/vectors/list`);
    u.searchParams.set("namespace", NS);
    u.searchParams.set("limit", "100");
    if (next) u.searchParams.set("paginationToken", next);
    const r = await fetch(u, { headers: H });
    if (!r.ok) throw new Error(`list ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const j = await r.json();
    for (const v of j.vectors || []) ids.push(v.id);
    next = j.pagination?.next || null;
  } while (next);
  return ids;
}

async function fetchBatch(ids) {
  const u = new URL(`https://${HOST}/vectors/fetch`);
  u.searchParams.set("namespace", NS);
  for (const id of ids) u.searchParams.append("ids", id);
  const r = await fetch(u, { headers: H });
  if (!r.ok) throw new Error(`fetch ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  return Object.values(j.vectors || {}).map((v) => ({ id: v.id, metadata: v.metadata }));
}

async function pool(items, size, worker) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size);
    out.push(...(await Promise.all(slice.map(worker))));
  }
  return out.flat();
}

const ids = await listAllIds();
console.log(`Gelistet: ${ids.length} IDs`);

// Batches à 40 IDs, 5 Batches parallel
const batches = [];
for (let i = 0; i < ids.length; i += 40) batches.push(ids.slice(i, i + 40));
const records = await pool(batches, 5, fetchBatch);

// Verify: jeder Record hat chunk_text
const missing = records.filter((r) => !r.metadata?.chunk_text);
console.log(`Exportiert: ${records.length} Records, ohne chunk_text: ${missing.length}`);
if (records.length !== ids.length) throw new Error(`Drift: ${records.length} != ${ids.length}`);
if (missing.length > 0) throw new Error(`${missing.length} Records ohne chunk_text`);

// deterministisch sortiert für stabile Diffs
records.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync("data/cards_v3_export.json", JSON.stringify({ namespace: NS, count: records.length, records }, null, 2));
console.log(`✓ data/cards_v3_export.json geschrieben (${records.length} Karten). Metadaten-Felder: ${Object.keys(records[0].metadata).length}`);
