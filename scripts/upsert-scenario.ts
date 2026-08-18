// B3a — Concierge-Schnittstelle (Welle B, Synthesia-Vergleich §7):
// Der Betreiber legt ein Kundenszenario als JSON-Datei an; dieses Skript
// validiert es gegen das harte Zod-Schema (scenario-schema.ts) und schreibt
// es in die Workspace-Partition. Ungültige Entwürfe erreichen die DB nie.
//
// Anlegen/Aktualisieren:
//   COSMOS_ENDPOINT=… COSMOS_KEY=… [COSMOS_DATABASE=coach] \
//     WORKSPACE_ID=<ws> npx tsx scripts/upsert-scenario.ts pfad/zum/szenario.json
//
// Löschen:
//   … WORKSPACE_ID=<ws> DELETE_ID=ws-mein-szenario npx tsx scripts/upsert-scenario.ts
//
// Nur validieren (ohne DB):
//   VALIDATE_ONLY=1 npx tsx scripts/upsert-scenario.ts pfad/zum/szenario.json
import { readFileSync } from "fs";
import { CosmosClient } from "@azure/cosmos";
import { validateScenario } from "../src/lib/simulation/scenario-schema";
import { getScenario } from "../src/lib/simulation/scenarios";

const SCENARIO_DOC_TYPE = "sim_scenario";
const pk = (ws: string) => `simscn:${ws}`;

function container() {
  const endpoint = process.env.COSMOS_ENDPOINT;
  const key = process.env.COSMOS_KEY;
  if (!endpoint || !key) throw new Error("COSMOS_ENDPOINT / COSMOS_KEY fehlen");
  return new CosmosClient({ endpoint, key })
    .database(process.env.COSMOS_DATABASE ?? "coach")
    .container("runs");
}

async function main() {
  const workspaceId = process.env.WORKSPACE_ID;
  const deleteId = process.env.DELETE_ID;

  if (deleteId) {
    if (!workspaceId) throw new Error("WORKSPACE_ID fehlt");
    await container().item(deleteId, pk(workspaceId)).delete();
    console.log(`Gelöscht: ${deleteId} (Workspace ${workspaceId})`);
    return;
  }

  const file = process.argv[2];
  if (!file) throw new Error("Aufruf: … upsert-scenario.ts <szenario.json>");
  const scenario = validateScenario(JSON.parse(readFileSync(file, "utf-8")));
  if (getScenario(scenario.id)) {
    throw new Error(`id ${scenario.id} kollidiert mit einem eingebauten Szenario`);
  }
  console.log(`Schema OK: ${scenario.id} — »${scenario.title}«`);
  if (process.env.VALIDATE_ONLY) return;

  if (!workspaceId) throw new Error("WORKSPACE_ID fehlt");
  const now = new Date().toISOString();
  const { resource: existing } = await container()
    .item(scenario.id, pk(workspaceId))
    .read()
    .catch(() => ({ resource: undefined }));
  await container().items.upsert({
    id: scenario.id,
    sessionId: pk(workspaceId),
    docType: SCENARIO_DOC_TYPE,
    workspaceId,
    createdAt: (existing as { createdAt?: string } | undefined)?.createdAt ?? now,
    updatedAt: now,
    scenario,
  });
  console.log(`Gespeichert: ${scenario.id} → Workspace ${workspaceId}`);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
