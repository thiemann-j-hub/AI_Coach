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
import { isPrivateScenarioId } from "@/lib/server/scenario-store";
import { deleteSpielbuch } from "@/lib/server/spielbuch/store";
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
  // Ohne Statusfilter: Auch abgebrochene Rollenspiele, die in keiner Liste stehen, werden gelöscht (C19, geprüft
  // 12.11.2026) — ebenso die privaten Szenarien der Person, die ihre Kennung tragen.
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
    // Paket 2, C19 (12.11.2026): Das Spielbuch eines privaten Szenarios liegt in einer eigenen Partition ohne
    // Personenkennung, die Abfrage oben findet es nicht. Es geht mit seinem Szenario (fail-soft).
    if (isPrivateScenarioId(r.id)) await deleteSpielbuch(r.id);
  }

  logger.api("account/delete", "learning-history-deleted", {
    uid,
    runsDeleted,
    measurementsDeleted,
    runsFound: runs.length,
  });
  return { runsDeleted, measurementsDeleted };
}

/**
 * Go-Live-Prüfung 12.11.2026 (S2): Nutzer-Kennungen zu einer Register-Kennung (oid). Bei PulseNorth-Konten („ml:…“)
 * ist die Kennung selbst die Nutzer-Kennung. Bei Microsoft-Konten schlüsselt der Coach auf den OIDC-`sub`; das Profil
 * trägt die oid im Feld `entraOid` (seit dem ersten Aufruf der App). Vorher suchten die Dienst-Löschungen nur nach
 * der oid, fanden bei Microsoft-Konten nichts und meldeten trotzdem Erfolg.
 */
export async function uidsFuerOid(oid: string): Promise<string[]> {
  const uids = new Set<string>([oid]);
  const rows = await queryItems<IdRow>(usersContainer(), "SELECT c.id FROM c WHERE c.entraOid = @oid", [
    { name: "@oid", value: oid },
  ]);
  for (const r of rows) if (r.id) uids.add(r.id);
  return [...uids];
}

/** Hat die Löschung etwas gefunden? Für ehrliche Zähler in den Dienst-Routen. */
export function etwasGeloescht(r: AccountDeletionResult): boolean {
  // `tokenStoreDeleted` zählt nicht: Das Löschen eines fehlenden Eintrags gilt dort als gelungen.
  return r.runsDeleted > 0 || r.sessionsDeleted > 0 || r.usageDeleted > 0 || r.profileDeleted;
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
  // S2 (12.11.2026): `deleteItem` schluckt ein fehlendes Dokument. Damit der Zähler stimmt, wird erst nachgesehen,
  // ob es ein Profil gibt; vorher meldete die Löschung auch dann `profileDeleted: true`, wenn nichts da war.
  const profilDa =
    (await queryItems<IdRow>(usersContainer(), "SELECT c.id FROM c WHERE c.id = @id", [{ name: "@id", value: uid }])).length > 0;
  const profileDeleted = profilDa && (await safeDelete(() => deleteItem(usersContainer(), uid, uid)));

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
