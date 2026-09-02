import "server-only";

import { deleteItem, queryItems, readItem, runsContainer, upsertItem } from "@/lib/cosmos";
import { deleteCoachMeasurement } from "@/lib/server/radar-emit";
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
  /**
   * `aborted` (COACH-UX-BLUEPRINT §2.4): nur via POST /api/simulation/abort,
   * nur aus `active`, kein Credit/LLM/Radar. Wird aus allen Listen gefiltert —
   * die Historie bleibt sauber (kein Karteileichen-Eintrag).
   */
  status: "active" | "finished" | "aborted";
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
  /**
   * Coaching-Check-in (Welle A1, Synthesia-Vergleich §7): Selbsteinschätzung
   * des Übenden NACH dem Gespräch, VOR der Auswertung. Optional (Überspringen
   * ist erste Bürgerin) — fließt als Pflichtsektion belegt ins Debrief ein.
   */
  selfAssessment?: string | null;
  /** Deterministische Gesamtwertung (computeDebrief) — beim Finish persistiert. */
  debriefJson?: unknown | null;
  /** Vergleich zum Vorversuch (computeDelta) — beim Finish persistiert. */
  deltaJson?: unknown | null;
  /** P2: deterministische Grounding-Notizen des Finish-Laufs (additiv). */
  qualityNotes?: unknown[];
  /**
   * Time-out-Coach (D3): kurze Coach-Wechsel WÄHREND der Simulation.
   * Bewusst getrennt von `turns` — die Persona »hört« den Time-out nicht,
   * und die Auswertung bewertet nur das eigentliche Gespräch.
   */
  coachNotes?: Array<{ question: string; answer: string; ts: string }>;
  // ── Synthesia-Angleich (Owner-Vorgabe 04.08.) ─────────────────────────────
  /** Gewählte Gesprächssprache (Persona spricht diese Sprache); fehlt bei Alt-Docs → Szenario-Locale. */
  convoLocale?: "de" | "en" | "es" | "fr";
  // ── Welle B (Synthesia-Vergleich §7) ──────────────────────────────────────
  /** B2: Übungs- (Default) oder Prüfungsmodus; fehlt bei Alt-Docs → practice. */
  mode?: "practice" | "check";
  /** B2: Härtegrad der Persona; fehlt bei Alt-Docs → standard. */
  hardness?: "mild" | "standard" | "hart";
  /** Zeit-Regie: der beiläufige »muss gleich los«-Hinweis wurde bereits gegeben. */
  timeWarned?: boolean;
  /** Zeit-Regie: die Persona hat sich verabschiedet — keine weiteren Turns möglich. */
  closedByTime?: boolean;
}

/** Ab diesem Anteil der Szenario-Zeitbox streut die Persona den Zeit-Hinweis ein. */
export const SIM_TIME_WARN_FRACTION = 0.8;

/** Maximal erlaubte Time-outs je Simulation (Kosten- und Didaktik-Kappe). */
export const SIM_MAX_TIMEOUTS = 3;

export function simPartitionKey(uid: string): string {
  return `sim:${uid}`;
}

/**
 * Abort-Entscheidung (§2.4, pure + getestet): idempotent aus `aborted`,
 * Konflikt aus `finished` (die Auswertung ist bezahlt — sie bleibt),
 * Übergang nur aus `active`.
 */
export function abortDecision(
  status: SimulationDoc["status"]
): "already" | "conflict" | "abort" {
  if (status === "aborted") return "already";
  if (status === "finished") return "conflict";
  return "abort";
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
  convoLocale?: "de" | "en" | "es" | "fr";
  mode?: "practice" | "check";
  hardness?: "mild" | "standard" | "hart";
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
    ...(args.convoLocale ? { convoLocale: args.convoLocale } : {}),
    ...(args.mode && args.mode !== "practice" ? { mode: args.mode } : {}),
    ...(args.hardness && args.hardness !== "standard" ? { hardness: args.hardness } : {}),
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

/**
 * Endgültiges Löschen einer Simulation (Owner-Vorgabe 04.08.: Mülleimer in
 * der Liste, inkl. Datenbank). Ownership-Check wie beim Lesen — fremde oder
 * unbekannte Docs melden false (Route antwortet 404, löscht nie blind).
 */
export async function deleteSimulation(
  uid: string,
  simId: string,
  opts?: { oid?: string | null }
): Promise<boolean> {
  const doc = await getSimulation(uid, simId);
  if (!doc) return false;
  // CP-3.1 (M8, Compliance-Blueprint 31.08.): Löschen räumt auf — der bei
  // SIMULATION_RADAR_EMIT=on emittierte Radar-Messpunkt (runId = simId, samt
  // Belegzitaten) wird MIT dem Rollenspiel gelöscht. Spiegelt exakt das
  // Muster aus account-delete.ts; fail-soft, damit das Löschen des
  // Rollenspiels nie am Messpunkt scheitert. Der Analyse-Pfad
  // (runs/delete) macht das seit jeher richtig — hier fehlte die Zeile.
  await deleteCoachMeasurement(simId, [doc.workspaceId, opts?.oid]).catch(
    () => ({ deleted: 0 })
  );
  await deleteItem(runsContainer(), simId, simPartitionKey(uid));
  return true;
}

export interface SimulationListItem {
  id: string;
  scenarioId: string;
  status: "active" | "finished";
  // `aborted` taucht hier nie auf — die List-Query filtert es (§2.4).
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
    // `aborted` wird ausgefiltert (§2.4): abgebrochene Läufe sind keine Historie.
    "SELECT c.id, c.scenarioId, c.status, c.createdAt, c.updatedAt, c.turns, c.attempt, c.debriefJson FROM c WHERE c.sessionId = @pk AND c.docType = @dt AND c.status != 'aborted' ORDER BY c.createdAt DESC OFFSET 0 LIMIT @limit",
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

/**
 * Jüngste ABGESCHLOSSENE Simulation (szenario-unabhängig) — Datenquelle der
 * Einstiegs-Empfehlung (COACH-UX-BLUEPRINT §3/W1-4). Partitions-lokal, billig.
 */
export async function latestFinishedAny(
  uid: string
): Promise<{ finishedAt: string; competencyRatings: unknown } | null> {
  const rows = await queryItems<{
    finishedAt?: string;
    createdAt: string;
    competencyRatings?: unknown;
  }>(
    runsContainer(),
    "SELECT TOP 1 c.finishedAt, c.createdAt, c.competencyRatings FROM c WHERE c.sessionId = @pk AND c.docType = @dt AND c.status = @st ORDER BY c.createdAt DESC",
    [
      { name: "@pk", value: simPartitionKey(uid) },
      { name: "@dt", value: SIM_DOC_TYPE },
      { name: "@st", value: "finished" },
    ]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    finishedAt: r.finishedAt ?? r.createdAt,
    competencyRatings: r.competencyRatings ?? null,
  };
}
