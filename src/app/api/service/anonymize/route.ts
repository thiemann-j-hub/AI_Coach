/**
 * Go-Live Z3 (15.10.2026) — Dienst-zu-Dienst: Coach-Daten einer Person löschen (Kontolebenslauf).
 *
 *   POST /api/service/anonymize   (x-pn-service-secret = PN_SERVICE_SECRET)   Body { oid }
 *
 * Löscht Rollenspiele, Auswertungen, Radar-Messpunkte, Sitzungen, Zähler, Token-Speicher und Profil
 * der Kennung (deleteAccount, R8). Für PulseNorth-Konten („ml:…“) ist die Kennung zugleich die
 * Nutzer-Kennung; für Microsoft-Konten gilt dasselbe, wenn die Sitzung die Entra-oid als Kennung
 * trägt — sonst bleibt die Person auf die Selbst-Löschung in den Einstellungen verwiesen.
 * Fail-closed: ohne Geheimnis 404. Rückweg PN_SERVICE_AUTH=off → 404.
 */
import { NextRequest, NextResponse } from "next/server";
import { serviceRequestOk } from "@/lib/server/credits/cs-credential";
import { deleteAccount } from "@/lib/server/account-delete";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


export async function POST(req: NextRequest) {
  if (!serviceRequestOk(req)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { oid?: unknown };
  const oid = typeof body.oid === "string" ? body.oid.trim() : "";
  if (!oid || oid.length > 200) return NextResponse.json({ error: "oid_required" }, { status: 400 });
  try {
    const result = await deleteAccount(oid, oid);
    console.log(`[service/anonymize] oid=${oid.slice(0, 8)}… result=${JSON.stringify(result).slice(0, 300)}`);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[service/anonymize]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
