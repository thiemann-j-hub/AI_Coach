/**
 * One-off-Backfill: Coach-Bestands-Runs (DB `coach`, Container `runs`) →
 * Radar-measurement-Events (DB `pulsecraft`, Container `radar-events`,
 * pk /workspaceId) + Entsorgung der 3 Fake-Seeds (Wirbelsäule V6 Kap. 6:
 * leeren Graphen mit ECHTEM Kunden-Backfill toeten — keine Fake-Demos).
 *
 * IDEMPOTENT + mehrfach ausfuehrbar: Upsert auf deterministische Doc-ids
 * `coach:${runId}` (Hub-Vertrag: Re-Emit/Backfill zaehlt nie doppelt) und
 * ts IMMER = runDoc.createdAt (Messpunkte springen bei Re-Runs nicht).
 *
 * Aufruf:  npx tsx scripts/backfill-radar-events.ts
 * Env:     .env.local (COSMOS_ENDPOINT/COSMOS_KEY — der Key gilt account-weit
 *          fuer pulsecraft-prod-cosmos, also fuer Coach-DB UND Plattform-DB).
 *          Fehlt der Key: `az cosmosdb keys list -n pulsecraft-prod-cosmos
 *          -g <rg> --query primaryMasterKey` — Key NIE ins Log echoen.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "dotenv";
import { CosmosClient } from "@azure/cosmos";
// Pure Vertrags-/Mapping-Logik — GLEICHE Quelle wie der Live-Emitter
// (radar-emit.ts), damit Backfill und Emit nie divergieren.
import {
  buildCoachMeasurementDoc,
  RADAR_APP_ID,
} from "../src/lib/radar-contract";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: join(here, "..", ".env.local") });

/** Entra-oid des Owners (Jürgen Thiemann) = sein ZENTRALER Workspace
 *  (identisch zum resolve-workspace-Wert des CreditService). */
const OWNER_OID = "00000000-0000-0000-b89a-e62ba1ab6978";

/**
 * Legacy-uid → Entra-oid: Die beiden alten OIDC-`sub`-Werte stammen aus der
 * Zeit VOR der oid-Durchreichung (Entra-`sub` ist pro App-Registrierung
 * verschieden, daher zwei Werte) und gehoeren BEIDE dem Owner. Unbekannte
 * uids werden GESKIPPT — im Radar wird keine Identitaet geraten.
 */
const OWNER_SUB_TO_OID: Record<string, string> = {
  "AAAAAAAAAAAAAAAAAAAAABy7922ENpL66OHr24htU10": OWNER_OID,
  "AAAAAAAAAAAAAAAAAAAAAIZU3-zDZLOl1s0RUY-h4IY": OWNER_OID,
};

/** uid bereits im oid-Format (GUID) → direkt als subjectId verwendbar. */
const OID_FORMAT = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/** Die 3 Fake-Seeds (Demo-Punktzeitreihe), die der echte Backfill ersetzt. */
const FAKE_SEED_RUN_IDS = ["pz-1-baseline", "pz-2-absturz", "pz-3-erholung"] as const;

interface RunRow {
  id?: unknown;
  uid?: unknown;
  createdAt?: unknown;
  ratings?: unknown;
}

interface SeedRow {
  id: string;
  workspaceId: string;
  appId?: string;
  runId?: string;
  type?: string;
}

