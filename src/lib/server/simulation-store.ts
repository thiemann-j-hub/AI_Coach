import "server-only";

import { queryItems, readItem, runsContainer, upsertItem } from "@/lib/cosmos";
import type { SimulationTurn } from "@/lib/simulation/types";

/**
 * Persistenz der Gesprächssimulation (SIM-2).
 *
 * Kein neuer Container: Simulations-Docs liegen im runs-Container (pk /sessionId)
 * mit Diskriminator docType:"simulation" und dem PK-Trick sessionId = "sim:"+uid —
 * alle Simulationen eines Users teilen eine Partition (Punkt-Reads + billige
 * List-Query), und die bestehenden Runs-Queries filtern nach eigenen ids/Feldern,
 * kollidieren also nicht (additives Schema, house-safe).
 */

export const SIM_DOC_TYPE = "simulation" as const;

/** Harte Kappen — schützen Kosten UND halten das Doc unter Cosmos-Limits. */
export const SIM_MAX_USER_TURNS = 40;
export const SIM_MAX_TURN_CHARS = 1_500;

export interface SimulationDoc {
  id: string; // simId
  sessionId: string; // PK: `sim:${uid}`
  docType: typeof SIM_DOC_TYPE;
  uid: string;
  scenarioId: string;
  createdAt: string;
  updatedAt: string;
  status: "active" | "finished";
  turns: SimulationTurn[];
  feedbackJson?: unknown | null;
  competencyRatings?: unknown | null;
  competencyError?: string | null;
  workspaceId?: string;
  centralSpendTxId?: string | null;
  finishedAt?: string;
}

export function simPartitionKey(uid: string): string {
  return `sim:${uid}`;
}

/** Anzahl der User-Beiträge (Persona-Turns zählen nicht gegen die Kappe). */
export function countUserTurns(turns: SimulationTurn[]): number {
  return turns.filter((t) => t.role === "user").length;
}

/**
 * Transkript-Zusammenbau für Feedback/C1–C10-Scoring (pure, getestet).
 * Der Übende wird neutral gelabelt, die Persona mit Namen — beides wird vom
 * bestehenden Scoring ohnehin zu Führungskraft/Mitarbeiter:in anonymisiert.
 */
export function assembleTranscript(
  turns: SimulationTurn[],
  personaName: string,
  userLabel = "Teilnehmer:in"
): string {
  return turns
    .map((t) => `${t.role === "user" ? userLabel : personaName}: ${t.text}`)
    .join("\n\n");
}

export async function createSimulation(args: {
  simId: string;
  uid: string;
  scenarioId: string;
  openingTurn: SimulationTurn;
}): Promise<SimulationDoc> {
  const now = new Date().toISOString();
  const doc: SimulationDoc = {
    id: args.simId,
    sessionId: simPartitionKey(args.uid),
    docType: SIM_DOC_TYPE,
    uid: args.uid,
    scenarioId: args.scenarioId,
    createdAt: now,
    updatedAt: now,
    status: "active",
    turns: [args.openingTurn],
  };
  await upsertItem(runsContainer(), doc);
  return doc;
}

/** Punkt-Lesen MIT Ownership-Check (uid muss passen, sonst null wie 404). */
export async function getSimulation(
  uid: string,
  simId: string
): Promise<SimulationDoc | null> {
  const doc = await readItem<SimulationDoc>(
    runsContainer(),
    simId,
    simPartitionKey(uid)
  );
  if (!doc || doc.docType !== SIM_DOC_TYPE || doc.uid !== uid) return null;
  return doc;
}

export async function saveSimulation(doc: SimulationDoc): Promise<void> {
  await upsertItem(runsContainer(), { ...doc, updatedAt: new Date().toISOString() });
}

export interface SimulationListItem {
  id: string;
  scenarioId: string;
  status: "active" | "finished";
  createdAt: string;
  updatedAt: string;
  turnCount: number;
}

export async function listSimulations(
  uid: string,
  limit = 10
): Promise<SimulationListItem[]> {
  const rows = await queryItems<{
    id: string;
    scenarioId: string;
    status: "active" | "finished";
    createdAt: string;
    updatedAt: string;
    turns?: unknown[];
  }>(
    runsContainer(),
    // Partitions-lokale Query (sessionId = PK) — kein Cross-Partition-Fanout.
    "SELECT c.id, c.scenarioId, c.status, c.createdAt, c.updatedAt, c.turns FROM c WHERE c.sessionId = @pk AND c.docType = @dt ORDER BY c.createdAt DESC OFFSET 0 LIMIT @limit",
    [
      { name: "@pk", value: simPartitionKey(uid) },
      { name: "@dt", value: SIM_DOC_TYPE },
      { name: "@limit", value: limit },
    ]
  );
  return rows.map((r) => ({
    id: r.id,
    scenarioId: r.scenarioId,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    turnCount: Array.isArray(r.turns) ? r.turns.length : 0,
  }));
}
