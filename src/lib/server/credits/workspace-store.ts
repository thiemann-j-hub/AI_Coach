import "server-only";

import {
  domainsContainer,
  queryItems,
  readItem,
  upsertItem,
  usersContainer,
  workspacesContainer,
} from "@/lib/cosmos";
import { getWorkspaceDoc, grantCredits, reconcileExpiredHolds } from "./ledger";
import {
  DomainClaimDoc,
  MAX_WORKSPACE_MEMBERS,
  WorkspaceDoc,
  WorkspaceMember,
} from "./types";

/** Max. OCC-Wiederholungen fuer Read-Modify-Write am Workspace-Doc (If-Match). */
const MAX_OCC_RETRIES = 5;

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Team-Auto-Claim ist Teil des Bezahlsystems und nur bei PAYMENTS_ENABLED=on
 * aktiv. Inline (kein Import aus entitlement.ts), um einen Modul-Zyklus
 * workspace-store <-> entitlement zu vermeiden.
 */
function teamClaimsEnabled(): boolean {
  return (process.env.PAYMENTS_ENABLED ?? "off").toLowerCase() === "on";
}

/**
 * Workspace-Aufloesung + Free-Run-Gate.
 *
 * Solo-Default: jeder User IST sein eigener Workspace (workspaceId === uid).
 * Team (max 3) ist nur ein members-Array im Workspace-Doc. users/sessions/runs
 * bleiben unveraendert; das User-Doc traegt nur zusaetzlich ein workspaceId-Feld.
 *
 * Free-Run liegt UEBER dem Workspace: 1 kostenlose Analyse pro verifizierter
 * B2B-Domain (Container `domains`, Claim via create() = 409-idempotent).
 * Freemail/Wegwerf-Domains teilen sich keine Domain-Partition, sonst bekaeme
 * z. B. ganz gmail.com nur EINEN Free-Run; fuer sie gilt der Free-Run pro uid.
 */

/** Freemail-/Consumer-Domains: Free-Run pro uid statt pro Domain. */
const FREEMAIL_DOMAINS = new Set(
  (process.env.FREEMAIL_DOMAINS ??
    "gmail.com,googlemail.com,gmx.de,gmx.net,web.de,outlook.com,hotmail.com,hotmail.de,yahoo.com,yahoo.de,icloud.com,me.com,aol.com,t-online.de,freenet.de,proton.me,protonmail.com")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
);

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const dom = email.slice(at + 1).trim().toLowerCase();
  return dom || null;
}

/**
 * Claim-Schluessel fuer den Free-Run: Business-Domain -> pro Domain;
 * Freemail -> pro uid (jeder Consumer-Account bekommt seinen eigenen Free-Run).
 */
export function freeRunClaimKey(email: string | null | undefined, uid: string): string {
  const dom = email ? emailDomain(email) : null;
  if (!dom || FREEMAIL_DOMAINS.has(dom)) return `uid:${uid}`;
  return dom;
}

interface UserDocLite {
  id: string;
  email?: string | null;
  workspaceId?: string;
}

/**
 * Liefert den (ggf. neu angelegten) Solo-Workspace des Users und bucht dabei
 * lazily abgelaufene Holds zurueck. Beim Erstkontakt wird der Free-Run-Claim
 * versucht und bei Erfolg 1 Gratis-Credit gewaehrt.
 */
