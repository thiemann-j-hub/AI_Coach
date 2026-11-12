/**
 * Go-Live Z3 (15.10.2026) — Dienst-zu-Dienst: Coach-Daten einer Person löschen (Kontolebenslauf).
 *
 *   POST /api/service/anonymize   (x-pn-service-secret = PN_SERVICE_SECRET)   Body { oid }
 *
 * Löscht Rollenspiele, Auswertungen, Radar-Messpunkte, Sitzungen, Zähler, Token-Speicher und Profil
 * der Kennung (deleteAccount, R8). Für PulseNorth-Konten („ml:…“) ist die Kennung zugleich die
 * Nutzer-Kennung. Bei Microsoft-Konten schlüsselt der Coach auf den OIDC-`sub`: Seit 12.11.2026 (S2) wird die
 * Nutzer-Kennung über das Profilfeld `entraOid` gefunden; `found` sagt, ob überhaupt etwas zu löschen war.
 * Fail-closed: ohne Geheimnis 404. Rückweg PN_SERVICE_AUTH=off → 404.
 */
import { NextRequest, NextResponse } from "next/server";
import { serviceRequestOk } from "@/lib/server/credits/cs-credential";
import { deleteAccount, etwasGeloescht, uidsFuerOid } from "@/lib/server/account-delete";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


export async function POST(req: NextRequest) {
  if (!serviceRequestOk(req)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { oid?: unknown };
  const oid = typeof body.oid === "string" ? body.oid.trim() : "";
  if (!oid || oid.length > 200) return NextResponse.json({ error: "oid_required" }, { status: 400 });
  try {
    const results = [];
    for (const uid of await uidsFuerOid(oid)) results.push(await deleteAccount(uid, oid));
    const found = results.some(etwasGeloescht);
    // `result` bleibt für den Aufrufer wie bisher ein Objekt: die Summe über alle Nutzer-Kennungen der Person.
    const result = {
      runsDeleted: results.reduce((n, r) => n + r.runsDeleted, 0),
      measurementsDeleted: results.reduce((n, r) => n + r.measurementsDeleted, 0),
      sessionsDeleted: results.reduce((n, r) => n + r.sessionsDeleted, 0),
      usageDeleted: results.reduce((n, r) => n + r.usageDeleted, 0),
      tokenStoreDeleted: results.some((r) => r.tokenStoreDeleted),
      profileDeleted: results.some((r) => r.profileDeleted),
    };
    logger.api("/api/service/anonymize", "done", { oid: `${oid.slice(0, 8)}…`, found, result: JSON.stringify(result).slice(0, 300) });
    return NextResponse.json({ ok: true, found, result });
  } catch (err) {
    logger.apiError("/api/service/anonymize", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
