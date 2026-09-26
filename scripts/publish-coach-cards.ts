/**
 * Freigabeprozess für Coaching-Karten (E-4, Owner-GO 25.09.2026).
 *
 *   npm run cards:publish -- --all                      # alle im Namespace → published
 *   npm run cards:publish -- --group CARD-AC-X,CARD-AC-Y # Gruppen (de+en) → published
 *   npm run cards:publish -- --ids CARD-AC-X-de          # einzelne ids
 *   … --status draft      # zurückziehen
 *   … --write-export      # Status auch im Export-JSON (data/cards_v3_export.json) setzen
 *   … --dry-run
 *
 * Seit E-4 liefert das Retrieval (cosmos-cards.ts) NUR Karten mit status
 * 'published'. Neue Karten kommen per Backfill als 'draft' in die DB, sind über
 * /api/rag-smoke?draft=1 prüfbar und werden mit diesem Skript freigegeben.
 * Patch statt Upsert: das Embedding bleibt unangetastet (kein Gemini-Call).
 */
import { CosmosClient } from "@azure/cosmos";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: ".env.local" });

const VEC_DB = process.env.COSMOS_VECTOR_DATABASE || "coach-vec";
const VEC_CONTAINER = process.env.COSMOS_VECTOR_CONTAINER || "cards";
const NAMESPACE = "cards_v3";
const EXPORT_PATH = resolve(process.cwd(), "data/cards_v3_export.json");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(name);

async function main() {
  const endpoint = process.env.COSMOS_ENDPOINT;
  const key = process.env.COSMOS_KEY;
  if (!endpoint || !key) throw new Error("COSMOS_ENDPOINT / COSMOS_KEY fehlen");
  const status = arg("--status") ?? "published";
  if (status !== "published" && status !== "draft") throw new Error("--status published|draft");
  const dryRun = flag("--dry-run");
  const writeExport = flag("--write-export");
  const all = flag("--all");
  const groups = (arg("--group") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ids = (arg("--ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!all && groups.length === 0 && ids.length === 0) {
    throw new Error("Auswahl fehlt: --all | --group <g1,g2> | --ids <id1,id2>");
  }

  const container = new CosmosClient({ endpoint, key }).database(VEC_DB).container(VEC_CONTAINER);

  // Ziel-Docs (nur id + status + group) laden.
  let query = "SELECT c.id, c.status, c.card_group_id FROM c WHERE c.namespace = @ns";
  const parameters: Array<{ name: string; value: unknown }> = [{ name: "@ns", value: NAMESPACE }];
  if (!all) {
    const parts: string[] = [];
    if (groups.length) { parts.push("ARRAY_CONTAINS(@groups, c.card_group_id)"); parameters.push({ name: "@groups", value: groups }); }
    if (ids.length) { parts.push("ARRAY_CONTAINS(@ids, c.id)"); parameters.push({ name: "@ids", value: ids }); }
    query += ` AND (${parts.join(" OR ")})`;
  }
  const { resources } = await container.items
    .query<{ id: string; status?: string; card_group_id?: string }>({ query, parameters: parameters as never })
    .fetchAll();
  const docs = resources ?? [];
  const todo = docs.filter((d) => d.status !== status);
  console.log(`[publish] Auswahl: ${docs.length} Karte(n), davon ${todo.length} → '${status}'${dryRun ? " [DRY-RUN]" : ""}`);
  if (!all && groups.length) {
    const seen = new Set(docs.map((d) => d.card_group_id));
    const missing = groups.filter((g) => !seen.has(g));
    if (missing.length) console.warn(`[publish] WARN: Gruppen ohne Treffer in Cosmos: ${missing.join(", ")}`);
  }

  const today = new Date().toISOString().slice(0, 10);
  if (!dryRun) {
    let n = 0;
    for (const d of todo) {
      await container.item(d.id, NAMESPACE).patch([
        { op: "set", path: "/status", value: status },
        { op: "set", path: "/updated_at", value: today },
      ]);
      n++;
      if (n % 50 === 0) console.log(`[publish] … ${n}/${todo.length}`);
    }
    console.log(`[publish] ${n} Karte(n) gepatcht.`);
  }

  if (writeExport) {
    const parsed = JSON.parse(readFileSync(EXPORT_PATH, "utf8")) as {
      records: Array<{ id: string; metadata: Record<string, unknown> }>;
    };
    const targetIds = new Set(docs.map((d) => d.id));
    let changed = 0;
    for (const r of parsed.records) {
      if (!targetIds.has(r.id)) continue;
      if (r.metadata.status !== status) {
        r.metadata.status = status;
        r.metadata.updated_at = today;
        changed++;
      }
    }
    if (!dryRun && changed > 0) writeFileSync(EXPORT_PATH, JSON.stringify(parsed, null, 2) + "\n", "utf8");
    console.log(`[publish] Export-JSON: ${changed} Record(s) ${dryRun ? "würden" : ""} auf '${status}' gesetzt.`);
  }

  // Bestand ausweisen.
  const { resources: counts } = await container.items
    .query<{ status: string; n: number }>({
      query: "SELECT c.status, COUNT(1) AS n FROM c WHERE c.namespace = @ns GROUP BY c.status",
      parameters: [{ name: "@ns", value: NAMESPACE }],
    })
    .fetchAll();
  console.log(`[publish] Bestand: ${(counts ?? []).map((c) => `${c.status ?? "∅"}=${c.n}`).join(", ")}`);
}

main().catch((e) => {
  console.error("publish FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