export async function resolveWorkspace(opts: {
  uid: string;
  email?: string | null;
}): Promise<WorkspaceDoc> {
  const { uid, email } = opts;

  const userDoc = await readItem<UserDocLite>(usersContainer(), uid, uid);
  const cachedWsId = userDoc?.workspaceId;

  // (A) Fast-Path: bestaetigtes Team-Mitglied (Cache zeigt auf fremde Partition).
  //     Die Mitgliedschaft im Doc ist die Wahrheit — ein veralteter Cache (z. B.
  //     nach Entfernen) wird hier erkannt und auf Solo zurueckgeheilt. Damit kann
  //     ein entfernter User NICHT weiter auf den Team-Pool zugreifen.
  if (cachedWsId && cachedWsId !== uid) {
    const teamWs = await getWorkspaceDoc(cachedWsId);
    if (teamWs && teamWs.members.some((m) => m.uid === uid)) {
      await reconcileExpiredHolds(teamWs.workspaceId);
      return teamWs;
    }
    await setUserWorkspaceId(uid, email, uid); // Stale Cache -> Solo
  }

  // (B) Auto-Claim: offene E-Mail-Einladung beanspruchen (oder Mitgliedschaft
  //     ohne Cache heilen). Nur bei aktivem Bezahlsystem; Nicht-Team-Login.
  if (teamClaimsEnabled() && email) {
    const claimed = await tryClaimInvite({ uid, email });
    if (claimed) {
      await reconcileExpiredHolds(claimed.workspaceId);
      return claimed;
    }
  }

  // (C) Solo-Default: eigener Workspace (id === uid).
  let ws = await getWorkspaceDoc(uid);
  if (!ws) {
    ws = await createSoloWorkspace({ uid, email });
    // Free-Run-Grant NUR fuer den frisch angelegten Solo-Workspace.
    // Beitritt zu einem Team loest bewusst KEINEN neuen Free-Run aus.
    await tryGrantFreeRun({ workspaceId: ws.workspaceId, uid, email });
    ws = (await getWorkspaceDoc(ws.workspaceId)) ?? ws;
  } else {
    await reconcileExpiredHolds(ws.workspaceId);
  }

  return ws;
}

async function createSoloWorkspace(opts: {
  uid: string;
  email?: string | null;
}): Promise<WorkspaceDoc> {
  const { uid, email } = opts;
  const ts = new Date().toISOString();
  const owner: WorkspaceMember = {
    uid,
    email: email ?? "",
    role: "owner",
    addedAt: ts,
  };
  const ws: WorkspaceDoc = {
    id: uid,
    workspaceId: uid,
    type: "workspace",
    ownerUid: uid,
    members: [owner],
    balance: 0,
    createdAt: ts,
    updatedAt: ts,
  };
  // create() statt upsert(): bei paralleler Erstanlage gewinnt einer, der
  // andere bekommt 409 und liest den existierenden Workspace.
  try {
    const { resource } = await workspacesContainer().items.create<WorkspaceDoc>(ws);
    return (resource as WorkspaceDoc) ?? ws;
  } catch (err: any) {
    if (err?.code === 409) {
      const existing = await getWorkspaceDoc(uid);
      if (existing) return existing;
    }
    throw err;
  }
}

/**
 * Versucht den Free-Run zu beanspruchen. Atomar via create() im domains-
 * Container: 409 => Domain (bzw. uid) hat ihren Free-Run schon verbraucht.
 * Bei Erfolg: 1 Gratis-Credit (12 Monate) gutschreiben.
 */
export async function tryGrantFreeRun(opts: {
  workspaceId: string;
  uid: string;
  email?: string | null;
}): Promise<{ granted: boolean }> {
  const { workspaceId, uid, email } = opts;
  const claimKey = freeRunClaimKey(email, uid);
  const claim: DomainClaimDoc = {
    id: claimKey,
    domain: claimKey,
    freeRunClaimedAt: new Date().toISOString(),
    claimedByWorkspaceId: workspaceId,
    claimedByUid: uid,
  };
  try {
    await domainsContainer().items.create<DomainClaimDoc>(claim);
  } catch (err: any) {
    if (err?.code === 409) return { granted: false }; // Free-Run bereits verbraucht
    throw err;
  }
  // Claim gewonnen -> Gratis-Credit gutschreiben. KEIN CreditService-Schatten:
  // Grants (frei wie Kauf) laufen zentral bzw. werden per Migration geseedet —
  // Coachs Schatten-Seite beschraenkt sich bewusst auf spend + refund.
  await grantCredits({ workspaceId, amount: 1, source: "free", expiresInMonths: 12 });
  return { granted: true };
}

