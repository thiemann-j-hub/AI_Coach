import "server-only";

import { deleteItem, queryItems, readItem, replaceItemIfMatch, runsContainer, upsertItem } from "@/lib/cosmos";
import { deleteCoachMeasurement } from "@/lib/server/radar-emit";
import type { SimulationTurn } from "@/lib/simulation/types";
import type { Commitment, TransferCheck } from "@/lib/simulation/transfer";

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
   * `finishing` (Paket 3, C4, 12.11.2026): Die Auswertung ist gestartet und rechnet im Hintergrund. Übergänge:
   * `active` → `finishing` → `finished`; bei einem Fehler zurück nach `active` (mit `finishError`).
   * Ein Lauf in `finishing` nimmt keine Züge mehr an und zählt in keiner Abfrage als abgeschlossen.
   */
  status: "active" | "finishing" | "finished" | "aborted";
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
   * des Übenden NACH dem Gespräch. Optional (Überspringen ist erste Bürgerin).
   * Seit Paket 3 (12.11.2026) aus den zwei Antworten des Check-ins zusammengesetzt (`checkin`); der Abgleich mit
   * der Auswertung steht in `feedbackJson.selfReview`. Alt-Läufe tragen hier ihren Freitext.
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
  coachNotes?: Array<{
    question: string;
    answer: string;
    ts: string;
    /** V3: Merkkarte aus der Coaching-Bibliothek, auf der der Impuls aufbaut. */
    card?: { id: string; title: string; hint: string } | null;
  }>;
  // ── O2 Micro-Transfer (Blueprint COACH-OPTIMIERUNG 27.09.2026) ───────────
  /** Der EINE Schritt fürs echte Gespräch — Vorschlag des Debriefs, ggf. vom Lernenden angepasst. */
  commitment?: Commitment | null;
  /** Rückmeldung beim nächsten Login: probiert / teilweise / nicht / nicht mehr fragen. */
  transferCheck?: TransferCheck | null;
  /** Provenienz: Schreiber-Modell der Auswertung (z. B. googleai/gemini-3.5-flash). */
  modelId?: string;
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
  // ── Welle 2 (Owner-GO 30.10.2026, N4-240) ──────────────────────────────────
  /** Die Rolle hat das Gespräch selbst beendet (Endbedingung erfüllt): Grund, Ergebnis-Art, Zeitpunkt. */
  closedByPersona?: { grund: string; ergebnis: "ziel" | "verabschiedung" | "abbruch"; at: string } | null;
  /** Regie-Beobachter: Öffnungsstufe je Zug (Notizen an die Rolle, Verlauf für den Richter). */
  regie?: Array<{ stufe: number; erfuellt: string[]; eskaliert: boolean; notiz: string; turn: number; ts: string; delivered?: boolean; vorschnell?: boolean; fehlt?: string }>;
  /** Version des Dokuments in Cosmos (kommt beim Lesen mit). Grundlage der Versionsprüfung beim Speichern (C3). */
  _etag?: string;
  /** Live-Modus: Antwortzeiten (Ende der Eingabe-Mitschrift → erstes Audio), ungefähr. */
  liveStats?: { antworten: number; p50Ms: number; p95Ms: number; maxMs: number } | null;
  // ── Paket 2 (12.11.2026): Geldweg und Kennzahlen der Auswertung ────────────
  /**
   * C8: Offene Buchung der Auswertung. Wird VOR der Buchung vermerkt (Kennung, Zeitpunkt), nach der Antwort des
   * Credit-Dienstes um Buchungsnummer und Arbeitsbereich ergänzt und mit dem Speichern der Auswertung oder nach
   * gelungener Rückbuchung ausgetragen. Bleibt er stehen (Prozess-Ende, Frist des Credit-Dienstes, gescheiterte
   * Rückbuchung), listet `scripts/credits-abgleich.mts` den Lauf. Seit Paket 3 gibt der Aufräumer hängender Läufe
   * (GET /api/simulation/status) die Buchung anhand dieses Vermerks zurück.
   */
  openCharge?: { key: string; at: string; txId?: string | null; workspaceId?: string | null; refundFailedAt?: string | null } | null;
  /** C4: Zahl der gelungenen Rückbuchungen an diesem Lauf — Teil der Buchungs-Kennung (`sim-finish:<simId>:<n>`). */
  chargeRefunds?: number;
  /**
   * C7/C17: Kennzahlen der Auswertung — welcher Richter geurteilt hat, Grund eines Rückfalls auf das schnelle
   * Modell, Tokens und Dauer. Keine Noten, kein Nutzertext.
   */
  evalStats?: {
    judge: "gemini" | "opus";
    fallback: "konfiguration" | "frist" | "schema" | "fehler" | null;
    tokensIn: number | null;
    tokensOut: number | null;
    /** Dauer des Richter-Aufrufs, der das Urteil geliefert hat. */
    judgeMs: number;
    /** Dauer der ganzen Auswertung (Richter, Kompetenzen, Zitatprüfung, Rechnung). */
    ms: number;
  } | null;
  // ── Paket 3 (12.11.2026): Auswertung als Auftrag mit Status (C4) ───────────
  /** Gesetzt, solange gerechnet wird. `since` ist zugleich die Kennung dieses Versuchs (nur er darf speichern). */
  finishing?: { since: string } | null;
  /**
   * Letzter Fehlschlag der Auswertung; wird beim nächsten Start gelöscht. `code` = Fehlerart der KI
   * (`AiErrorCode` aus ai-errors.ts) oder `STALE` (Rechnung blieb hängen, z. B. Neustart des Servers).
   */
  finishError?: { code: string; requestId?: string | null; at: string } | null;
  /** Check-in in zwei Fragen (S8): höchstens einmal gespeichert. `skipped` = keine der beiden beantwortet. */
  checkin?: { gut: string | null; anders: string | null; skipped: boolean; at: string } | null;
  /** Entscheid 5 (Owner 12.11.2026): Diese Auswertung lief als freier Testlauf des Szenarios, ohne Buchung. */
  freeTestEval?: boolean;
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
 * Übergang aus `active` und aus `finishing` (Paket 3: der Auftrag speichert dann nichts und bucht zurück).
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

