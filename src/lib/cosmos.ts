import "server-only";

import { Container, CosmosClient, SqlParameter } from "@azure/cosmos";

/**
 * Cosmos-DB-Zugriff (ersetzt Firestore). Flache Container:
 *   users      (pk /id)          — Profil inkl. language + linkedin-Integration
 *   sessions   (pk /id)          — Session-Metadaten (uid, updatedAt)
 *   runs       (pk /sessionId)   — Analyse-Runs
 *   usage      (pk /id)          — Tages-Token-Budget (cost-cap)
 *   workspaces (pk /workspaceId) — Credit-System (workspace/creditBatch/ledger/stripeEvent/invoice)
 *   domains    (pk /domain)      — Free-Run-Gate pro verifizierter B2B-Domain
 *
 * Zugriff ausschließlich serverseitig (Key aus Key Vault) — die früheren
 * firestore.rules entfallen ersatzlos.
 */

let client: CosmosClient | null = null;

function getClient(): CosmosClient {
  if (!client) {
    const endpoint = process.env.COSMOS_ENDPOINT;
    const key = process.env.COSMOS_KEY;
    if (!endpoint || !key) {
      throw new Error("COSMOS_ENDPOINT / COSMOS_KEY sind nicht gesetzt.");
    }
    client = new CosmosClient({ endpoint, key });
  }
  return client;
}

function getDb() {
  return getClient().database(process.env.COSMOS_DATABASE ?? "coach");
}

/**
 * Radar-Längsschnitt-Store liegt in der ZENTRALEN DB `pulsecraft` (NICHT `coach`),
 * geteilt mit dem Hub — selbes Cosmos-Konto, daher keine neuen Credentials.
 */
function getRadarDb() {
  return getClient().database(process.env.RADAR_DATABASE ?? "pulsecraft");
}

export function usersContainer(): Container {
  return getDb().container("users");
}

export function sessionsContainer(): Container {
  return getDb().container("sessions");
}

export function runsContainer(): Container {
  return getDb().container("runs");
}

export function usageContainer(): Container {
  return getDb().container("usage");
}

/**
 * Credit-/Workspace-Container (pk /workspaceId) im Single-Container-Design:
 * Doc-Typen workspace | creditBatch | ledger | stripeEvent | invoice teilen
 * dieselbe Partition und werden via TransactionalBatch atomar mutiert.
 */
export function workspacesContainer(): Container {
  return getDb().container("workspaces");
}

/** Free-Run-Gate pro verifizierter B2B-Domain (pk /domain). */
export function domainsContainer(): Container {
  return getDb().container("domains");
}

/**
 * Server-seitiger Entra-Token-Store fuer den zentralen CreditService (pk /oid,
 * Doc-ID = Entra-oid). Haelt das delegierte Access-/Refresh-Token je Nutzer
 * dauerhaft gueltig (Rotation). SENSIBEL → ausschliesslich serverseitig; kein
 * Client-RU-Key. Siehe entra-token-store.ts / Blueprint CREDIT-TOKEN-STORE.
 */
export function creditTokensContainer(): Container {
  return getDb().container("credit_tokens");
}

/**
 * Append-Only-Längsschnitt-Signal-Ledger (Radar) in der ZENTRALEN DB `pulsecraft`
 * (pk /workspaceId), geteilt mit dem Hub. Coach schreibt nach jeder Analyse ein
 * `type:"measurement"`-Signal (doc-id `coach:<runId>` = idempotent). Siehe radar-emit.ts.
 */
export function radarEventsContainer(): Container {
  return getRadarDb().container("radar-events");
}

/**
 * Rechnungen + globaler Nummernzaehler (pk /year). Counter-Doc und Invoice-Docs
 * teilen die Jahres-Partition -> Nummern-Allokation und Invoice-Write laufen in
 * EINEM TransactionalBatch => atomar und GAPLOS (kein Cross-Container-Risiko).
 */
export function invoicesContainer(): Container {
  return getDb().container("invoices");
}

/** Punkt-Lesen; 404 → null. */
export async function readItem<T>(
  container: Container,
  id: string,
  partitionKey: string
): Promise<T | null> {
  try {
    const { resource } = await container.item(id, partitionKey).read<T & { id: string }>();
    return (resource as T) ?? null;
  } catch (err: any) {
    if (err?.code === 404) return null;
    throw err;
  }
}

/** Upsert (Cosmos-Äquivalent zu Firestore set/merge auf Dokumentebene). */
export async function upsertItem<T extends { id: string }>(
  container: Container,
  item: T
): Promise<T> {
  const { resource } = await container.items.upsert<T>(item);
  return (resource as unknown as T) ?? item;
}

/** Parametrisierte SQL-Query. */
export async function queryItems<T>(
  container: Container,
  query: string,
  parameters: SqlParameter[] = []
): Promise<T[]> {
  const { resources } = await container.items
    .query<T>({ query, parameters })
    .fetchAll();
  return resources;
}

export async function deleteItem(
  container: Container,
  id: string,
  partitionKey: string
): Promise<void> {
  try {
    await container.item(id, partitionKey).delete();
  } catch (err: any) {
    if (err?.code === 404) return;
    throw err;
  }
}