/** Read-only: workspaceId des Users (Solo-Default = uid), ohne Anlage/Grant-Seiteneffekt. */
export async function getWorkspaceIdForUser(uid: string): Promise<string> {
  const userDoc = await readItem<UserDocLite>(usersContainer(), uid, uid);
  return userDoc?.workspaceId || uid;
}

// ---------------------------------------------------------------------------
// OCC-Mutationen am Workspace-Doc (Read-Modify-Write mit If-Match)
//
// members[]/pendingInvites[] sind winzig (<= MAX) -> Read-Modify-Write mit
// ETag/If-Match ist hier korrekt und einfacher als Array-Patch-Indizes. Bei
// 412 (paralleler Owner-Write) wird neu gelesen und erneut versucht.
// ---------------------------------------------------------------------------

type ReplaceResult = "ok" | "conflict";

/** Ersetzt das Workspace-Doc bedingt (If-Match). 412 -> "conflict" (Retry), sonst throw. */
async function replaceWorkspaceIfMatch(doc: WorkspaceDoc, etag?: string): Promise<ReplaceResult> {
  const { _etag, ...body } = doc; // System-ETag nie in den Body schreiben
  void _etag;
  try {
    await workspacesContainer()
      .item(doc.id, doc.workspaceId)
      .replace(body, etag ? { accessCondition: { type: "IfMatch", condition: etag } } : undefined);
    return "ok";
  } catch (err: any) {
    if (err?.code === 412) return "conflict";
    throw err;
  }
}

/**
 * Setzt das workspaceId-Cache-Feld am User-Doc (Patch -> erhaelt alle anderen
 * Felder wie language/linkedin). Existiert das User-Doc noch nicht, wird ein
 * minimales angelegt. "Solo zuruecksetzen" = workspaceId auf die eigene uid.
 */
async function setUserWorkspaceId(
  uid: string,
  email: string | null | undefined,
  workspaceId: string
): Promise<void> {
  try {
    await usersContainer()
      .item(uid, uid)
      .patch({ operations: [{ op: "set", path: "/workspaceId", value: workspaceId }] });
  } catch (err: any) {
    if (err?.code === 404) {
      await upsertItem(usersContainer(), {
        id: uid,
        ...(email ? { email } : {}),
        workspaceId,
      } as any);
      return;
    }
    throw err;
  }
}

/**
 * Auto-Claim: findet (cross-partition) den Team-Workspace, in dem dieser User
 * bereits Mitglied ist ODER fuer den eine offene Einladung an seine E-Mail
 * vorliegt, und gliedert ihn ein. Selten aufgerufen (nur Nicht-Team-Login,
 * B2B — kein Hot-Path). Gibt den Team-Workspace zurueck oder null (kein Treffer
 * / voll / Race).
 */
