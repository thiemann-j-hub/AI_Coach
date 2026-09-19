import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  AzureTtsError,
  TTS_MAX_CHARS,
  azureTtsConfigured,
  isPersonaVoice,
  synthesizeTtsMp3,
} from "@/lib/server/azure-tts";
import { DEFAULT_PERSONA_VOICE } from "@/lib/simulation/types";

/**
 * POST /api/tts — Persona-Antwort als Azure-HD-Sprache (Owner-GO 19.09.2026).
 * Body: { text, voice?, locale? } → audio/mpeg. Ehrliche Reihenfolge:
 * Auth → Konfig-Check (503, Client fällt auf die Browserstimme zurück) →
 * Rate-Limit je Konto → Eingabe-Grenzen → Azure. Kein Credit-Charge: die
 * Stimme ist im Preis des Laufs enthalten (Owner-Entscheid), die Zeichen-
 * Obergrenze je Call und das Limit je Konto deckeln die Kosten.
 */
export const runtime = "nodejs";

const LOCALES = new Set(["de", "en", "es", "fr"]);

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  if (!azureTtsConfigured()) {
    return NextResponse.json({ ok: false, error: "tts_not_configured" }, { status: 503 });
  }

  // 60 Antworten je 10 Minuten und Konto — mehr spricht kein Rollenspiel.
  const limited = checkRateLimit(`tts:${auth.uid}`, 60, 10 * 60 * 1000, "Zu viele Sprachanfragen. Bitte kurz warten.");
  if (limited) return limited;

  let body: { text?: unknown; voice?: unknown; locale?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ ok: false, error: "text_required" }, { status: 400 });
  if (text.length > TTS_MAX_CHARS) {
    return NextResponse.json({ ok: false, error: "text_too_long", max: TTS_MAX_CHARS }, { status: 413 });
  }
  const voice = isPersonaVoice(body.voice) ? body.voice : DEFAULT_PERSONA_VOICE;
  const locale = typeof body.locale === "string" && LOCALES.has(body.locale) ? body.locale : "de";

  try {
    const mp3 = await synthesizeTtsMp3({ text, voice, locale });
    return new NextResponse(Buffer.from(mp3), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(mp3.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof AzureTtsError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    console.error("[api/tts] unexpected:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "tts_failed" }, { status: 502 });
  }
}
