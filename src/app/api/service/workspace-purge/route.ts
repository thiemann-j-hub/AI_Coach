/**
 * Go-Live Z3 Teil 2 (15.10.2026) — Dienst-zu-Dienst: Mandanten-Löschung im Coach nach Vertragsende.
 *
 *   POST /api/service/workspace-purge   (x-pn-service-secret = PN_SERVICE_SECRET)   Body { workspaceId, oids[] }
 *
 * Löscht alle Konten des Unternehmens (Kennungen aus dem Register PLUS alle Profile, deren workspaceId das
 * Unternehmen ist) über deleteAccount. Seit 12.11.2026 (S2) wird je Register-Kennung auch die abweichende
 * Nutzer-Kennung von Microsoft-Konten über das Profilfeld `entraOid` gefunden; `accountsDeleted` zählt nur Konten,
 * zu denen etwas gelöscht wurde, `accountsEmpty` die übrigen (Rollenspiele,
 * Auswertungen, Messpunkte, Sitzungen, Zähler, Token-Speicher, Profil) sowie die Firmen-Szenarien und
 * Szenario-Wünsche. Rechnungen bleiben (10 Jahre). Idempotent, fail-soft je Konto, Bericht mit Zählern.
 * Paket 2, C19 (12.11.2026): Mit jedem Firmen-Szenario geht sein Spielbuch (eigene Partition ohne Firmenkennung,
 * blieb bisher liegen); die Spielbücher privater Szenarien löscht deleteAccount mit.
 * Fail-closed ohne Geheimnis 404. Rückweg PN_SERVICE_AUTH=off → 404.
 */
import { NextRequest, NextResponse } from "next/server";
import { serviceRequestOk } from "@/lib/server/credits/cs-credential";
import { deleteAccount, etwasGeloescht, uidsFuerOid } from "@/lib/server/account-delete";
import { deleteItem, queryItems, runsContainer, usersContainer } from "@/lib/cosmos";
import { scenarioPartitionKey } from "@/lib/server/scenario-store";
import { deleteSpielbuch } from "@/lib/server/spielbuch/store";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;


export async function POST(req: NextRequest) {
  if (!serviceRequestOk(req)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { workspaceId?: unknown; oids?: unknown };
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
  if (!workspaceId || workspaceId.length > 200) return NextResponse.json({ error: "workspace_required" }, { status: 400 });
  const oids = (Array.isArray(body.oids) ? body.oids : []).filter((o): o is string => typeof o === "string" && o.length > 0 && o.length <= 200);
  const report = { accountsDeleted: 0, accountsEmpty: 0, scenariosDeleted: 0, wishesDeleted: 0, errors: [] as string[] };
  // Konten: Register-Kennungen + Profile mit dieser workspaceId (abweichende uids).
  // Nutzer-Kennung → Register-Kennung (für Token-Speicher und Messpunkte). PulseNorth-Konten: beide gleich.
  const uids = new Map<string, string>();
  for (const oid of oids) {
    try {
      for (const uid of await uidsFuerOid(oid)) uids.set(uid, oid);
    } catch (err) {
      uids.set(oid, oid);
      report.errors.push(`lookup ${oid.slice(0, 10)}…: ${(err as Error)?.message ?? err}`);
    }
  }
  try {
    const rows = await queryItems<{ id: string }>(usersContainer(), "SELECT c.id FROM c WHERE c.workspaceId = @ws", [{ name: "@ws", value: workspaceId }]);
    for (const r of rows) if (!uids.has(r.id)) uids.set(r.id, r.id);
  } catch (err) {
    report.errors.push(`users: ${(err as Error)?.message ?? err}`);
  }
  // Gezählt wird je Person (Register-Kennung), nicht je Nutzer-Kennung.
  const jePerson = new Map<string, boolean>();
  for (const [uid, oid] of uids) {
    try {
      const geloescht = await deleteAccount(uid, oid);
      jePerson.set(oid, (jePerson.get(oid) ?? false) || etwasGeloescht(geloescht));
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
  for (const gefunden of jePerson.values()) {
    if (gefunden) report.accountsDeleted++;
    else report.accountsEmpty++;
  }
  // Firmen-Szenarien (alle Zustände, auch Entwürfe)
  try {
    const pk = scenarioPartitionKey(workspaceId);
    const docs = await queryItems<{ id: string }>(runsContainer(), "SELECT c.id FROM c WHERE c.sessionId = @pk", [{ name: "@pk", value: pk }]);
    for (const d of docs) {
      await deleteItem(runsContainer(), d.id, pk);
      await deleteSpielbuch(d.id);
      report.scenariosDeleted++;
    }
  } catch (err) {
    report.errors.push(`scenarios: ${(err as Error)?.message ?? err}`);
  }
  logger.api("/api/service/workspace-purge", "done", { ws: `${workspaceId.slice(0, 8)}…`, report: JSON.stringify(report).slice(0, 400) });
  return NextResponse.json({ ok: report.errors.length === 0, ...report });
}