async function tryClaimInvite(opts: { uid: string; email: string }): Promise<WorkspaceDoc | null> {
  const email = opts.email.trim().toLowerCase();
  if (!email) return null;

  const hits = await queryItems<WorkspaceDoc>(
    workspacesContainer(),
    `SELECT * FROM c WHERE c.type = 'workspace'
       AND (ARRAY_CONTAINS(c.members, { "uid": @uid }, true)
            OR ARRAY_CONTAINS(c.pendingInvites, { "email": @email }, true))`,
    [
      { name: "@uid", value: opts.uid },
      { name: "@email", value: email },
    ]
  );
  if (hits.length === 0) return null;
  // Der eigene Workspace (id === uid) ist hier ggf. dabei (uid steht in members).
  const ownWs = hits.find((w) => w.workspaceId === opts.uid);
  const team = hits.find((w) => w.workspaceId !== opts.uid);
  if (!team) return null; // nur der eigene Solo-/Team-WS -> nichts zu beanspruchen

  // Bereits Mitglied des fremden Teams (Cache war kalt) -> nur heilen.
  if (team.members.some((m) => m.uid === opts.uid)) {
    await setUserWorkspaceId(opts.uid, opts.email, team.workspaceId);
    return team;
  }

  // Guard: Wer selbst ein AKTIVES Team fuehrt (Owner mit weiteren Mitgliedern
  // oder offenen Einladungen), wird NICHT automatisch in ein fremdes Team
  // gezogen — sonst verwaiste sein eigenes Team. Ein reiner Solo-Owner darf
  // beitreten (sein Solo-Guthaben bleibt geparkt erhalten).
  if (
    ownWs &&
    ownWs.ownerUid === opts.uid &&
    (ownWs.members.length > 1 || (ownWs.pendingInvites?.length ?? 0) > 0)
  ) {
    return null;
  }

  // Sonst: Sitzplatz beanspruchen (Member rein, Invite raus) per OCC.
  const joined = await claimSeat({ workspaceId: team.workspaceId, uid: opts.uid, email });
  if (!joined) return null; // voll oder Race -> Solo-Fallback
  await setUserWorkspaceId(opts.uid, opts.email, team.workspaceId);
  return (await getWorkspaceDoc(team.workspaceId)) ?? null;
}

/** Beansprucht atomar einen freien Sitz und entfernt die zugehoerige Einladung. */
async function claimSeat(opts: {
  workspaceId: string;
  uid: string;
  email: string;
}): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_OCC_RETRIES; attempt++) {
    const ws = await getWorkspaceDoc(opts.workspaceId);
    if (!ws) return false;
    if (ws.members.some((m) => m.uid === opts.uid)) return true; // schon Mitglied
    if (ws.members.length >= MAX_WORKSPACE_MEMBERS) return false; // voll
    const ts = nowIso();
    const member: WorkspaceMember = {
      uid: opts.uid,
      email: opts.email,
      role: "member",
      addedAt: ts,
    };
    const next: WorkspaceDoc = {
      ...ws,
      members: [...ws.members, member],
      pendingInvites: (ws.pendingInvites ?? []).filter((p) => p.email !== opts.email),
      updatedAt: ts,
    };
    const r = await replaceWorkspaceIfMatch(next, ws._etag);
    if (r === "ok") return true;
    // conflict -> neu lesen & erneut versuchen
  }
  return false;
}

export type InviteResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_owner" | "full" | "exists" | "conflict" };

/**
 * Owner legt eine offene E-Mail-Einladung an (Auto-Claim beim ersten Login des
 * Eingeladenen). Sitzplatz-Budget = Mitglieder + offene Einladungen < MAX.
 */
export async function addPendingInvite(opts: {
  workspaceId: string;
  ownerUid: string;
  email: string;
}): Promise<InviteResult> {
  const email = opts.email.trim().toLowerCase();
  if (!email) return { ok: false, reason: "exists" };
  for (let attempt = 0; attempt < MAX_OCC_RETRIES; attempt++) {
    const ws = await getWorkspaceDoc(opts.workspaceId);
    if (!ws) return { ok: false, reason: "not_found" };
    if (ws.ownerUid !== opts.ownerUid) return { ok: false, reason: "not_owner" };
    if (ws.members.some((m) => m.email.trim().toLowerCase() === email)) {
      return { ok: false, reason: "exists" };
    }
    const pending = ws.pendingInvites ?? [];
    if (pending.some((p) => p.email === email)) return { ok: false, reason: "exists" };
    if (ws.members.length + pending.length >= MAX_WORKSPACE_MEMBERS) {
      return { ok: false, reason: "full" };
    }
    const ts = nowIso();
    const next: WorkspaceDoc = {
      ...ws,
      pendingInvites: [...pending, { email, invitedByUid: opts.ownerUid, invitedAt: ts }],
      updatedAt: ts,
    };
    const r = await replaceWorkspaceIfMatch(next, ws._etag);
    if (r === "ok") return { ok: true };
  }
  return { ok: false, reason: "conflict" };
}

