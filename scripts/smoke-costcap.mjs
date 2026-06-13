/** Smoke: verifiziert die Cosmos-Primitive des Cost-Caps (usage-Container). */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "dotenv";
import { CosmosClient } from "@azure/cosmos";

config({ path: join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local") });
const db = new CosmosClient({ endpoint: process.env.COSMOS_ENDPOINT, key: process.env.COSMOS_KEY })
  .database(process.env.COSMOS_DATABASE ?? "coach");
const c = db.container("usage");
const id = "smoke-uid_2026-06-13";

// Cleanup vorab
try { await c.item(id, id).delete(); } catch {}

// 1) Erster Call: patch incr -> 404 (Doc fehlt) -> create
let used;
try {
  await c.item(id, id).patch([{ op: "incr", path: "/tokensUsed", value: 5000 }]);
  throw new Error("erwartete 404 beim ersten patch");
} catch (e) {
  if (e.code !== 404) throw e;
  await c.items.create({ id, uid: "smoke-uid", date: "2026-06-13", tokensUsed: 5000, updatedAt: new Date().toISOString() });
  used = 5000;
}
console.log(`1) create nach 404: tokensUsed=${used}`);

// 2) Zweiter Call: atomarer incr auf existierendes Doc
const r2 = await c.item(id, id).patch([{ op: "incr", path: "/tokensUsed", value: 3000 }]);
console.log(`2) atomarer incr: tokensUsed=${r2.resource.tokensUsed}`);
if (r2.resource.tokensUsed !== 8000) throw new Error("incr falsch!");

// 3) Limit-Logik (enforce): used > limit?
const limit = 500000;
console.log(`3) used=${r2.resource.tokensUsed} > limit=${limit}? ${r2.resource.tokensUsed > limit} (erwartet false)`);

// 4) Über-Limit simulieren
const r4 = await c.item(id, id).patch([{ op: "incr", path: "/tokensUsed", value: 600000 }]);
console.log(`4) nach Über-Limit-incr: used=${r4.resource.tokensUsed} > ${limit}? ${r4.resource.tokensUsed > limit} (erwartet true -> 429)`);
if (!(r4.resource.tokensUsed > limit)) throw new Error("Limit-Check falsch!");

// Cleanup
await c.item(id, id).delete();
console.log("5) Cleanup ok\n\nSMOKE OK");
