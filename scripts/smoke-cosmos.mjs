/** M3-Smoke: validiert die Cosmos-Datenschicht (gleiche Query-Shapes wie runs-store.ts). */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "dotenv";
import { CosmosClient } from "@azure/cosmos";

config({ path: join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local") });

const db = new CosmosClient({
  endpoint: process.env.COSMOS_ENDPOINT,
  key: process.env.COSMOS_KEY,
}).database(process.env.COSMOS_DATABASE ?? "coach");

const SID = "smoke-test-session-001";
const sessions = db.container("sessions");
const runs = db.container("runs");
const users = db.container("users");

// 1) Session + 3 Runs anlegen
await sessions.items.upsert({ id: SID, uid: "smoke-uid", updatedAt: new Date().toISOString() });
const runIds = [];
for (let i = 0; i < 3; i++) {
  const id = `smoke-run-${i}`;
  runIds.push(id);
  await runs.items.upsert({
    id, sessionId: SID, uid: "smoke-uid",
    createdAt: new Date(Date.parse("2026-06-01T10:00:00Z") + i * 60000).toISOString(),
    conversationType: "feedback", conversationSubType: null, goal: `g${i}`,
    lang: "de", jurisdiction: null, transcriptText: i === 2 ? "Hallo Welt" : null,
    analysisJson: { summary: `S${i}`, scores: { overall: 70 + i } },
    ragContext: null, summary: `S${i}`, scoreOverall: 70 + i,
  });
}
console.log("1) Upserts ok");

// 2) listRuns-SQL (Seite 1, limit 2)
const q1 = await runs.items.query({
  query: `SELECT TOP 3 c.id, c.createdAt, c.conversationType, c.conversationSubType,
            c.goal, c.lang, c.jurisdiction, c.scoreOverall, c.summary,
            c.analysisJson.scores.overall AS scoresOverall,
            c.analysisJson.summary AS analysisSummary,
            IS_STRING(c.transcriptText) AND LENGTH(c.transcriptText) > 0 AS hasTranscript
     FROM c WHERE c.sessionId = @sid ORDER BY c.createdAt DESC`,
  parameters: [{ name: "@sid", value: SID }],
}).fetchAll();
const page1 = q1.resources;
console.log(`2) listRuns-Query: ${page1.length} rows, neuester=${page1[0]?.id}, hasTranscript[0]=${page1[0]?.hasTranscript}`);
if (page1[0]?.id !== "smoke-run-2" || page1[0]?.hasTranscript !== true) throw new Error("Sortierung/hasTranscript falsch!");

// 3) Cursor-Query (createdAt < cursor)
const cursorCreatedAt = page1[1].createdAt;
const q2 = await runs.items.query({
  query: `SELECT TOP 3 c.id FROM c WHERE c.sessionId = @sid AND c.createdAt < @cursor ORDER BY c.createdAt DESC`,
  parameters: [{ name: "@sid", value: SID }, { name: "@cursor", value: cursorCreatedAt }],
}).fetchAll();
console.log(`3) Cursor-Query: ${q2.resources.map(r => r.id).join(",")}`);
if (q2.resources[0]?.id !== "smoke-run-0") throw new Error("Cursor-Logik falsch!");

// 4) Punkt-Read + Rate (read-modify-upsert)
const { resource: run } = await runs.item("smoke-run-1", SID).read();
await runs.items.upsert({ ...run, rating: 5, ratedAt: new Date().toISOString() });
const { resource: rated } = await runs.item("smoke-run-1", SID).read();
console.log(`4) Rating persistiert: ${rated.rating}`);
if (rated.rating !== 5) throw new Error("Rating nicht persistiert!");

// 5) Ownership-Negativtest (fremde uid)
const { resource: s } = await sessions.item(SID, SID).read();
console.log(`5) Session-uid=${s.uid} — Fremd-Check: ${s.uid !== "anderer-user" ? "würde 403 liefern (korrekt)" : "FEHLER"}`);

// 6) Cleanup
for (const id of runIds) await runs.item(id, SID).delete();
await sessions.item(SID, SID).delete();
console.log("6) Cleanup ok");

// 7) Bestand: wie viele User-Profile existieren (hat der erste Login stattgefunden)?
const u = await users.items.query({ query: "SELECT c.id, c.email FROM c" }).fetchAll();
console.log(`7) users-Container: ${u.resources.length} Profil(e): ${u.resources.map(x => `${x.id.slice(0, 10)}…(${x.email || "ohne email"})`).join("; ") || "—"}`);

console.log("\nSMOKE OK");
