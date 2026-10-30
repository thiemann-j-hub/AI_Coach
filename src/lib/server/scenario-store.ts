import "server-only";

import { deleteItem, queryItems, readItem, runsContainer, upsertItem } from "@/lib/cosmos";
import { getCentralMemberInfo } from "@/lib/server/credits/member-info";
import { getWorkspaceIdForUser } from "@/lib/server/credits/workspace-store";
import { getScenario } from "@/lib/simulation/scenarios";
import { validateScenario } from "@/lib/simulation/scenario-schema";
import type { PersonaVoice, SimulationScenario } from "@/lib/simulation/types";
import { logger } from "@/lib/logger";

/**
 * B3a (Welle B, Synthesia-Vergleich §7): Szenario-Ablage JE WORKSPACE.
 *
 * Muster wie die Simulations-Docs: kein neuer Container — Szenarien liegen im
 * runs-Container mit docType "sim_scenario" und PK sessionId =
 * `simscn:${workspaceId}`. Alle Szenarien eines Mandanten teilen eine
 * Partition (Punkt-Reads + billige List-Query), und KEIN Mandant sieht je die
 * Szenarien eines anderen — die Partition IST die Mandantengrenze.
 *
 * Eingebaute Szenarien (scenarios.ts) gewinnen immer: getScenarioForUser
 * prüft zuerst den Code-Katalog; die ws-… Namensklasse (Schema-Regel) macht
 * Kollisionen zusätzlich unmöglich.
 */

export const SCENARIO_DOC_TYPE = "sim_scenario" as const;

export interface ScenarioDoc {
  id: string; // scenario.id (ws-…)
  sessionId: string; // PK: `simscn:${workspaceId}`
  docType: typeof SCENARIO_DOC_TYPE;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Welle C: draft = nur im Builder sichtbar (Kunden-Admin), published = im
   * Katalog des Workspace. Alt-Docs ohne Feld gelten als published (B3a-Weg).
   */
  status?: "draft" | "published";
  /** Welle C: uid des Erstellers (Builder); Concierge-Docs haben keine. */
  createdByUid?: string;
  /** Validiertes Szenario (Schema-geprüft beim Upsert). */
  scenario: SimulationScenario;
}

export function scenarioPartitionKey(workspaceId: string): string {
  return `simscn:${workspaceId}`;
}

/**
 * Welle 4 (Owner-GO 30.10.2026, N4-240): „Mein echtes Gespräch vorbereiten“ — private Szenarien EINER Person.
 * Eigene Partition je uid (nicht je Workspace): kein Admin, kein Builder und keine Katalog-Liste des Mandanten
 * sieht sie. Id-Namensklasse `ws-mein-…` (Schema-konform, nie Kollision mit sim-/ws-Katalog). Nach 30 Tagen
 * verfallen sie (expiresAt; Liste filtert, Leser löscht verfallene Docs beim nächsten Zugriff).
 */
export const PRIVATE_SCENARIO_PREFIX = "ws-mein-";
export const PRIVATE_SCENARIO_TTL_DAYS = 30;

export function privateScenarioPartitionKey(uid: string): string {
  return `simscn-mein:${uid}`;
}

export function isPrivateScenarioId(id: string): boolean {
  return id.startsWith(PRIVATE_SCENARIO_PREFIX);
}

export interface PrivateScenarioDoc extends ScenarioDoc {
  privat: true;
  uid: string;
  /** ISO-Zeitpunkt, ab dem das Szenario nicht mehr gespielt werden kann. */
  expiresAt: string;
  /** Die drei Sätze der Person (Anlass, Gegenüber, Ziel) — nur zur Anzeige, nie an Dritte. */
  eingabe?: { anlass: string; gegenueber: string; ziel?: string };
}

export function privateScenarioExpired(doc: Pick<PrivateScenarioDoc, "expiresAt">, now: Date = new Date()): boolean {
  const t = Date.parse(doc.expiresAt);
  return Number.isFinite(t) ? t <= now.getTime() : false;
}

export async function upsertPrivateScenario(
  uid: string,
  input: unknown,
  opts: { eingabe?: PrivateScenarioDoc["eingabe"]; now?: Date }
): Promise<PrivateScenarioDoc> {
  const scenario = validateScenario(input);
  if (!isPrivateScenarioId(scenario.id)) throw new Error("privates Szenario braucht die Id-Klasse ws-mein-");
  const now = opts.now ?? new Date();
  const doc: PrivateScenarioDoc = {
    id: scenario.id,
    sessionId: privateScenarioPartitionKey(uid),
    docType: SCENARIO_DOC_TYPE,
    workspaceId: `mein:${uid}`,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    status: "published",
    createdByUid: uid,
    privat: true,
    uid,
    expiresAt: new Date(now.getTime() + PRIVATE_SCENARIO_TTL_DAYS * 86_400_000).toISOString(),
    ...(opts.eingabe ? { eingabe: opts.eingabe } : {}),
    scenario,
  };
  await upsertItem(runsContainer(), doc);
  return doc;
}

