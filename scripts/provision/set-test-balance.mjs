// TEST-Helper: setzt den Saldo eines TEST-Workspaces auf einen Zielwert, indem
// es die creditBatch-Restmengen so anpasst, dass ihre Summe == target ist
// (erster aktiver Batch trägt den Rest, übrige auf 0) und den Schnell-Saldo am
// Workspace nachzieht. NUR für lokale Test-Workspaces gedacht (M4-Paywall-Test).
//   node scripts/provision/set-test-balance.mjs <workspaceId> <target>
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";

function loadEnv() {
  try {
    const t = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
    for (const l of t.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {}
}
loadEnv();

const ws = process.argv[2];
const target = Number(process.argv[3]);
if (!ws || !Number.isInteger(target) || target < 0) {
  console.error("Usage: node set-test-balance.mjs <workspaceId> <target>=>0");
  process.exit(1);
}

const c = new CosmosClient({ endpoint: process.env.COSMOS_ENDPOINT, key: process.env.COSMOS_KEY });
const cont = c.database(process.env.COSMOS_DATABASE ?? "coach").container("workspaces");

const now = new Date();
const { resources: docs } = await cont.items
  .query({ query: "SELECT * FROM c WHERE c.workspaceId=@w", parameters: [{ name: "@w", value: ws }] })
  .fetchAll();

const workspace = docs.find((d) => d.type === "workspace");
if (!workspace) { console.error("workspace not found"); process.exit(1); }
// Aktive Batches (nicht verfallen), nach Verfall sortiert
const batches = docs
  .filter((d) => d.type === "creditBatch" && new Date(d.expiresAt) > now)
  .sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt));

if (batches.length === 0) { console.error("no active batches to adjust"); process.exit(1); }

// Verteilung: erster Batch trägt target, alle übrigen 0.
let remaining = target;
for (let i = 0; i < batches.length; i++) {
  const give = i === 0 ? target : 0;
  batches[i].amount = give;
  await cont.item(batches[i].id, ws).replace(batches[i]);
  remaining -= give;
}
workspace.balance = target;
workspace.updatedAt = now.toISOString();
await cont.item(workspace.id, ws).replace(workspace);

console.log(`OK: workspace ${ws} balance -> ${target} (batch[0]=${target}, others=0)`);
