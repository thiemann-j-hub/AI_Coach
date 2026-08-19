import "server-only";

import { deleteItem, queryItems, readItem, runsContainer, upsertItem } from "@/lib/cosmos";
import { getCentralMemberInfo } from "@/lib/server/credits/member-info";
import { getWorkspaceIdForUser } from "@/lib/server/credits/workspace-store";
import { getScenario } from "@/lib/simulation/scenarios";
import { validateScenario } from "@/lib/simulation/scenario-schema";
import type { SimulationScenario } from "@/lib/simulation/types";
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
  try {
    const workspaceId = await resolveWorkspaceIdForScenarios(uid, oid);
    return await listWorkspaceScenarios(workspaceId);
  } catch (e) {
    logger.apiError("scenario-store/listScenariosForUser", e);
    return [];
  }
}
