import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { consentGateOn } from "@/lib/server/credits/member-info";

/**
 * GET /api/speech-token — kurzlebiges Token für die Spracheingabe über Azure Speech (West-Europa).
 *
 * EU-Hosting Weg B (Owner-GO 11.10.2026, N4-138): Vorher wandelte der Browser die Stimme um und
 * schickte die Aufnahme an seinen Hersteller (Chrome: Google). Jetzt erkennt Azure Speech in
 * unserer Region; der Browser bekommt nur ein Token für zehn Minuten, nie den Schlüssel.
 * Rückweg: SPEECH_INPUT=browser → 503, der Browser fällt auf seine eigene Erkennung zurück.
 */
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region || (process.env.SPEECH_INPUT ?? "").trim().toLowerCase() === "browser") {
    return NextResponse.json({ ok: false, error: "stt_disabled" }, { status: 503 });
  }
  const limited = checkRateLimit(`stt-token:${auth.uid}`, 30, 10 * 60 * 1000, "Zu viele Anfragen. Bitte kurz warten.");
  if (limited) return limited;
  // Stufe C / LXT W5-4 (20.10.2026): Verlangt das Unternehmen die Einwilligung „Sprachaufnahme“, gibt es ohne sie
  // kein Token — und der Browser fällt NICHT auf seine eigene Erkennung zurück (Antwort-Code EINWILLIGUNG).
  // Rückweg: CONSENT_GATE=off.
  if (consentGateOn()) {
    try {
      const { auth: session } = await import("@/auth");
      const oid = ((await session())?.user as { oid?: string } | undefined)?.oid;
      if (oid) {
        const { getCentralMemberInfo, einwilligungFehlt } = await import("@/lib/server/credits/member-info");
        if (einwilligungFehlt(await getCentralMemberInfo(oid), "sprachaufnahme")) {
          return NextResponse.json({ ok: false, error: "consent_required", code: "EINWILLIGUNG", url: "/einwilligung?typ=sprachaufnahme&zurueck=/coach/simulation" }, { status: 403 });
        }
      }
    } catch (e) {
      console.error("[speech-token] einwilligung", e instanceof Error ? e.message : e);
    }
  }
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
