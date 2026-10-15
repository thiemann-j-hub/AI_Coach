/**
 * Go-Live Z3 Teil 2 (15.10.2026) — Dienst-zu-Dienst: Mandanten-Löschung im Coach nach Vertragsende.
 *
 *   POST /api/service/workspace-purge   (x-pn-service-secret = PN_SERVICE_SECRET)   Body { workspaceId, oids[] }
 *
 * Löscht alle Konten des Unternehmens (Kennungen aus dem Register PLUS alle Profile, deren workspaceId das
 * Unternehmen ist — deckt auch Microsoft-Konten mit abweichender uid) über deleteAccount (Rollenspiele,
 * Auswertungen, Messpunkte, Sitzungen, Zähler, Token-Speicher, Profil) sowie die Firmen-Szenarien und
 * Szenario-Wünsche. Rechnungen bleiben (10 Jahre). Idempotent, fail-soft je Konto, Bericht mit Zählern.
 * Fail-closed ohne Geheimnis 404. Rückweg PN_SERVICE_AUTH=off → 404.
 */
import { NextRequest, NextResponse } from "next/server";
import { serviceRequestOk } from "@/lib/server/credits/cs-credential";
import { deleteAccount } from "@/lib/server/account-delete";
import { deleteItem, queryItems, runsContainer, usersContainer } from "@/lib/cosmos";
import { scenarioPartitionKey } from "@/lib/server/scenario-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;


export async function POST(req: NextRequest) {
  if (!serviceRequestOk(req)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { workspaceId?: unknown; oids?: unknown };
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
  if (!workspaceId || workspaceId.length > 200) return NextResponse.json({ error: "workspace_required" }, { status: 400 });
  const oids = (Array.isArray(body.oids) ? body.oids : []).filter((o): o is string => typeof o === "string" && o.length > 0 && o.length <= 200);
  const report = { accountsDeleted: 0, scenariosDeleted: 0, wishesDeleted: 0, errors: [] as string[] };
  // Konten: Register-Kennungen + Profile mit dieser workspaceId (abweichende uids).
  const uids = new Set<string>(oids);
  try {
    const rows = await queryItems<{ id: string }>(usersContainer(), "SELECT c.id FROM c WHERE c.workspaceId = @ws", [{ name: "@ws", value: workspaceId }]);
    for (const r of rows) uids.add(r.id);
  } catch (err) {
    report.errors.push(`users: ${(err as Error)?.message ?? err}`);
  }
  for (const uid of uids) {
    try {
      await deleteAccount(uid, uid);
      report.accountsDeleted++;
      // Szenario-Wünsche der Person (runs, Partition wish:<uid>)
      const wishes = await queryItems<{ id: string }>(runsContainer(), "SELECT c.id FROM c WHERE c.sessionId = @pk", [{ name: "@pk", value: `wish:${uid}` }]);
      for (const w of wishes) {
        await deleteItem(runsContainer(), w.id, `wish:${uid}`);
        report.wishesDeleted++;
      }
    } catch (err) {
      report.errors.push(`account ${uid.slice(0, 10)}…: ${(err as Error)?.message ?? err}`);
    }
  }
  // Firmen-Szenarien (alle Zustände, auch Entwürfe)
  try {
    const pk = scenarioPartitionKey(workspaceId);
    const docs = await queryItems<{ id: string }>(runsContainer(), "SELECT c.id FROM c WHERE c.sessionId = @pk", [{ name: "@pk", value: pk }]);
    for (const d of docs) {
      await deleteItem(runsContainer(), d.id, pk);
      report.scenariosDeleted++;
    }
  } catch (err) {
    report.errors.push(`scenarios: ${(err as Error)?.message ?? err}`);
  }
  console.log(`[service/workspace-purge] ws=${workspaceId.slice(0, 8)}… ${JSON.stringify(report).slice(0, 400)}`);
  return NextResponse.json({ ok: report.errors.length === 0, ...report });
}
