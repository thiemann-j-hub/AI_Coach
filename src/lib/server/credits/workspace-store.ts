import "server-only";

import {
  domainsContainer,
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

  // 1) Existiert der User bereits mit zugewiesenem Workspace? (Team-Faelle)
  const userDoc = await readItem<UserDocLite>(usersContainer(), uid, uid);
  const workspaceId = userDoc?.workspaceId || uid; // Solo-Default

  let ws = await getWorkspaceDoc(workspaceId);

  if (!ws) {
    ws = await createSoloWorkspace({ uid, email });
    // Free-Run-Grant nur fuer den frisch angelegten Solo-Workspace
    await tryGrantFreeRun({ workspaceId: ws.workspaceId, uid, email });
    // Saldo nach Grant neu lesen
    ws = (await getWorkspaceDoc(ws.workspaceId)) ?? ws;
  } else {
    // Lazy Reconciliation: abgelaufene Holds dieser Partition zuruckbuchen
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
  // Claim gewonnen -> Gratis-Credit gutschreiben
  await grantCredits({ workspaceId, amount: 1, source: "free", expiresInMonths: 12 });
  return { granted: true };
}

/** Read-only: workspaceId des Users (Solo-Default = uid), ohne Anlage/Grant-Seiteneffekt. */
export async function getWorkspaceIdForUser(uid: string): Promise<string> {
  const userDoc = await readItem<UserDocLite>(usersContainer(), uid, uid);
  return userDoc?.workspaceId || uid;
}

/** Fuegt ein Mitglied hinzu (max 3 inkl. Owner). Read-Modify-Upsert genuegt: nur Owner mutiert. */
export async function addWorkspaceMember(opts: {
  workspaceId: string;
  member: { uid: string; email: string };
}): Promise<{ ok: boolean; reason?: "full" | "exists" | "not_found" }> {
  const { workspaceId, member } = opts;
  const ws = await getWorkspaceDoc(workspaceId);
  if (!ws) return { ok: false, reason: "not_found" };
  if (ws.members.some((m) => m.uid === member.uid)) return { ok: false, reason: "exists" };
  if (ws.members.length >= MAX_WORKSPACE_MEMBERS) return { ok: false, reason: "full" };
  ws.members.push({ uid: member.uid, email: member.email, role: "member", addedAt: new Date().toISOString() });
  ws.updatedAt = new Date().toISOString();
  await upsertItem(workspacesContainer(), ws);
  return { ok: true };
}
