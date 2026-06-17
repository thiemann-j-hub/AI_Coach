/**
 * EINMALIGES Migrations-/Reconcile-Skript: Coach-Ledger -> zentraler CreditService.
 *
 * NICHT AUTOMATISCH AUSFUEHREN. Standard ist DRY-RUN (nur Plan ausgeben).
 * Erst mit `--apply` schreibt es wirklich — und auch dann erst auf gemeinsames Signal.
 *
 * Was es tut (Spec):
 *   Liest aus der Coach-Cosmos (DB `coach`) alle Workspaces + reale Salden (aus
 *   creditBatch-Docs berechnet, nicht aus dem ggf. driftenden balance-Cache) +
 *   Mitglieder und schreibt in die CreditService-Cosmos (DB `pulsecraft`, gleiches
 *   Konto pulsecraft-prod-cosmos):
 *     (1) TEAM-Workspace (members > 1): Saldo unter der team-id (= lokale
 *         workspaceId) + je Mitglied ein workspace-map-Doc (workspaceId = team-id).
 *     (2) SOLO-Workspace (members == 1): Saldo unter der OID des Owners +
 *         Mapping (workspaceId = oid).
 *
 * sub -> oid: Coach speichert als uid den OIDC `sub` (pairwise). Der CreditService
 * schluesselt auf die stabile Entra-`oid`. Die oid wird seit der Auth-Aenderung
 * beim Login als users.entraOid persistiert; dieses Skript liest sie von dort.
 *
 * UNAUFGELOESTE Mitglieder (kein entraOid) — die oid wird NICHT mehr vorab
 * gebraucht: fuer TEAM-Mitglieder ohne bekannte oid schreibt das Skript ein
 * E-Mail-PENDING-Doc; der CreditService claimt es beim ersten Login selbst auf
 * die oid (legt oid->team-id an, entwertet das Pending). SOLO-Nutzer brauchen
 * kein Pending (sie bekommen beim Login ohnehin workspaceId=oid) -> nur melden.
 * Mitglieder ohne oid UND ohne E-Mail sind echt unresolved -> nur melden.
 *
 * ====================================================================
 * VERBINDLICHE CreditService-Cosmos-Shapes (vom Owner bestaetigt, 2026-06-17):
 *   DB `pulsecraft` @ pulsecraft-prod-cosmos.
 *   - credit-ledger (PK /workspaceId):
 *       balance-Doc:     { id: "balance-<wsId>", workspaceId, type:"balance", credits:int }
 *                        (id MUSS "balance-"+wsId sein; Feld heisst "credits")
 *       seed-tx-Doc:     { id: "tx-migrate-<wsId>", workspaceId, type:"transaction",
 *                          direction:"credit", amount:int, balanceBefore:0,
 *                          balanceAfter:int, createdAt, ttl:-1, kind:"migration", source:"coach" }
 *       -> beide je Partition in EINEM TransactionalBatch (spiegelt addCredits);
 *          deterministische ids => Create-409 = bereits migriert = idempotenter Re-Run.
 *   - workspace-map (PK /userId):
 *       Mapping: { id:"<oid>", userId:"<oid>", workspaceId, tid:"<tid|null>", createdAt }
 *                (Solo: workspaceId=oid; Team: ein Doc je Mitglied, workspaceId=team-id)
 *       Pending: { id:"pending:<emailLower>", userId:"pending:<emailLower>",
 *                  type:"pending", email:"<emailLower>", workspaceId:"<teamId>", createdAt }
 *                (Team-Mitglied ohne bekannte oid -> Auto-Claim beim ersten Login)
 * ====================================================================
 */

import { CosmosClient } from "@azure/cosmos";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv(); // .env als Fallback

const APPLY = process.argv.includes("--apply");

// --- Coach-Quelle (DB coach) ---------------------------------------------
const COACH_ENDPOINT = process.env.COSMOS_ENDPOINT;
const COACH_KEY = process.env.COSMOS_KEY;
const COACH_DB = process.env.COSMOS_DATABASE ?? "coach";

