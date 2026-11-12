import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getApiMessages } from "@/lib/server/get-request-locale";
import { checkAndConsumeBudget, estimateTokens } from "@/lib/server/cost-cap";
import { creditGateEnabled, type EntitlementGrant } from "@/lib/server/credits/entitlement";
import { simulationEnabled } from "@/lib/simulation/flags";
import { getScenarioForUser } from "@/lib/server/scenario-store";
import {
  assembleTranscript,
  countUserTurns,
  getSimulation,
  type SimulationDoc,
} from "@/lib/server/simulation-store";
import { chargeFinish, claimFinish, claimFreeFinish, revertFinish } from "@/lib/server/simulation-finish";
import { startFinishJob } from "@/lib/server/simulation-finish-job";
import { aiErrorResponse, requestIdOf } from "@/lib/server/request-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Paket 3 (12.11.2026): Die Route antwortet sofort (vorher 180 s). Die Rechnung läuft danach als Auftrag im
// dauerhaften Node-Prozess weiter und zählt nicht zu dieser Frist.
export const maxDuration = 30;

/** Mindestens so viele eigene Beiträge, bevor eine Auswertung sinnvoll (und bezahlbar) ist. */
const MIN_USER_TURNS = 3;

// Paket 3, S8: Der Körper nimmt kein `selfAssessment` mehr — der Check-in hat seine eigene Route
// (/api/simulation/checkin) und läuft, während hier schon gerechnet wird.
const requestSchema = z.object({
  simId: z
    .string()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9-]+$/),
});

/**
 * Antwort für einen Lauf, der nicht (mehr) aktiv ist — nur der Status, nie eine Buchung. Das Ergebnis selbst
 * holt die Auswertungsseite über GET /api/simulation/get.
 *   `finishing` → 202 (die Auswertung rechnet schon: zweiter Klick, zweiter Tab)
 *   `finished`  → 200
 *   `aborted`   → 409 ABORTED (Paket 2, C3: ein abgebrochener Lauf hat keine Auswertung)
 */
function statusResponse(doc: SimulationDoc): NextResponse {
  if (doc.status === "finishing") return NextResponse.json({ ok: true, status: "finishing" }, { status: 202 });
  if (doc.status === "finished") return NextResponse.json({ ok: true, status: "finished" });
  if (doc.status === "aborted") return NextResponse.json({ ok: false, code: "ABORTED" }, { status: 409 });
  // Der Anspruch ging zwischen zwei Schritten verloren und der Lauf ist wieder aktiv: neu versuchen.
  return NextResponse.json({ ok: false, code: "FINISH_CONFLICT" }, { status: 409 });
}

/**
 * POST: Auswertung der Simulation STARTEN. Kostet 1 Credit (spiegelt /api/analyze), antwortet sofort.
 *
 * Paket 3 (12.11.2026, C4 „Auswertung als Auftrag mit Status“, U12/S7): Die Rechnung läuft als Auftrag neben der
 * Antwort, während die Person den Check-in beantwortet; die Auswertungsseite fragt GET /api/simulation/status ab.
 * Die Schritte liegen in `@/lib/server/simulation-finish` und `simulation-finish-job`:
 *   1. Lauf lesen und prüfen (Status, genug Züge, Szenario, Tagesbudget).
 *   2. Anspruch sichern: `active` → `finishing`, mit Versionsprüfung. Von zwei Klicks oder zwei Tabs gewinnt genau
 *      einer; der andere bekommt 202 und bucht nichts.
 *   3. Freier Testlauf des Szenarios (Entscheid 5)? Dann keine Buchung. Sonst buchen: offene Buchung am Lauf
 *      vermerken, dann 1 Credit mit der Kennung `sim-finish:<simId>:<n>` (n = bisherige Rückbuchungen am Lauf).
 *      Lehnt das Tor ab (402, 401, 403, 503), geht der Lauf zurück auf `active`, und die Antwort ist die des Tors.
 *   4. Auftrag starten (nicht abwarten) → 202 `{ ok: true, status: "finishing" }`.
 * Der Auftrag rechnet (Richter ohne Selbstbild), speichert (`finished`) und schließt die Buchung ab. Scheitert er:
 * Rückbuchung, zurück auf `active`, `finishError` am Lauf — die Auswertungsseite bietet „Noch einmal auswerten“ an.
 */
