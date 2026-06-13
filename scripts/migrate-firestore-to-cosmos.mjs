/**
 * Einmalige Daten-Migration: Firestore → Cosmos DB (M3).
 *
 * Migriert users (inkl. integrations/linkedin als eingebettetes Feld),
 * sessions und sessions/{sid}/runs in die Container users/sessions/runs.
 * Firebase-UIDs werden auf Entra-IDs gemappt (--map alt=neu, mehrfach
 * möglich). Idempotent (upserts) — kann gefahrlos wiederholt werden.
 *
 * Aufruf:
 *   node scripts/migrate-firestore-to-cosmos.mjs --dry-run
 *   node scripts/migrate-firestore-to-cosmos.mjs --map <firebaseUid>=<entraUid>
 *
 * Voraussetzungen: .env.local mit COSMOS_*; workspace/firebase-admin-sa.json
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "dotenv";
import admin from "firebase-admin";
import { CosmosClient } from "@azure/cosmos";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env.local") });

// ---- Args ----
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const uidMap = new Map();
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--map" && args[i + 1]?.includes("=")) {
    const [oldUid, newUid] = args[i + 1].split("=");
    uidMap.set(oldUid, newUid);
  }
}

// ---- Firestore ----
const saPath = join(root, "workspace", "firebase-admin-sa.json");
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(readFileSync(saPath, "utf8"))),
});
const fs = admin.firestore();

// ---- Cosmos ----
const cosmos = new CosmosClient({
  endpoint: process.env.COSMOS_ENDPOINT,
  key: process.env.COSMOS_KEY,
});
const db = cosmos.database(process.env.COSMOS_DATABASE ?? "coach");
const usersC = db.container("users");
const sessionsC = db.container("sessions");
const runsC = db.container("runs");

const mapUid = (uid) => (uid && uidMap.has(uid) ? uidMap.get(uid) : uid);
const toIso = (v) =>
  v?.toDate ? v.toDate().toISOString() : typeof v === "string" ? v : null;

async function upsert(container, item, label) {
  if (dryRun) {
    console.log(`  [dry] ${label}: ${item.id}`);
    return;
  }
  await container.items.upsert(item);
  console.log(`  ✓ ${label}: ${item.id}`);
}

// ---- 1) Users (+ integrations/linkedin) ----
console.log("== users ==");
const userDocs = await fs.collection("users").get();
const firestoreUids = new Set();
for (const doc of userDocs.docs) {
  firestoreUids.add(doc.id);
  const data = doc.data();
  const newUid = mapUid(doc.id);
  if (newUid === doc.id && uidMap.size > 0) {
    console.warn(`  ! users/${doc.id}: kein Mapping — übernehme uid unverändert`);
  }

  const linkedinSnap = await fs
    .collection("users").doc(doc.id)
    .collection("integrations").doc("linkedin")
    .get();

  const item = {
    id: newUid,
    email: data.email ?? "",
    displayName: data.displayName ?? "",
    language: data.language ?? null,
    createdAt: data.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    migratedFrom: doc.id,
    ...(linkedinSnap.exists ? { linkedin: linkedinSnap.data() } : {}),
  };
  await upsert(usersC, item, "user");
}

// ---- 2) Sessions + Runs ----
console.log("== sessions + runs ==");
const sessionDocs = await fs.collection("sessions").get();
let runCount = 0;
for (const sDoc of sessionDocs.docs) {
  const sData = sDoc.data();
  if (sData.uid) firestoreUids.add(sData.uid);
  await upsert(
    sessionsC,
    {
      id: sDoc.id,
      uid: mapUid(sData.uid) ?? null,
      updatedAt: toIso(sData.updatedAt) ?? new Date().toISOString(),
      migratedFrom: "firestore",
    },
    "session"
  );

  const runDocs = await fs
    .collection("sessions").doc(sDoc.id)
    .collection("runs").get();
  for (const rDoc of runDocs.docs) {
    const r = rDoc.data();
    runCount++;
    await upsert(
      runsC,
      {
        id: rDoc.id,
        sessionId: sDoc.id,
        uid: mapUid(r.uid) ?? mapUid(sData.uid) ?? null,
        createdAt: toIso(r.createdAt) ?? new Date().toISOString(),
        conversationType: r.conversationType ?? null,
        conversationSubType: r.conversationSubType ?? null,
        goal: r.goal ?? null,
        lang: r.lang ?? null,
        jurisdiction: r.jurisdiction ?? null,
        transcriptText: r.transcriptText ?? null,
        analysisJson: r.analysisJson ?? null,
        ragContext: r.ragContext ?? null,
        summary: r.summary ?? null,
        scoreOverall: r.scoreOverall ?? null,
        ...(typeof r.rating === "number" ? { rating: r.rating } : {}),
        migratedFrom: "firestore",
      },
      "run"
    );
  }
}

console.log(`\nFertig${dryRun ? " (dry-run)" : ""}: ${userDocs.size} users, ${sessionDocs.size} sessions, ${runCount} runs.`);
console.log(`Firestore-UIDs gesehen: ${[...firestoreUids].join(", ") || "—"}`);
if (uidMap.size === 0) {
  console.log("Hinweis: ohne --map werden Firebase-UIDs unverändert übernommen — alte Runs sind dann unter der neuen Entra-Identität NICHT sichtbar.");
}
process.exit(0);
