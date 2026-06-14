// Provisioniert die Payment-Container im bestehenden Cosmos (additiv, leer).
// Nutzung:  node scripts/provision/payment-cosmos.mjs
// Liest COSMOS_ENDPOINT/COSMOS_KEY/COSMOS_DATABASE aus .env.local (oder ENV).
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";

function loadEnvLocal() {
  try {
    const txt = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    /* ENV kommt dann aus dem Prozess */
  }
}
loadEnvLocal();

const endpoint = process.env.COSMOS_ENDPOINT;
const key = process.env.COSMOS_KEY;
const dbId = process.env.COSMOS_DATABASE ?? "coach";
if (!endpoint || !key) {
  console.error("COSMOS_ENDPOINT / COSMOS_KEY fehlen.");
  process.exit(1);
}

const CONTAINERS = [
  { id: "workspaces", partitionKey: "/workspaceId" },
  { id: "domains", partitionKey: "/domain" },
  { id: "invoices", partitionKey: "/year" },
];

const client = new CosmosClient({ endpoint, key });
const { database } = await client.databases.createIfNotExists({ id: dbId });

for (const c of CONTAINERS) {
  const { container, statusCode } = await database.containers.createIfNotExists({
    id: c.id,
    partitionKey: { paths: [c.partitionKey], kind: "Hash" },
  });
  // 201 = neu erstellt, 200 = existierte bereits
  console.log(`${statusCode === 201 ? "CREATED " : "EXISTS  "} ${container.id}  (pk ${c.partitionKey})`);
}
console.log("Fertig.");