/** Jemand anderes hat den Lauf seit dem Lesen geändert (Cosmos 412). Neu lesen und wiederholen. */
export class SimulationConflictError extends Error {
  constructor(simId: string) {
    super(`Lauf ${simId} wurde inzwischen von anderer Stelle geändert.`);
    this.name = "SimulationConflictError";
  }
}

function isPreconditionFailed(err: unknown): boolean {
  const e = err as { code?: unknown; statusCode?: unknown } | null;
  return e?.code === 412 || e?.statusCode === 412;
}

/**
 * Speichert den Lauf. Paket 2, C3 (12.11.2026): Trägt das Dokument eine Version (`_etag`, kommt beim Lesen
 * mit), wird nur geschrieben, wenn der Lauf seitdem unverändert ist — sonst `SimulationConflictError`.
 * Die neue Version wird am übergebenen Objekt vermerkt, damit dieselbe Kopie erneut speichern kann.
 * Ohne Version (frisch angelegte oder alte Kopien) bleibt es beim einfachen Überschreiben.
 * Für kleine Änderungen an einem Lauf, den auch andere schreiben, `updateSimulation` nehmen.
 */
export async function saveSimulation(doc: SimulationDoc): Promise<void> {
  const item = { ...doc, updatedAt: new Date().toISOString() };
  if (!doc._etag) {
    const saved = await upsertItem(runsContainer(), item);
    if (saved._etag) doc._etag = saved._etag;
    return;
  }
  try {
    const saved = await replaceItemIfMatch(runsContainer(), item, doc.sessionId, doc._etag);
    if (saved._etag) doc._etag = saved._etag;
  } catch (err) {
    if (isPreconditionFailed(err)) throw new SimulationConflictError(doc.id);
    throw err;
  }
}

