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
  // ── Debrief 2.0 (D1/D2/D3) ────────────────────────────────────────────────
  /** Wievielter Versuch dieses Szenarios für diesen User (1-basiert). */
  attempt?: number;
  /** Fokus-Vorsatz aus dem letzten Debrief (Fokus-Retry). */
  focus?: string | null;
  /** Deterministische Gesamtwertung (computeDebrief) — beim Finish persistiert. */
  debriefJson?: unknown | null;
  /** Vergleich zum Vorversuch (computeDelta) — beim Finish persistiert. */
  deltaJson?: unknown | null;
  /**
   * Time-out-Coach (D3): kurze Coach-Wechsel WÄHREND der Simulation.
   * Bewusst getrennt von `turns` — die Persona »hört« den Time-out nicht,
   * und die Auswertung bewertet nur das eigentliche Gespräch.
   */
  coachNotes?: Array<{ question: string; answer: string; ts: string }>;
}

/** Maximal erlaubte Time-outs je Simulation (Kosten- und Didaktik-Kappe). */
export const SIM_MAX_TIMEOUTS = 3;

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
  attempt?: number;
  focus?: string | null;
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
    attempt: args.attempt ?? 1,
    focus: args.focus ?? null,
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
  /** Versuchs-Nummer (1-basiert); Altbestand ohne Feld → 1. */
  attempt: number;
  /** Gesamtscore 0–100 aus dem gespeicherten Debrief; null = keiner. */
  overall: number | null;
  verdict: "passed" | "failed" | "unrated" | null;
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
    attempt?: number;
    debriefJson?: { overall?: number | null; verdict?: string } | null;
  }>(
    runsContainer(),
    // Partitions-lokale Query (sessionId = PK) — kein Cross-Partition-Fanout.
    "SELECT c.id, c.scenarioId, c.status, c.createdAt, c.updatedAt, c.turns, c.attempt, c.debriefJson FROM c WHERE c.sessionId = @pk AND c.docType = @dt ORDER BY c.createdAt DESC OFFSET 0 LIMIT @limit",
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
    attempt: typeof r.attempt === "number" && r.attempt >= 1 ? r.attempt : 1,
    overall:
      typeof r.debriefJson?.overall === "number" ? r.debriefJson.overall : null,
    verdict:
      r.debriefJson?.verdict === "passed" ||
      r.debriefJson?.verdict === "failed" ||
      r.debriefJson?.verdict === "unrated"
        ? r.debriefJson.verdict
        : null,
  }));
}

/**
 * Jüngster ABGESCHLOSSENER Versuch desselben Szenarios (für Versuchszählung
 * und Delta-Vergleich). Partitions-lokal, billig.
 */
export async function latestFinishedForScenario(
  uid: string,
  scenarioId: string,
  excludeSimId?: string
): Promise<SimulationDoc | null> {
  const rows = await queryItems<SimulationDoc>(
    runsContainer(),
    "SELECT TOP 1 * FROM c WHERE c.sessionId = @pk AND c.docType = @dt AND c.scenarioId = @sc AND c.status = @st AND c.id != @ex ORDER BY c.createdAt DESC",
    [
      { name: "@pk", value: simPartitionKey(uid) },
      { name: "@dt", value: SIM_DOC_TYPE },
      { name: "@sc", value: scenarioId },
      { name: "@st", value: "finished" },
      { name: "@ex", value: excludeSimId ?? "" },
    ]
  );
  return rows[0] ?? null;
}

/** Anzahl abgeschlossener Versuche eines Szenarios (für attempt = n+1). */
export async function countFinishedForScenario(
  uid: string,
  scenarioId: string
): Promise<number> {
  const rows = await queryItems<{ n: number }>(
    runsContainer(),
    "SELECT VALUE COUNT(1) FROM c WHERE c.sessionId = @pk AND c.docType = @dt AND c.scenarioId = @sc AND c.status = @st",
    [
      { name: "@pk", value: simPartitionKey(uid) },
      { name: "@dt", value: SIM_DOC_TYPE },
      { name: "@sc", value: scenarioId },
      { name: "@st", value: "finished" },
    ]
  );
  const n = rows[0] as unknown;
  return typeof n === "number" ? n : 0;
}