// --- CreditService-Ziel (DB pulsecraft, GLEICHES Konto -> Coach-Creds als Fallback) ---
const CS_ENDPOINT = process.env.CREDIT_SERVICE_COSMOS_ENDPOINT ?? COACH_ENDPOINT;
const CS_KEY = process.env.CREDIT_SERVICE_COSMOS_KEY ?? COACH_KEY;
const CS_DB = process.env.CREDIT_SERVICE_COSMOS_DATABASE ?? "pulsecraft";
const CS_LEDGER = process.env.CREDIT_LEDGER_CONTAINER ?? "credit-ledger";
const CS_MAP = process.env.WORKSPACE_MAP_CONTAINER ?? "workspace-map";

function die(msg) {
  console.error(`\n[FEHLER] ${msg}\n`);
  process.exit(1);
}

if (!COACH_ENDPOINT || !COACH_KEY) die("COSMOS_ENDPOINT / COSMOS_KEY (Coach) fehlen.");

const coach = new CosmosClient({ endpoint: COACH_ENDPOINT, key: COACH_KEY }).database(COACH_DB);
const cs =
  CS_ENDPOINT && CS_KEY
    ? new CosmosClient({ endpoint: CS_ENDPOINT, key: CS_KEY }).database(CS_DB)
    : null;

const nowIso = new Date().toISOString();

/** Realer Saldo eines Workspaces = Summe gueltiger Batch-Restmengen (wie getAvailableCredits). */
async function realBalance(workspaceId) {
  const { resources } = await coach
    .container("workspaces")
    .items.query(
      {
        query:
          "SELECT VALUE c.amount FROM c WHERE c.workspaceId = @ws AND c.type = 'creditBatch' AND c.amount > 0 AND c.expiresAt > @now",
        parameters: [
          { name: "@ws", value: workspaceId },
          { name: "@now", value: nowIso },
        ],
      },
      { partitionKey: workspaceId }
    )
    .fetchAll();
  return resources.reduce((sum, a) => sum + (a > 0 ? a : 0), 0);
}

/** uid (= sub) -> Entra-oid ueber das users-Doc (entraOid); null wenn unbekannt. */
async function resolveOid(uid) {
  try {
    const { resource } = await coach.container("users").item(uid, uid).read();
    return resource?.entraOid ?? null;
  } catch (e) {
    if (e?.code === 404) return null;
    throw e;
  }
}

/**
 * Saldo-Doc + Seed-Transaktion je Workspace als EIN TransactionalBatch (PK = workspaceId).
 * Deterministische ids -> Create-409 = bereits migriert (idempotenter Re-Run).
 * Gibt "written" | "exists" | "dry" zurueck.
 */
async function writeLedgerBalance(workspaceId, credits) {
  if (!APPLY || !cs) return "dry";
  const balanceDoc = {
    id: `balance-${workspaceId}`,
    workspaceId,
    type: "balance",
    credits,
  };
  const seedTx = {
    id: `tx-migrate-${workspaceId}`,
    workspaceId,
    type: "transaction",
    direction: "credit",
    amount: credits,
    balanceBefore: 0,
    balanceAfter: credits,
    createdAt: nowIso,
    ttl: -1,
    kind: "migration",
    source: "coach",
  };
  try {
    await cs.container(CS_LEDGER).items.batch(
      [
        { operationType: "Create", resourceBody: balanceDoc },
        { operationType: "Create", resourceBody: seedTx },
      ],
      workspaceId
    );
    return "written";
  } catch (e) {
    // 409 (eines der Create-Docs existiert) -> bereits migriert, idempotent.
    if (e?.code === 409 || e?.statusCode === 409) return "exists";
    throw e;
  }
}

/** workspace-map-Doc je Mitglied (PK /userId). Idempotent via upsert (deterministische id=oid). */
async function writeWorkspaceMap(oid, workspaceId, tid = null) {
  if (!APPLY || !cs) return "dry";
  await cs.container(CS_MAP).items.upsert({
    id: oid,
    userId: oid,
    workspaceId,
    tid: tid ?? null,
    createdAt: nowIso,
  });
  return "written";
}

/**
 * Pending-Auto-Claim-Doc fuer ein TEAM-Mitglied ohne bekannte oid (Container
 * workspace-map, PK /userId). Der CreditService claimt es beim ersten Login auf
 * die oid (legt oid->team-id an, entwertet das Pending). E-Mail lowercase.
 */
async function writePendingInvite(emailLower, teamId) {
  if (!APPLY || !cs) return "dry";
  await cs.container(CS_MAP).items.upsert({
    id: `pending:${emailLower}`,
    userId: `pending:${emailLower}`,
    type: "pending",
    email: emailLower,
    workspaceId: teamId,
    createdAt: nowIso,
  });
  return "written";
}