/** So oft liest `updateSimulation` neu, wenn ein anderer Schreiber dazwischenkam. */
export const SIM_UPDATE_MAX_TRIES = 5;

/**
 * Ändert einen Lauf sicher gegen parallele Schreiber (Paket 2, C3): liest frisch, wendet `mutate` an und
 * schreibt mit Versionsprüfung. Kam ein anderer Schreiber dazwischen, wird neu gelesen und `mutate` erneut
 * angewandt (bis zu fünfmal). `mutate` muss deshalb wiederholbar sein und nur die eigenen Felder anfassen.
 * Gibt `mutate` genau `false` zurück, wird nichts geschrieben. Rückgabe: der gespeicherte Lauf, oder `null`,
 * wenn es ihn nicht gibt (oder er nicht dieser Person gehört).
 */
export async function updateSimulation(
  uid: string,
  simId: string,
  mutate: (doc: SimulationDoc) => void | false
): Promise<SimulationDoc | null> {
  for (let attempt = 1; ; attempt++) {
    const doc = await getSimulation(uid, simId);
    if (!doc) return null;
    if (mutate(doc) === false) return doc;
    try {
      await saveSimulation(doc);
      return doc;
    } catch (err) {
      if (!(err instanceof SimulationConflictError) || attempt >= SIM_UPDATE_MAX_TRIES) throw err;
    }
  }
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

/** So viele abgebrochene Läufe räumt ein Durchgang höchstens weg (der nächste macht weiter). */
export const ABORTED_SWEEP_MAX = 100;

/**
 * Paket 2, C19 (12.11.2026): Abgebrochene Läufe behalten ihr Gespräch, stehen aber in keiner Liste und sind
 * für die Person deshalb nicht löschbar. Der gelegentliche Aufräumer (aufraeumen.ts) löscht hiermit die Läufe
 * ALLER Personen, die abgebrochen und seit `cutoffIso` unverändert sind. Abgebrochene Läufe haben weder
 * Auswertung noch Messpunkt, das Dokument ist alles. Rückgabe: Zahl der gelöschten.
 */
export async function deleteAbortedSimulationsBefore(cutoffIso: string): Promise<number> {
  const rows = await queryItems<{ id: string; sessionId: string }>(
    runsContainer(),
    // Über alle Partitionen (jede Person hat ihre eigene). Läufe mit offener Buchung (C8) bleiben liegen,
    // sonst wäre die Spur für den Credit-Abgleich nach 30 Tagen weg.
    `SELECT TOP ${ABORTED_SWEEP_MAX} c.id, c.sessionId FROM c WHERE c.docType = @dt AND c.status = 'aborted' AND c.updatedAt < @cutoff AND (NOT IS_DEFINED(c.openCharge) OR IS_NULL(c.openCharge))`,
    [
      { name: "@dt", value: SIM_DOC_TYPE },
      { name: "@cutoff", value: cutoffIso },
    ]
  );
  let deleted = 0;
  for (const r of rows) {
    if (!r.sessionId?.startsWith("sim:")) continue;
    await deleteItem(runsContainer(), r.id, r.sessionId);
    deleted++;
  }
  return deleted;
}

export interface SimulationListItem {
  id: string;
  scenarioId: string;
  /** `finishing` (Paket 3) = „Auswertung läuft“: weder fortsetzbar noch abgeschlossen. */
  status: "active" | "finishing" | "finished";
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
    status: SimulationListItem["status"];
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
/** Go-Live S3 (15.10.2026): Rollenspiel-Starts einer Person seit Tagesbeginn (UTC), abgebrochene zählen nicht. */
export async function countSimulationsStartedToday(uid: string, now: Date = new Date()): Promise<number> {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const rows = await queryItems<number>(
    runsContainer(),
    "SELECT VALUE COUNT(1) FROM c WHERE c.sessionId = @pk AND c.docType = @dt AND c.createdAt >= @from AND c.status != 'aborted'",
    [
      { name: "@pk", value: simPartitionKey(uid) },
      { name: "@dt", value: SIM_DOC_TYPE },
      { name: "@from", value: dayStart },
    ]
  );
  return rows[0] ?? 0;
}

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

// ── O2 Micro-Transfer (Blueprint COACH-OPTIMIERUNG 27.09.2026) ──────────────

export interface PendingTransferCheck {
  id: string;
  scenarioId: string;
  finishedAt: string;
  commitment: Commitment;
}

/**
 * Jüngste abgeschlossene Simulation MIT Vorsatz und OHNE Rückmeldung, die
 * mindestens `minAgeMs` alt ist — die eine Nachfrage beim Login (Gemini Zu 4,
 * Owner E-4: nur beim Login, keine Mails; wegklicken = nie wieder).
 * Partitions-lokal, billig.
 */
export async function latestPendingTransferCheck(
  uid: string,
  minAgeMs: number
): Promise<PendingTransferCheck | null> {
  const cutoff = new Date(Date.now() - Math.max(0, minAgeMs)).toISOString();
  const rows = await queryItems<{
    id: string;
    scenarioId: string;
    finishedAt?: string;
    createdAt: string;
    commitment?: Commitment | null;
  }>(
    runsContainer(),
    "SELECT TOP 1 c.id, c.scenarioId, c.finishedAt, c.createdAt, c.commitment FROM c " +
      "WHERE c.sessionId = @pk AND c.docType = @dt AND c.status = @st " +
      "AND IS_DEFINED(c.commitment) AND NOT IS_NULL(c.commitment) " +
      "AND (NOT IS_DEFINED(c.transferCheck) OR IS_NULL(c.transferCheck)) " +
      "AND c.finishedAt <= @cutoff ORDER BY c.finishedAt DESC",
    [
      { name: "@pk", value: simPartitionKey(uid) },
      { name: "@dt", value: SIM_DOC_TYPE },
      { name: "@st", value: "finished" },
      { name: "@cutoff", value: cutoff },
    ]
  );
  const r = rows[0];
  if (!r?.commitment?.text) return null;
  return {
    id: r.id,
    scenarioId: r.scenarioId,
    finishedAt: r.finishedAt ?? r.createdAt,
    commitment: r.commitment,
  };
}

/**
 * Jüngste Rückmeldung aus dem Alltag (nicht „dismissed“) — Kontext für das
 * nächste Debrief („Vorsatz X, Rückmeldung Y“). Partitions-lokal.
 */
export async function latestTransferReview(
  uid: string
): Promise<{ commitment: Commitment; transferCheck: TransferCheck; scenarioId: string } | null> {
  const rows = await queryItems<{
    scenarioId: string;
    commitment?: Commitment | null;
    transferCheck?: TransferCheck | null;
  }>(
    runsContainer(),
    "SELECT TOP 1 c.scenarioId, c.commitment, c.transferCheck FROM c " +
      "WHERE c.sessionId = @pk AND c.docType = @dt AND c.status = @st " +
      "AND IS_DEFINED(c.transferCheck) AND NOT IS_NULL(c.transferCheck) " +
      "AND c.transferCheck.outcome != 'dismissed' ORDER BY c.transferCheck.at DESC",
    [
      { name: "@pk", value: simPartitionKey(uid) },
      { name: "@dt", value: SIM_DOC_TYPE },
      { name: "@st", value: "finished" },
    ]
  );
  const r = rows[0];
  if (!r?.commitment?.text || !r.transferCheck) return null;
  return { commitment: r.commitment, transferCheck: r.transferCheck, scenarioId: r.scenarioId };
}