/** Private Szenarien einer Person, verfallene werden still gelöscht (fail-soft). */
export async function listPrivateScenarioDocs(uid: string, now: Date = new Date()): Promise<PrivateScenarioDoc[]> {
  const rows = await queryItems<PrivateScenarioDoc>(
    runsContainer(),
    "SELECT * FROM c WHERE c.sessionId = @pk AND c.docType = @dt ORDER BY c.createdAt DESC",
    [
      { name: "@pk", value: privateScenarioPartitionKey(uid) },
      { name: "@dt", value: SCENARIO_DOC_TYPE },
    ]
  );
  const live: PrivateScenarioDoc[] = [];
  for (const r of rows) {
    if (privateScenarioExpired(r, now)) {
      deleteItem(runsContainer(), r.id, privateScenarioPartitionKey(uid)).catch(() => undefined);
      continue;
    }
    live.push(r);
  }
  return live;
}

export async function getPrivateScenario(uid: string, scenarioId: string, now: Date = new Date()): Promise<PrivateScenarioDoc | null> {
  const doc = await readItem<PrivateScenarioDoc>(runsContainer(), scenarioId, privateScenarioPartitionKey(uid));
  if (!doc || doc.docType !== SCENARIO_DOC_TYPE || !doc.privat) return null;
  return privateScenarioExpired(doc, now) ? null : doc;
}

export async function deletePrivateScenario(uid: string, scenarioId: string): Promise<boolean> {
  const doc = await readItem<PrivateScenarioDoc>(runsContainer(), scenarioId, privateScenarioPartitionKey(uid));
  if (!doc || doc.docType !== SCENARIO_DOC_TYPE) return false;
  await deleteItem(runsContainer(), scenarioId, privateScenarioPartitionKey(uid));
  return true;
}

/**
 * Mandanten-Auflösung für Szenarien: die ZENTRALE workspaceId aus dem
 * CreditService ist die Wahrheit (dieselbe, die Spend/Rechnungen tragen —
 * Live-Befund 18.08.: das lokale users-Doc kennt sie nicht und fiele auf den
 * Solo-Default uid zurück). Fallback lokal nur, wenn zentral nichts liefert.
 */
export async function resolveWorkspaceIdForScenarios(uid: string, oid?: string | null): Promise<string> {
  if (oid) {
    const info = await getCentralMemberInfo(oid);
    if (info?.workspaceId) return info.workspaceId;
  }
  return getWorkspaceIdForUser(uid);
}

/** Upsert mit Pflicht-Validierung — ungültige Entwürfe erreichen die DB nie. */
export async function upsertWorkspaceScenario(
  workspaceId: string,
  input: unknown,
  opts?: { status?: "draft" | "published"; createdByUid?: string }
): Promise<ScenarioDoc> {
  const scenario = validateScenario(input);
  const now = new Date().toISOString();
  const existing = await readItem<ScenarioDoc>(
    runsContainer(),
    scenario.id,
    scenarioPartitionKey(workspaceId)
  );
  const doc: ScenarioDoc = {
    id: scenario.id,
    sessionId: scenarioPartitionKey(workspaceId),
    docType: SCENARIO_DOC_TYPE,
    workspaceId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    status: opts?.status ?? existing?.status ?? "published",
    ...(opts?.createdByUid
      ? { createdByUid: opts.createdByUid }
      : existing?.createdByUid
        ? { createdByUid: existing.createdByUid }
        : {}),
    scenario,
  };
  await upsertItem(runsContainer(), doc);
  return doc;
}

/** Welle C: Status eines Workspace-Szenarios umschalten (publish/unpublish). */
export async function setWorkspaceScenarioStatus(
  workspaceId: string,
  scenarioId: string,
  status: "draft" | "published"
): Promise<ScenarioDoc | null> {
  const existing = await readItem<ScenarioDoc>(
    runsContainer(),
    scenarioId,
    scenarioPartitionKey(workspaceId)
  );
  if (!existing || existing.docType !== SCENARIO_DOC_TYPE) return null;
  const doc = { ...existing, status, updatedAt: new Date().toISOString() };
  await upsertItem(runsContainer(), doc);
  return doc;
}

/** Welle C: alle Szenario-DOCS des Workspace (inkl. Drafts) für den Builder. */
export async function listWorkspaceScenarioDocs(
  workspaceId: string
): Promise<ScenarioDoc[]> {
  return queryItems<ScenarioDoc>(
    runsContainer(),
    "SELECT * FROM c WHERE c.sessionId = @pk AND c.docType = @dt ORDER BY c.createdAt DESC",
    [
      { name: "@pk", value: scenarioPartitionKey(workspaceId) },
      { name: "@dt", value: SCENARIO_DOC_TYPE },
    ]
  );
}

