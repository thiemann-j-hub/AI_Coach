// Einmaliger Radar-Backfill: emittiert je historischem Run EIN idempotentes
// `measurement`-Signal in den zentralen Radar-Store (radar-events, DB pulsecraft).
//
// HARTE REGELN: ts = c.createdAt (HISTORISCH, nie Date.now); type:"measurement";
// subjectId = users.entraOid (uid->oid, IDENTISCH zur Live-Emit-Quelle authResult.oid);
// doc-id = `coach:<runId>` (idempotent). Runs ohne workspaceId / ohne auflösbare oid /
// ohne Signal werden ÜBERSPRUNGEN + gezählt.
//
// Dry-Run-Default (nur zählen). Schreiben erst mit --apply.
//   node scripts/backfill-radar.mjs            # Dry-Run
//   node scripts/backfill-radar.mjs --apply    # schreibt
//
// Creds: process.env (COSMOS_ENDPOINT/KEY, COSMOS_DATABASE=coach, RADAR_DATABASE=pulsecraft),
// Fallback: .env.local.
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";

const APPLY = process.argv.includes("--apply");
const KEYS = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"];

function loadEnv() {
  const e = { ...process.env };
  try {
    for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const i = line.indexOf("=");
      const k = line.slice(0, i).trim();
      if (e[k] === undefined || e[k] === "") e[k] = line.slice(i + 1).trim();
    }
  } catch { /* .env.local optional */ }
  return e;
}

function buildMetrics(ratings, scoreOverall) {
  const m = Object.fromEntries(KEYS.map((k) => [k, null]));
  for (const r of ratings ?? []) {
    if (r?.id && KEYS.includes(r.id)) {
      m[r.id] = typeof r.score === "number" && Number.isFinite(r.score) ? r.score : null;
    }
  }
  const present = KEYS.map((k) => m[k]).filter((v) => typeof v === "number");
  const mean = present.length ? Math.round((present.reduce((a, b) => a + b, 0) / present.length) * 10) / 10 : null;
  m.overall = typeof scoreOverall === "number" && scoreOverall >= 1 && scoreOverall <= 4 ? scoreOverall : mean;
  return m;
}

const env = loadEnv();
if (!env.COSMOS_ENDPOINT || !env.COSMOS_KEY) {
  console.error("COSMOS_ENDPOINT/COSMOS_KEY fehlen (env oder .env.local).");
  process.exit(1);
}
const client = new CosmosClient({ endpoint: env.COSMOS_ENDPOINT, key: env.COSMOS_KEY });
const coach = client.database(env.COSMOS_DATABASE ?? "coach");
const radar = client.database(env.RADAR_DATABASE ?? "pulsecraft");
const runs = coach.container("runs");
const users = coach.container("users");
const radarEvents = radar.container("radar-events");

console.log(`Radar-Backfill — Modus: ${APPLY ? "APPLY (schreibt)" : "DRY-RUN (zählt nur)"}`);

// uid -> entraOid (= Live-Emit-subjectId). Nur Users MIT entraOid sind auflösbar.
const { resources: allU } = await users.items.query("SELECT c.id, c.entraOid FROM c").fetchAll();
const uidToOid = new Map(allU.filter((u) => u.entraOid).map((u) => [u.id, u.entraOid]));
console.log(`users: ${allU.length} gesamt, ${uidToOid.size} mit entraOid (auflösbar).`);

const { resources: all } = await runs.items
  .query(
    "SELECT c.id, c.uid, c.workspaceId, c.createdAt, c.scoreOverall, c.analysisJson.competency_ratings AS competency_ratings " +
      "FROM c WHERE (NOT IS_DEFINED(c.deleted) OR c.deleted = false)"
  )
  .fetchAll();

const stat = { runsNonDeleted: all.length, emittable: 0, written: 0, write_errors: 0, skip_noWorkspaceId: 0, skip_noResolvableOid: 0, skip_noCreatedAt: 0, skip_noSignal: 0 };

for (const r of all) {
  if (!r.workspaceId) { stat.skip_noWorkspaceId++; continue; }
  const subjectId = uidToOid.get(r.uid);
  if (!subjectId) { stat.skip_noResolvableOid++; continue; }
  if (!r.createdAt) { stat.skip_noCreatedAt++; continue; }
  const metrics = buildMetrics(r.competency_ratings, r.scoreOverall);
  const hasSignal = KEYS.some((k) => typeof metrics[k] === "number") || typeof metrics.overall === "number";
  if (!hasSignal) { stat.skip_noSignal++; continue; }
  stat.emittable++;

  if (APPLY) {
    const doc = {
      id: `coach:${r.id}`, v: 1, type: "measurement", appId: "coach",
      workspaceId: r.workspaceId, subjectId, metrics, scale: { min: 1, max: 4 },
      ts: r.createdAt, runId: r.id, sourceRunId: r.id, // ts = HISTORISCHES createdAt
    };
    try { await radarEvents.items.upsert(doc); stat.written++; }
    catch (e) { stat.write_errors++; console.error(`  write-fail ${doc.id}: ${e?.code ?? e?.message ?? e}`); }
  }
}

console.log("\n=== ERGEBNIS ===");
console.log(JSON.stringify(stat, null, 2));
if (!APPLY) console.log("\n(Dry-Run — nichts geschrieben. Mit --apply schreiben.)");
