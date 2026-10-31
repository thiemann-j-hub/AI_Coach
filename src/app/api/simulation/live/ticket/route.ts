import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { kiSchalterBlockt } from "@/lib/server/credits/entitlement";
import { liveConfigured, registerLiveAccept } from "@/lib/server/live/live-accept";
import { liveVoiceFor } from "@/lib/server/live/live-voice";
import { sprachaufnahmeEinwilligungFehlt } from "@/lib/server/live/sprachaufnahme-gate";
import { liveTicketStore } from "@/lib/server/live/ticket-store";
import { getScenarioForUser } from "@/lib/server/scenario-store";
import { SIM_MAX_USER_TURNS, countUserTurns, getSimulation } from "@/lib/server/simulation-store";
import { coachLiveEnabledFor, simulationEnabled } from "@/lib/simulation/flags";
import { LIVE_WS_PATH } from "@/lib/simulation/live-protocol";
import { logger } from "@/lib/logger";

/**
 * POST /api/simulation/live/ticket — Eintrittskarte für den Sprachmodus Live (N4-231).
 *
 * Der Browser holt sich hier (mit Sitzung, wie jede API-Route) eine Einmal-Karte und öffnet
 * damit die Live-Verbindung am Server-Mantel. Alles, was Zugang entscheidet, steht HIER:
 * Simulation an, Anmeldung, Schalter COACH_LIVE für dieses Szenario, Lauf aktiv, Zeit und
 * Züge nicht erschöpft, Einwilligung „Sprachaufnahme“, Live konfiguriert.
 * Antworten, bei denen der Browser still auf die heutige Kaskade zurückfällt:
 *   404 LIVE_OFF (Schalter aus), 503 LIVE_NOT_CONFIGURED. Alles andere ist ein echter Fehler.
 * A4 (31.10.2026): Der KI-Schalter des Unternehmens kommt VOR diesen beiden — 403 KI_AUS heißt
 * „keine KI“, nicht „nimm die Kaskade“. Die laufende Sitzung prüft ihn zwischen den Zügen selbst.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  simId: z.string().min(8).max(64).regex(/^[A-Za-z0-9-]+$/),
});

export async function POST(req: NextRequest) {
  if (!simulationEnabled()) {
    return NextResponse.json({ ok: false, code: "SIMULATION_DISABLED" }, { status: 503 });
  }
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const limited = checkRateLimit(`live-ticket:${auth.uid}`, 20, 10 * 60 * 1000, "Zu viele Anfragen. Bitte kurz warten.");
  if (limited) return limited;
  const ki = await kiSchalterBlockt("/api/simulation/live/ticket");
  if (ki) return ki;

  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }
  const { simId } = parsed.data;

  const doc = await getSimulation(auth.uid, simId);
  if (!doc) return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  if (!coachLiveEnabledFor(doc.scenarioId)) {
    return NextResponse.json({ ok: false, code: "LIVE_OFF" }, { status: 404 });
  }
  if (!liveConfigured()) {
    return NextResponse.json({ ok: false, code: "LIVE_NOT_CONFIGURED" }, { status: 503 });
  }
  if (doc.status !== "active") return NextResponse.json({ ok: false, code: "ALREADY_FINISHED" }, { status: 409 });
  if (doc.closedByTime) return NextResponse.json({ ok: false, code: "TIME_UP" }, { status: 409 });
  if (countUserTurns(doc.turns) >= SIM_MAX_USER_TURNS) {
    return NextResponse.json({ ok: false, code: "TURN_LIMIT" }, { status: 409 });
  }
  const scenario = await getScenarioForUser(auth.uid, doc.scenarioId, auth.oid);
  if (!scenario) return NextResponse.json({ ok: false, code: "UNKNOWN_SCENARIO" }, { status: 410 });

  if (await sprachaufnahmeEinwilligungFehlt(auth.oid)) {
    return NextResponse.json(
      { ok: false, error: "consent_required", code: "EINWILLIGUNG", url: "/einwilligung?typ=sprachaufnahme&zurueck=/coach/simulation" },
      { status: 403 }
    );
  }

  registerLiveAccept();
  const ticket = liveTicketStore().issue({ uid: auth.uid, email: auth.email ?? null, oid: auth.oid ?? null, simId });
  logger.api("/api/simulation/live/ticket", "ok", { uid: auth.uid, simId, scenarioId: doc.scenarioId });
  return NextResponse.json(
    { ok: true, ticket, path: LIVE_WS_PATH, persona: scenario.persona.name, voice: liveVoiceFor(scenario.persona.voice, scenario.id, scenario.persona.liveVoice) },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
