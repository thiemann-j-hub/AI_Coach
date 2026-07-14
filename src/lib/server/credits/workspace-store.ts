import "server-only";

import { readItem, usersContainer, workspacesContainer } from "@/lib/cosmos";
import { WorkspaceDoc } from "./types";

/**
 * Workspace-LESE-Helfer.
 *
 * KK-1 (Go-Live-Blueprint): Der lokale Geld-Stack (FIFO-Ledger, Stripe-Checkout,
 * Free-Run-/Team-Claims) wurde abgebaut — Prod laeuft auf CREDITS_CENTRAL=on,
 * Wallet/Grants/Refunds leben im zentralen CreditService. Uebrig bleiben hier
 * nur die Read-only-Helfer, die die Rechnungs-Lese-Routen und runs/save weiter
 * brauchen.
 */

/** Read-only: workspaceId des Users (Solo-Default = uid), ohne Anlage/Grant-Seiteneffekt. */
export async function getWorkspaceIdForUser(uid: string): Promise<string> {
  const userDoc = await readItem<{ id: string; workspaceId?: string }>(usersContainer(), uid, uid);
  return userDoc?.workspaceId || uid;
}

/**
 * Liest das Workspace-Stammdokument (id === workspaceId, pk /workspaceId).
 *
 * Hierher aus dem geloeschten ledger.ts verschoben (KK-1): der lokale Ledger ist
 * tot, aber der Membership-Check der Rechnungs-Route /api/invoices/[id] braucht
 * weiterhin das members[]-Array des Workspace-Docs (coach/invoices ist der
 * ZENTRALE Rechnungs-Store, Zugriff nur fuer Workspace-Mitglieder).
 */
export async function getWorkspaceDoc(workspaceId: string): Promise<WorkspaceDoc | null> {
  return readItem<WorkspaceDoc>(workspacesContainer(), workspaceId, workspaceId);
}