export async function deleteWorkspaceScenario(
  workspaceId: string,
  scenarioId: string
): Promise<boolean> {
  const existing = await readItem<ScenarioDoc>(
    runsContainer(),
    scenarioId,
    scenarioPartitionKey(workspaceId)
  );
  if (!existing || existing.docType !== SCENARIO_DOC_TYPE) return false;
  await deleteItem(runsContainer(), scenarioId, scenarioPartitionKey(workspaceId));
  return true;
}

export async function listWorkspaceScenarios(
  workspaceId: string
): Promise<SimulationScenario[]> {
  const rows = await queryItems<ScenarioDoc>(
    runsContainer(),
    // Welle C: Drafts bleiben im Builder — der Katalog sieht nur published
    // (Alt-Docs ohne status-Feld gelten als published).
    "SELECT * FROM c WHERE c.sessionId = @pk AND c.docType = @dt AND (NOT IS_DEFINED(c.status) OR c.status = 'published') ORDER BY c.createdAt ASC",
    [
      { name: "@pk", value: scenarioPartitionKey(workspaceId) },
      { name: "@dt", value: SCENARIO_DOC_TYPE },
    ]
  );
  return rows.map((r) => r.scenario);
}

/**
 * Auflösung für alle Simulations-Routen: eingebaute Szenarien zuerst (sync,
 * kein DB-Zugriff), sonst Workspace-Szenario des Users. Fail-soft: schlägt
 * die Workspace-Auflösung fehl, verhält sich alles wie vor B3a (nur Katalog).
 */
export async function getScenarioForUser(
  uid: string,
  scenarioId: string,
  oid?: string | null
): Promise<SimulationScenario | null> {
  const builtin = getScenario(scenarioId);
  if (builtin) return builtin;
  if (!scenarioId.startsWith("ws-")) return null;
  if (isPrivateScenarioId(scenarioId)) {
    // Welle 4: privates Szenario der Person — nur aus IHRER Partition, nie aus der des Mandanten.
    try {
      return (await getPrivateScenario(uid, scenarioId))?.scenario ?? null;
    } catch (e) {
      logger.apiError("scenario-store/getPrivateScenario", e, { scenarioId });
      return null;
    }
  }
  try {
    const workspaceId = await resolveWorkspaceIdForScenarios(uid, oid);
    const doc = await readItem<ScenarioDoc>(
      runsContainer(),
      scenarioId,
      scenarioPartitionKey(workspaceId)
    );
    return doc?.docType === SCENARIO_DOC_TYPE ? doc.scenario : null;
  } catch (e) {
    logger.apiError("scenario-store/getScenarioForUser", e, { scenarioId });
    return null;
  }
}

/** Workspace-Szenarien des Users für den Katalog (fail-soft: leere Liste). */
export async function listScenariosForUser(
  uid: string,
  oid?: string | null
): Promise<SimulationScenario[]> {
  let ws: SimulationScenario[] = [];
  try {
    const workspaceId = await resolveWorkspaceIdForScenarios(uid, oid);
    ws = await listWorkspaceScenarios(workspaceId);
  } catch (e) {
    logger.apiError("scenario-store/listScenariosForUser", e);
  }
  // Welle 4: private Szenarien der Person hinter den Mandanten-Katalog (fail-soft).
  try {
    const mine = (await listPrivateScenarioDocs(uid)).map((d) => d.scenario);
    return [...ws, ...mine];
  } catch (e) {
    logger.apiError("scenario-store/listPrivateScenarioDocs", e);
    return ws;
  }
}

/**
 * O5a (Blueprint COACH-OPTIMIERUNG 27.09.2026): Stimme der Persona eines
 * Workspace-Szenarios setzen — bisher sprachen alle Kundenszenarien mit der
 * Standardstimme. Nur Admin (Route), nur bekannte Stimmen (Route-Schema).
 */
export async function setWorkspaceScenarioVoice(
  workspaceId: string,
  scenarioId: string,
  voice: PersonaVoice,
  /** Builder-Stimmenwahl 28.10.: gewählte Live-Stimme (die Azure-Stimme `voice` ist daraus abgeleitet). */
  liveVoice?: string
): Promise<ScenarioDoc | null> {
  const existing = await readItem<ScenarioDoc>(
    runsContainer(),
    scenarioId,
    scenarioPartitionKey(workspaceId)
  );
  if (!existing || existing.docType !== SCENARIO_DOC_TYPE) return null;
  const doc: ScenarioDoc = {
    ...existing,
    scenario: { ...existing.scenario, persona: { ...existing.scenario.persona, voice, ...(liveVoice ? { liveVoice } : {}) } },
    updatedAt: new Date().toISOString(),
  };
  await upsertItem(runsContainer(), doc);
  return doc;
}