/** Owner widerruft eine offene Einladung (idempotent: unbekannte E-Mail -> ok). */
export async function removePendingInvite(opts: {
  workspaceId: string;
  ownerUid: string;
  email: string;
}): Promise<InviteResult> {
  const email = opts.email.trim().toLowerCase();
  for (let attempt = 0; attempt < MAX_OCC_RETRIES; attempt++) {
    const ws = await getWorkspaceDoc(opts.workspaceId);
    if (!ws) return { ok: false, reason: "not_found" };
    if (ws.ownerUid !== opts.ownerUid) return { ok: false, reason: "not_owner" };
    const pending = ws.pendingInvites ?? [];
    if (!pending.some((p) => p.email === email)) return { ok: true }; // idempotent
    const next: WorkspaceDoc = {
      ...ws,
      pendingInvites: pending.filter((p) => p.email !== email),
      updatedAt: nowIso(),
    };
    const r = await replaceWorkspaceIfMatch(next, ws._etag);
    if (r === "ok") return { ok: true };
  }
  return { ok: false, reason: "conflict" };
}

export type RemoveMemberResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_owner" | "is_owner" | "not_member" | "conflict" };

/**
 * Owner entfernt ein Mitglied. Der Owner kann sich selbst NICHT entfernen.
 * Setzt den Cache des Entfernten auf Solo zurueck (best effort — die
 * Mitgliedschaftspruefung in resolveWorkspace ist der eigentliche Schutz).
 */
export async function removeWorkspaceMember(opts: {
  workspaceId: string;
  ownerUid: string;
  memberUid: string;
}): Promise<RemoveMemberResult> {
  for (let attempt = 0; attempt < MAX_OCC_RETRIES; attempt++) {
    const ws = await getWorkspaceDoc(opts.workspaceId);
    if (!ws) return { ok: false, reason: "not_found" };
    if (ws.ownerUid !== opts.ownerUid) return { ok: false, reason: "not_owner" };
    if (opts.memberUid === ws.ownerUid) return { ok: false, reason: "is_owner" };
    if (!ws.members.some((m) => m.uid === opts.memberUid)) return { ok: false, reason: "not_member" };
    const next: WorkspaceDoc = {
      ...ws,
      members: ws.members.filter((m) => m.uid !== opts.memberUid),
      updatedAt: nowIso(),
    };
    const r = await replaceWorkspaceIfMatch(next, ws._etag);
    if (r === "ok") {
      await setUserWorkspaceId(opts.memberUid, null, opts.memberUid); // Solo zuruecksetzen
      return { ok: true };
    }
  }
  return { ok: false, reason: "conflict" };
}

export type LeaveResult =
  | { ok: true }
  | { ok: false; reason: "not_in_team" | "owner_cannot_leave" | "conflict" };

/** Mitglied verlaesst freiwillig sein Team. Der Owner kann nicht "leaven". */
export async function leaveWorkspace(opts: { uid: string }): Promise<LeaveResult> {
  const wsId = await getWorkspaceIdForUser(opts.uid);
  if (wsId === opts.uid) return { ok: false, reason: "not_in_team" };
  for (let attempt = 0; attempt < MAX_OCC_RETRIES; attempt++) {
    const ws = await getWorkspaceDoc(wsId);
    if (!ws || !ws.members.some((m) => m.uid === opts.uid)) {
      await setUserWorkspaceId(opts.uid, null, opts.uid);
      return { ok: true };
    }
    if (ws.ownerUid === opts.uid) return { ok: false, reason: "owner_cannot_leave" };
    const next: WorkspaceDoc = {
      ...ws,
      members: ws.members.filter((m) => m.uid !== opts.uid),
      updatedAt: nowIso(),
    };
    const r = await replaceWorkspaceIfMatch(next, ws._etag);
    if (r === "ok") {
      await setUserWorkspaceId(opts.uid, null, opts.uid);
      return { ok: true };
    }
  }
  return { ok: false, reason: "conflict" };
}
