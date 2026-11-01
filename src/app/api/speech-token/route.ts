import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { kiSchalterBlockt } from "@/lib/server/credits/entitlement";
import { sprachaufnahmeEinwilligungFehlt } from "@/lib/server/live/sprachaufnahme-gate";

/**
 * GET /api/speech-token — kurzlebiges Token für die Spracheingabe über Azure Speech (West-Europa).
 *
 * EU-Hosting Weg B (Owner-GO 11.10.2026, N4-138): Vorher wandelte der Browser die Stimme um und
 * schickte die Aufnahme an seinen Hersteller (Chrome: Google). Jetzt erkennt Azure Speech in
 * unserer Region; der Browser bekommt nur ein Token für zehn Minuten, nie den Schlüssel.
 * Rückweg: SPEECH_INPUT=browser → 503 mit mode "browser", der Browser nimmt seine eigene Erkennung.
 * 01.11.2026 (Bewertung Teil 1, Owner-Ja): NUR dieser Rückweg wählt die Browser-Erkennung. Fehlen Schlüssel oder
 * Region (503 ohne mode), scheitert der Abruf (502) oder greift das Rate-Limit (429), bleibt es beim Fehler — der
 * Browser schickte die Aufnahme sonst an seinen Hersteller (Chrome: Google), das deckt die Einwilligung nicht.
 * A4 (31.10.2026): Ist die KI für das Unternehmen aus, gibt es kein Token (403 KI_AUS) — geprüft vor dem 503,
 * damit der Browser dann NICHT auf seine eigene Erkennung zurückfällt.
 * 01.11.2026 (Bewertung Teil 1, Owner-Ja): Dasselbe gilt jetzt für die Einwilligung „Sprachaufnahme“ — sie wird
 * VOR dem 503 und vor dem Rate-Limit geprüft (403 EINWILLIGUNG statt Browser-Erkennung ohne Einwilligung).
 */
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const ki = await kiSchalterBlockt("/api/speech-token");
  if (ki) return ki;
  // Stufe C / LXT W5-4 (20.10.2026): Ohne Einwilligung „Sprachaufnahme“ gibt es kein Token, und der Browser fällt
  // NICHT auf seine eigene Erkennung zurück (Antwort-Code EINWILLIGUNG öffnet im Coach den Hinweis).
  // 01.11.2026 (Bewertung Teil 1, Owner-Ja): Die Prüfung steht jetzt VOR dem 503 stt_disabled und vor dem
  // Rate-Limit — auf beide Antworten nahm der Browser seine eigene Erkennung (Chrome schickt die Aufnahme an
  // Google), auch ohne Einwilligung. Dasselbe Tor wie vor der Live-Karte (sprachaufnahme-gate.ts). Owner 01.11.2026
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
  const browser = (process.env.SPEECH_INPUT ?? "").trim().toLowerCase() === "browser";
  if (!key || !region || browser) {
    return NextResponse.json({ ok: false, error: "stt_disabled", ...(browser ? { mode: "browser" } : {}) }, { status: 503 });
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
      console.error(`[speech-token] upstream ${res.status}`);
      return NextResponse.json({ ok: false, error: "stt_unavailable" }, { status: 502 });
    }
    const token = await res.text();
    return NextResponse.json(
      { ok: true, token, region, expiresInSec: 540 },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (e) {
    console.error("[speech-token]", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "stt_unavailable" }, { status: 502 });
  }
}
