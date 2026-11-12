import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { kiSchalterBlockt } from "@/lib/server/credits/entitlement";
import { sprachaufnahmeEinwilligungFehlt } from "@/lib/server/live/sprachaufnahme-gate";
import { logger } from "@/lib/logger";

/**
 * GET /api/speech-token — kurzlebiges Token für die Spracheingabe über Azure Speech (West-Europa).
 *
 * EU-Hosting Weg B (Owner-GO 11.10.2026, N4-138): Vorher wandelte der Browser die Stimme um und
 * schickte die Aufnahme an seinen Hersteller (Chrome: Google). Jetzt erkennt Azure Speech in
 * unserer Region; der Browser bekommt nur ein Token für zehn Minuten, nie den Schlüssel.
 * Paket 6, C31 und C33 (12.11.2026): Die Erkennung des Browsers ist entfernt, samt ihrem Rückweg
 * SPEECH_INPUT=browser. Fehlen Schlüssel oder Region (503), scheitert der Abruf (502) oder greift das Rate-Limit
 * (429), bleibt es beim Fehler: Mikrofon aus, Tippen geht weiter.
 * A4 (31.10.2026): Ist die KI für das Unternehmen aus, gibt es kein Token (403 KI_AUS) — geprüft vor dem 503.
 * 01.11.2026 (Bewertung Teil 1, Owner-Ja): Dasselbe gilt für die Einwilligung „Sprachaufnahme“ — sie wird
 * VOR dem 503 und vor dem Rate-Limit geprüft (403 EINWILLIGUNG).
 */
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const ki = await kiSchalterBlockt("/api/speech-token");
  if (ki) return ki;
  // Stufe C / LXT W5-4 (20.10.2026): Ohne Einwilligung „Sprachaufnahme“ gibt es kein Token (Antwort-Code
  // EINWILLIGUNG öffnet im Coach den Hinweis).
  // 01.11.2026 (Bewertung Teil 1, Owner-Ja): Die Prüfung steht VOR dem 503 stt_disabled und vor dem Rate-Limit.
  // Dasselbe Tor wie vor der Live-Karte (sprachaufnahme-gate.ts). Owner 01.11.2026
  // („nicht übertreiben“): Der Credit-Dienst verlangt die Bestätigung nicht mehr — das Tor greift nur, falls sie wieder
  // verlangt wird; vor dem ersten Mikrofon zeigt der Coach seinen Hinweis. Rückweg: CONSENT_GATE=off.
  if (await sprachaufnahmeEinwilligungFehlt(auth.oid)) {
    return NextResponse.json(
      { ok: false, error: "consent_required", code: "EINWILLIGUNG", url: "/einwilligung?typ=sprachaufnahme&zurueck=/coach/simulation" },
      { status: 403 }
    );
  }
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) {
    return NextResponse.json({ ok: false, error: "stt_disabled" }, { status: 503 });
  }
  const limited = checkRateLimit(`stt-token:${auth.uid}`, 30, 10 * 60 * 1000, "Zu viele Anfragen. Bitte kurz warten.");
  if (limited) return limited;
  try {
    const res = await fetch(`https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": key, "Content-Length": "0" },
      cache: "no-store",
    });
    if (!res.ok) {
      logger.error("[speech-token] upstream", { route: "/api/speech-token", status: res.status });
      return NextResponse.json({ ok: false, error: "stt_unavailable" }, { status: 502 });
    }
    const token = await res.text();
    return NextResponse.json(
      { ok: true, token, region, expiresInSec: 540 },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (e) {
    logger.apiError("/api/speech-token", e);
    return NextResponse.json({ ok: false, error: "stt_unavailable" }, { status: 502 });
  }
}
