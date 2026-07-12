import "server-only";
/**
 * R8 — DSGVO-Self-Service-Löschung (Art. 17 DSGVO, Recht auf Löschung).
 *
 * Zwei Operationen:
 *   - deleteLearningHistory(uid): löscht die Lern-Historie HART — alle `runs`
 *     (Analyse-Output) des Nutzers + die zugehörigen Radar-Messpunkte. Account
 *     bleibt bestehen (Credits/Rechnungen unberührt).
 *   - deleteAccount(uid, oid): Lern-Historie + Sessions + Nutzungs-Zähler +
 *     Entra-Token-Store + Profil. Der Nutzer wird danach ausgeloggt.
 *
 * BEWUSST NICHT gelöscht (gesetzliche Aufbewahrung / fremde Daten):
 *   - `invoices` — 10 Jahre § 147 AO / § 14b UStG (Art. 17 Abs. 3 lit. b DSGVO;
 *     so auch in der Datenschutzerklärung dokumentiert).
 *   - `workspaces` / zentrale Credit-Wallet — Abrechnungs-/Team-Infrastruktur
 *     (Solo-Workspace = oid; bei Team hängen fremde Mitglieder daran).
 *
 * Robustheit: jede Einzel-Löschung ist gekapselt; ein 404/Fehler an einem Doc
 * stoppt die Kaskade nicht (best-effort, aber Zähler melden das Ergebnis).
 */
import {
  runsContainer,
  sessionsContainer,
  usageContainer,
  usersContainer,
  creditTokensContainer,
  queryItems,
  deleteItem,
} from "@/lib/cosmos";
import { deleteCoachMeasurement } from "@/lib/server/radar-emit";
import { logger } from "@/lib/logger";

type IdRow = { id: string; sessionId?: string; workspaceId?: string };

async function safeDelete(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch {
    return false; // 404/transient → best-effort, Kaskade läuft weiter
  }
}

export interface HistoryDeletionResult {
  runsDeleted: number;
  measurementsDeleted: number;
}

/** Lern-Historie hart löschen: alle runs des uid + deren Radar-Messpunkte. */
export async function deleteLearningHistory(
  uid: string,
  oid: string | null
): Promise<HistoryDeletionResult> {
  const runs = await queryItems<IdRow>(
    runsContainer(),
    "SELECT c.id, c.sessionId, c.workspaceId FROM c WHERE c.uid = @uid",
    [{ name: "@uid", value: uid }]
  );

  let runsDeleted = 0;
  let measurementsDeleted = 0;
  for (const r of runs) {
    if (!r.sessionId) continue;
    // Radar-Messpunkt (runId = r.id) über die möglichen workspaceId-pk-Werte löschen.
    const measured = await deleteCoachMeasurement(r.id, [r.workspaceId, oid]).catch(() => ({ deleted: 0 }));
    measurementsDeleted += measured.deleted;
    // Analyse-Run HART löschen (nicht soft) — echte Erasure.
    if (await safeDelete(() => deleteItem(runsContainer(), r.id, r.sessionId as string))) {
      runsDeleted++;
    }
  }

  logger.api("account/delete", "learning-history-deleted", {
    uid,
    runsDeleted,
    measurementsDeleted,
    runsFound: runs.length,
  });
  return { runsDeleted, measurementsDeleted };
}

export interface AccountDeletionResult extends HistoryDeletionResult {
  sessionsDeleted: number;
  usageDeleted: number;
  tokenStoreDeleted: boolean;
  profileDeleted: boolean;
}

/** Vollständige Account-Löschung (Lern-Historie + personenbezogene Konten-Daten). */
export async function deleteAccount(
  uid: string,
  oid: string | null
): Promise<AccountDeletionResult> {
  const history = await deleteLearningHistory(uid, oid);

  // Sessions (pk /id, Feld uid)
  const sessions = await queryItems<IdRow>(
    sessionsContainer(),
    "SELECT c.id FROM c WHERE c.uid = @uid",
    [{ name: "@uid", value: uid }]
  );
  let sessionsDeleted = 0;
  for (const s of sessions) {
    if (await safeDelete(() => deleteItem(sessionsContainer(), s.id, s.id))) sessionsDeleted++;
  }

  // Nutzungs-Zähler (usage, pk /id = `${uid}_${date}`, Feld uid)
  const usage = await queryItems<IdRow>(
    usageContainer(),
    "SELECT c.id FROM c WHERE c.uid = @uid",
    [{ name: "@uid", value: uid }]
  );
  let usageDeleted = 0;
  for (const u of usage) {
    if (await safeDelete(() => deleteItem(usageContainer(), u.id, u.id))) usageDeleted++;
  }

  // Entra-Token-Store (credit_tokens, pk /oid) — gespeicherte Access-/Refresh-Tokens entwerten
  const tokenStoreDeleted = oid
    ? await safeDelete(() => deleteItem(creditTokensContainer(), oid, oid))
    : false;

  // Profil (users, pk /id = uid) — zuletzt
  const profileDeleted = await safeDelete(() => deleteItem(usersContainer(), uid, uid));

  logger.api("account/delete", "account-deleted", {
    uid,
    ...history,
    sessionsDeleted,
    usageDeleted,
    tokenStoreDeleted,
    profileDeleted,
  });

  return { ...history, sessionsDeleted, usageDeleted, tokenStoreDeleted, profileDeleted };
}
