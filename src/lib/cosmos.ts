import "server-only";

import { Container, CosmosClient, SqlParameter } from "@azure/cosmos";

/**
 * Cosmos-DB-Zugriff (ersetzt Firestore). Flache Container:
 *   users    (pk /id)        — Profil inkl. language + linkedin-Integration
 *   sessions (pk /id)        — Session-Metadaten (uid, updatedAt)
 *   runs     (pk /sessionId) — Analyse-Runs
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

export function usersContainer(): Container {
  return getDb().container("users");
}

export function sessionsContainer(): Container {
  return getDb().container("sessions");
}

export function runsContainer(): Container {
  return getDb().container("runs");
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