async function main() {
  console.log(`\n=== Coach -> CreditService Reconcile (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  console.log(`Coach-DB: ${COACH_DB} | CreditService-DB: ${CS_DB} (ledger=${CS_LEDGER} pk /workspaceId, map=${CS_MAP} pk /userId)\n`);

  const { resources: workspaces } = await coach
    .container("workspaces")
    .items.query("SELECT * FROM c WHERE c.type = 'workspace'")
    .fetchAll();

  const unresolved = []; // { workspaceId, uid, email }
  let teams = 0;
  let solos = 0;
  let ledgerWrites = 0;
  let ledgerExists = 0;
  let mapWrites = 0;
  let pendingWrites = 0;

  for (const ws of workspaces) {
    const members = Array.isArray(ws.members) ? ws.members : [];
    const credits = await realBalance(ws.workspaceId);
    const isTeam = members.length > 1;

    if (isTeam) {
      teams++;
      const teamId = ws.workspaceId; // team-id = lokale workspaceId (Spec)
      console.log(`TEAM  ${teamId}  credits=${credits}  members=${members.length}`);
      const r = await writeLedgerBalance(teamId, credits);
      if (r === "written") ledgerWrites++;
      else if (r === "exists") ledgerExists++;
      for (const m of members) {
        const oid = await resolveOid(m.uid);
        if (oid) {
          console.log(`   - member ${m.uid} -> oid ${oid}  => map {id:${oid}, userId:${oid}, workspaceId:${teamId}}`);
          const mr = await writeWorkspaceMap(oid, teamId);
          if (mr === "written") mapWrites++;
          continue;
        }
        const email = (m.email ?? "").trim().toLowerCase();
        if (email) {
          console.log(`   - member ${m.uid} (${email}) -> keine oid => pending {id:pending:${email}, workspaceId:${teamId}}`);
          const pr = await writePendingInvite(email, teamId);
          if (pr === "written") pendingWrites++;
          continue;
        }
        unresolved.push({ workspaceId: teamId, uid: m.uid, email: m.email });
        console.log(`   - member ${m.uid} -> WEDER oid NOCH E-Mail (echt unresolved, skip)`);
      }
    } else {
      solos++;
      const owner = members[0];
      if (!owner) {
        console.log(`SOLO  ${ws.workspaceId}  credits=${credits}  -> KEIN Mitglied, uebersprungen`);
        continue;
      }
      const oid = await resolveOid(owner.uid);
      if (!oid) {
        unresolved.push({ workspaceId: ws.workspaceId, uid: owner.uid, email: owner.email });
        console.log(`SOLO  ${ws.workspaceId}  credits=${credits}  owner ${owner.uid} -> OID UNRESOLVED (skip)`);
        continue;
      }
      console.log(`SOLO  ${ws.workspaceId}  credits=${credits}  owner -> oid ${oid}  => ledger+map unter ${oid}`);
      const r = await writeLedgerBalance(oid, credits); // Solo-Saldo unter der OID (Spec)
      if (r === "written") ledgerWrites++;
      else if (r === "exists") ledgerExists++;
      const mr = await writeWorkspaceMap(oid, oid);
      if (mr === "written") mapWrites++;
    }
  }

  console.log(`\n--- Zusammenfassung ---`);
  console.log(`Workspaces: ${workspaces.length} (Teams: ${teams}, Solo: ${solos})`);
  console.log(`Ledger: ${ledgerWrites} geschrieben, ${ledgerExists} bereits vorhanden (idempotent) | Map: ${mapWrites} | Pending: ${pendingWrites}`);
  console.log(`Echt unaufgeloest (Team-Mitglied ohne oid UND ohne E-Mail, NICHT geschrieben): ${unresolved.length}`);
  for (const u of unresolved) console.log(`   ! ${u.uid} (${u.email ?? "?"}) in ws ${u.workspaceId}`);

  if (!APPLY) {
    console.log(`\nDRY-RUN — es wurde NICHTS in den CreditService geschrieben. Mit --apply ausfuehren (nur auf gemeinsames Signal).`);
  } else {
    console.log(`\nAPPLY abgeschlossen.`);
  }
}

main().catch((e) => die(e?.stack ?? String(e)));
