import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getApiMessages } from "@/lib/server/get-request-locale";
import { checkAndConsumeBudget, estimateTokens } from "@/lib/server/cost-cap";
import { creditGateEnabled, settleEntitlement } from "@/lib/server/credits/entitlement";
import { emitCoachMeasurement } from "@/lib/server/radar-emit";
import {
  simulationEnabled,
  simulationRadarEmitEnabled,
} from "@/lib/simulation/flags";
import { getScenarioForUser } from "@/lib/server/scenario-store";
import {
  assembleTranscript,
  countUserTurns,
  getSimulation,
  type SimulationDoc,
} from "@/lib/server/simulation-store";
import {
  chargeFinish,
  evaluateSimulation,
  refundFinishCharge,
  storeEvaluation,
  type FinishCharge,
} from "@/lib/server/simulation-finish";
import { logger } from "@/lib/logger";
import { aiErrorResponse } from "@/lib/server/request-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** Mindestens so viele eigene Beiträge, bevor eine Auswertung sinnvoll (und bezahlbar) ist. */
const MIN_USER_TURNS = 3;

const requestSchema = z.object({
  simId: z
    .string()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9-]+$/),
  /**
   * Welle A1: Selbsteinschätzung aus dem Coaching-Check-in — optional
   * (Überspringen ist gleichwertig). Serverseitiger Deckel spiegelt den
   * Client (500) mit Luft für Diktat-Ausreißer.
   */
  selfAssessment: z.string().trim().max(600).optional(),
});

/**
 * Antwort für einen Lauf, der nicht (mehr) aktiv ist. Ausgewertet → das vorhandene Ergebnis, idempotent lesbar,
 * nichts gebucht. Abgebrochen → saubere Ablehnung (Paket 2, C3): ein abgebrochener Lauf hat keine Auswertung;
 * vorher kam hier „schon ausgewertet“ mit leerem Ergebnis.
 */
function endedResponse(doc: SimulationDoc): NextResponse {
  if (doc.status === "aborted") {
    return NextResponse.json({ ok: false, code: "ABORTED" }, { status: 409 });
  }
  return NextResponse.json({
    ok: true,
    alreadyFinished: true,
    feedback: doc.feedbackJson ?? null,
    competencyRatings: doc.competencyRatings ?? null,
    competencyError: doc.competencyError ?? null,
    debrief: doc.debriefJson ?? null,
    delta: doc.deltaJson ?? null,
    attempt: doc.attempt ?? 1,
    focus: doc.focus ?? null,
    selfAssessment: doc.selfAssessment ?? null,
    mode: doc.mode ?? "practice",
    hardness: doc.hardness ?? "standard",
  });
}