async function main(): Promise<void> {
  const endpoint = process.env.COSMOS_ENDPOINT;
  const key = process.env.COSMOS_KEY;
  if (!endpoint || !key) {
    console.error(
      "COSMOS_ENDPOINT/COSMOS_KEY fehlen — in .env.local pflegen (Key via az, siehe Kopfkommentar; NIE echoen)."
    );
    process.exit(1);
  }

  const client = new CosmosClient({ endpoint, key });
  const runs = client
    .database(process.env.COSMOS_DATABASE ?? "coach")
    .container("runs");
  const radar = client
    .database(process.env.RADAR_DATABASE ?? "pulsecraft")
    .container("radar-events");

  // ── (1) Alle nicht geloeschten Runs mit competency_ratings ────────────────
  // Nur benoetigte Felder projizieren (kein Transkript-Volltext ueber die Leitung).
  const { resources: rows } = await runs.items
    .query<RunRow>({
      query:
        "SELECT c.id, c.uid, c.createdAt, c.analysisJson.competency_ratings AS ratings FROM c " +
        "WHERE IS_DEFINED(c.analysisJson.competency_ratings) " +
        "AND (NOT IS_DEFINED(c.deleted) OR c.deleted = false)",
    })
    .fetchAll();
  console.log(`Runs mit competency_ratings (nicht geloescht): ${rows.length}`);

  // ── (2)-(4) uid→subjectId mappen, Vertrags-Doc bauen, idempotent upserten ─
  let written = 0;
  let skippedUnknownUid = 0;
  let skippedNoSignal = 0;
  let skippedBadRow = 0;
  const unknownUids = new Map<string, number>();

  for (const r of rows) {
    const uid = typeof r.uid === "string" ? r.uid : "";
    const subjectId =
      OWNER_SUB_TO_OID[uid] ?? (OID_FORMAT.test(uid) ? uid : null);
    if (!subjectId) {
      skippedUnknownUid++;
      unknownUids.set(uid || "(leer)", (unknownUids.get(uid || "(leer)") ?? 0) + 1);
      continue;
    }
    if (typeof r.id !== "string" || !r.id || typeof r.createdAt !== "string" || !r.createdAt) {
      skippedBadRow++;
      console.log(`  SKIP defekte Zeile (id/createdAt fehlt): id=${String(r.id)}`);
      continue;
    }
    const doc = buildCoachMeasurementDoc({
      // (3) Zentraler Workspace des Owners — Bestandsdaten gehoeren in SEINE
      // Mandanten-Partition (resolve-workspace liefert fuer ihn die eigene oid).
      workspaceId: OWNER_OID,
      subjectId,
      runId: r.id,
      // GELOCKT: ts = runDoc.createdAt — NIE Date.now (sonst springt der Punkt).
      createdAt: r.createdAt,
      competencyRatings: r.ratings,
    });
    if (!doc) {
      // Kein beobachtbarer C-Wert (z. B. degradiertes Scoring) → kein Messpunkt.
      skippedNoSignal++;
      continue;
    }
    await radar.items.upsert(doc);
    written++;
  }

  console.log(
    `Upserts: ${written} | Skips: ${skippedUnknownUid} unbekannte uid, ` +
      `${skippedNoSignal} ohne beobachtbaren Wert, ${skippedBadRow} defekte Zeilen`
  );
  for (const [u, n] of unknownUids) {
    console.log(`  SKIP uid ${u} (${n} Run(s)) — keine oid-Zuordnung bekannt`);
  }

  // ── (5) Fake-Seeds entsorgen: ERST lesen (exakte id/pk ermitteln), DANN loeschen
  const { resources: seeds } = await radar.items
    .query<SeedRow>({
      query:
        "SELECT c.id, c.workspaceId, c.appId, c.runId, c.type FROM c WHERE " +
        "c.runId IN (@r1, @r2, @r3) OR c.id IN (@i1, @i2, @i3)",
      parameters: [
        { name: "@r1", value: FAKE_SEED_RUN_IDS[0] },
        { name: "@r2", value: FAKE_SEED_RUN_IDS[1] },
        { name: "@r3", value: FAKE_SEED_RUN_IDS[2] },
        { name: "@i1", value: `${RADAR_APP_ID}:${FAKE_SEED_RUN_IDS[0]}` },
        { name: "@i2", value: `${RADAR_APP_ID}:${FAKE_SEED_RUN_IDS[1]}` },
        { name: "@i3", value: `${RADAR_APP_ID}:${FAKE_SEED_RUN_IDS[2]}` },
      ],
    })
    .fetchAll();
  if (!seeds.length) {
    console.log("Fake-Seeds: keine (mehr) vorhanden — nichts zu loeschen.");
  }
  for (const s of seeds) {
    try {
      await radar.item(s.id, s.workspaceId).delete();
      console.log(
        `Fake-Seed GELOESCHT: id=${s.id} appId=${s.appId ?? "?"} ` +
          `runId=${s.runId ?? "?"} workspaceId=${s.workspaceId}`
      );
    } catch (e) {
      if ((e as { code?: number })?.code === 404) {
        console.log(`Fake-Seed bereits weg (404): id=${s.id}`);
        continue;
      }
      throw e;
    }
  }

  // ── (6) Read-back: Messpunkte des Owners im zentralen Workspace ───────────
  const { resources: counts } = await radar.items
    .query<number>({
      query:
        "SELECT VALUE COUNT(1) FROM c WHERE c.workspaceId = @w AND c.subjectId = @s " +
        "AND c.type = 'measurement'",
      parameters: [
        { name: "@w", value: OWNER_OID },
        { name: "@s", value: OWNER_OID },
      ],
    })
    .fetchAll();
  console.log(
    `Read-back: ${counts[0] ?? 0} measurement-Event(s) fuer ` +
      `(workspaceId=Owner, subjectId=Owner) in radar-events.`
  );
}

main().catch((e) => {
  // Cosmos-Fehlermeldungen enthalten keinen Key — Message ist safe zu loggen.
  console.error("Backfill fehlgeschlagen:", e instanceof Error ? e.message : e);
  process.exit(1);
});