export async function POST(req: NextRequest) {
  if (!simulationEnabled()) {
    return NextResponse.json(
      { ok: false, code: "SIMULATION_DISABLED" },
      { status: 503 }
    );
  }
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  // Paket 2, C5: Begrenzung je Person statt je Adresse (hinter einer Firmenadresse teilten sich alle drei Auswertungen pro Minute).
  const rl = checkRateLimit(`sim-finish:${auth.uid}`, 3, 60_000, getApiMessages(req).rateLimited);
  if (rl) return rl;

  // Der gesicherte Anspruch dieser Anfrage und was an ihm hängt; null = nichts zurückzustellen.
  let offen: { simId: string; since: string; scenarioId: string; grant: EntitlementGrant | null; refunds: number; free: boolean } | null = null;

  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const simId = parsed.data.simId;
    const doc = await getSimulation(auth.uid, simId);
    if (!doc) {
      return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
    }
    if (doc.status !== "active") return statusResponse(doc);
    if (countUserTurns(doc.turns) < MIN_USER_TURNS) {
      return NextResponse.json(
        { ok: false, code: "NOT_ENOUGH_TURNS", minUserTurns: MIN_USER_TURNS },
        { status: 400 }
      );
    }
    const scenario = await getScenarioForUser(auth.uid, doc.scenarioId, auth.oid);
    if (!scenario) {
      return NextResponse.json({ ok: false, code: "UNKNOWN_SCENARIO" }, { status: 410 });
    }

    const budget = await checkAndConsumeBudget({
      uid: auth.uid,
      email: auth.email,
      estimatedTokens: estimateTokens(assembleTranscript(doc.turns, scenario.persona.name)),
    });
    if (!budget.allowed && budget.response) return budget.response;

    // Anspruch sichern (C4): Nur wer ihn gewinnt, bucht und rechnet. Der Verlierer eines Rennens sieht `finishing`.
    const claim = await claimFinish(auth.uid, simId);
    if (claim.state === "missing") {
      return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
    }
    if (claim.state === "taken") return statusResponse(claim.doc);
    const { since } = claim;
    offen = { simId, since, scenarioId: claim.doc.scenarioId, grant: null, refunds: 0, free: false };

    // Point-of-Sale VOR den teuren LLM-Calls (wie /api/analyze) — außer beim freien Testlauf (Entscheid 5).
    if (creditGateEnabled()) {
      const frei = await claimFreeFinish({ uid: auth.uid, oid: auth.oid, simId, since, doc: claim.doc });
      if (frei.free) {
        offen.free = true;
      } else if (frei.ended) {
        offen = null;
        return statusResponse(frei.ended);
      } else {
        const c = await chargeFinish({ uid: auth.uid, email: auth.email, simId, since });
        if (!c.ok) {
          const zurueck = offen;
          offen = null;
          if ("ended" in c) return statusResponse(c.ended);
          // Buchung abgelehnt: zurück auf `active`, ohne `finishError` — den Grund trägt die Antwort (402 usw.).
          await revertFinish({ uid: auth.uid, oid: auth.oid, ...zurueck, error: null });
          return c.response;
        }
        offen.grant = c.grant;
        offen.refunds = c.refunds;
      }
    }

    // Auftrag neben der Antwort starten: rechnen, speichern, abschließen (simulation-finish-job.ts).
    const job = offen;
    offen = null; // ab hier gehört der Anspruch dem Auftrag
    startFinishJob({ uid: auth.uid, oid: auth.oid, doc: claim.doc, scenario, requestId: requestIdOf(req), ...job });
    return NextResponse.json({ ok: true, status: "finishing" }, { status: 202 });
  } catch (err) {
    // Fehler zwischen Anspruch und Auftrag: Buchung zurück (oder Freilauf), Lauf zurück auf `active`.
    if (offen) await revertFinish({ uid: auth.uid, oid: auth.oid, ...offen, error: null });
    // W1-1/W1-2: KI-Fehlerart + Fehler-Nr. statt „Internal server error“ (Rückweg AI_ERROR_CONTRACT=off).
    return aiErrorResponse(err, req, "/api/simulation/finish");
  }
}