/**
 * POST: Simulation beenden und auswerten. Kostet 1 Credit (spiegelt /api/analyze).
 *
 * Reihenfolge seit Paket 2 (12.11.2026); die Schritte liegen in `@/lib/server/simulation-finish`:
 *   1. Lauf lesen und prüfen (aktiv, genug Züge, Szenario, Tagesbudget).
 *   2. Buchen: offene Buchung am Lauf vermerken, dann 1 Credit mit der Kennung `sim-finish:<simId>:<n>`
 *      (n = bisherige Rückbuchungen am Lauf). Ein zweiter Klick oder ein zweiter Tab trifft dieselbe Buchung
 *      statt einer zweiten (vorher: frische Kennung je Anfrage, doppelter Credit möglich).
 *   3. Auswerten (Richter, Kompetenzen, Zitatprüfung, Rechnung) — schreibt nichts.
 *   4. Speichern auf den FRISCHEN Lauf, nur wenn er noch aktiv ist; der Vermerk wird im selben Schreibvorgang
 *      ausgetragen. Persistenz VOR settle: Credit verbraucht ⇒ Auswertung existiert.
 *   5. Zurückbuchen bei jedem Fehler und wenn der Lauf inzwischen von anderer Stelle beendet wurde — außer die
 *      gespeicherte Auswertung trägt genau diese Buchung. Scheitert die Rückbuchung, bleibt der Vermerk stehen.
 * Das Antwortformat ist unverändert. Der Status „wird ausgewertet“ mit Abfrage kommt mit Paket 3 (C4, zweiter Teil).
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

  let simId = "";
  // Die Buchung dieser Anfrage; null = nichts (mehr) zurückzugeben.
  let charge: Extract<FinishCharge, { ok: true }> | null = null;

  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 }
      );
    }
    simId = parsed.data.simId;
    const selfAssessment = parsed.data.selfAssessment || undefined;
    const doc = await getSimulation(auth.uid, simId);
    if (!doc) {
      return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
    }
    if (doc.status !== "active") return endedResponse(doc);
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

    // Point-of-Sale VOR den teuren LLM-Calls (wie /api/analyze).
    if (creditGateEnabled()) {
      const c = await chargeFinish({ uid: auth.uid, email: auth.email, simId });
      if (!c.ok) return "ended" in c ? endedResponse(c.ended) : c.response;
      charge = c;
    }

    const evaluation = await evaluateSimulation({ uid: auth.uid, doc, scenario, selfAssessment });

    // Speichern auf den frischen Lauf (C3). Höchstens ein zweiter Durchgang: wenn ein paralleler Versuch die
    // gemeinsame Buchung inzwischen zurückgegeben hat, wird einmal neu gebucht.
    let stored: SimulationDoc | null = null;
    for (let runde = 0; !stored; runde++) {
      const s = await storeEvaluation({
        uid: auth.uid,
        simId,
        evaluation,
        selfAssessment,
        grant: charge?.grant ?? null,
        refunds: charge?.refunds ?? 0,
      });
      if (s.state === "stored") {
        stored = s.doc;
      } else if (s.state === "refunded") {
        charge = null;
        if (runde >= 1) throw new Error("simulation finish: Buchung wurde zweimal von anderer Stelle zurückgegeben");
        const again = await chargeFinish({ uid: auth.uid, email: auth.email, simId });
        if (!again.ok) return "ended" in again ? endedResponse(again.ended) : again.response;
        charge = again;
      } else {
        // Der Lauf wurde während der Rechnung von anderer Stelle beendet, abgebrochen oder gelöscht: nichts
        // überschreiben, die eigene Buchung zurückgeben, das Vorhandene ausliefern.
        const open = charge;
        charge = null;
        if (open) await refundFinishCharge({ uid: auth.uid, simId, grant: open.grant, refunds: open.refunds });
        logger.api("/api/simulation/finish", "ended-elsewhere", { simId, state: s.state === "ended" ? s.doc.status : "missing" });
        return s.state === "ended"
          ? endedResponse(s.doc)
          : NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
      }
    }

    const grant = charge?.grant ?? null;
    charge = null; // ab hier ist der Credit durch die gespeicherte Auswertung gedeckt
    if (grant) await settleEntitlement(grant);

    const { feedback, competencyRatings, competencyError, debrief, delta } = evaluation;

    // Radar-Messpunkt nur mit doppeltem Opt-in (RADAR_EMIT im Emitter +
    // SIMULATION_RADAR_EMIT hier) — Owner-Entscheid offen (Blueprint §6 SIM-2).
    if (grant && simulationRadarEmitEnabled()) {
      try {
        const weightByKey = new Map(scenario.assessment.competencies.map((c) => [c.key, c.weight]));
        void emitCoachMeasurement({
          workspaceId: grant.workspaceId,
          subjectId: auth.oid ?? "",
          runId: stored.id,
          createdAt: stored.finishedAt ?? new Date().toISOString(),
          competencyRatings,
          // Welle 5: Anker je Fähigkeit (Stufe, Gewicht), Szenario und Urteil — Datenbasis des Team-Bilds im Hub.
          rubric: feedback.rubric.map((r) => ({ ...r, weight: weightByKey.get(r.key) })),
          szenarioId: scenario.id,
          bestanden: debrief.verdict === "passed" ? true : debrief.verdict === "failed" ? false : null,
        }).catch((e) =>
          logger.apiError("/api/simulation/finish/radar", e, { simId })
        );
      } catch (e) {
        logger.apiError("/api/simulation/finish/radar", e, { simId });
      }
    }

    // CP-3.2 (M9, Compliance-Blueprint 31.08.): KEINE Bewertungsdaten in den
    // Anwendungsprotokollen — uid+simId reichen zur Fehlersuche. overall/
    // verdict standen vorher als Klartext in Azure Monitor (BV § 6.4 wäre
    // sonst durch die Log-Leserechte ausgehebelt).
    logger.api("/api/simulation/finish", "complete", {
      uid: auth.uid,
      simId,
    });
    return NextResponse.json({
      ok: true,
      feedback,
      competencyRatings,
      competencyError,
      debrief,
      delta,
      attempt: stored.attempt ?? 1,
      focus: stored.focus ?? null,
      selfAssessment: stored.selfAssessment ?? null,
      mode: stored.mode ?? "practice",
      hardness: stored.hardness ?? "standard",
    });
  } catch (err) {
    if (charge) await refundFinishCharge({ uid: auth.uid, simId, grant: charge.grant, refunds: charge.refunds });
    // W1-1/W1-2: KI-Fehlerart + Fehler-Nr. statt „Internal server error“ (Rückweg AI_ERROR_CONTRACT=off).
    return aiErrorResponse(err, req, "/api/simulation/finish");
  }
}
