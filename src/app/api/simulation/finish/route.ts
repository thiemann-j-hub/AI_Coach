import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateSimulationFeedback } from "@/ai/flows/simulation-feedback";
import { scoreCompetencies } from "@/ai/flows/score-competencies";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { checkAndConsumeBudget, estimateTokens } from "@/lib/server/cost-cap";
import {
  creditGateEnabled,
  reserveEntitlement,
  settleEntitlement,
  compensateEntitlement,
  type EntitlementGrant,
} from "@/lib/server/credits/entitlement";
import {
  defaultCompetencyRatings,
  normalizeCompetencyRatings,
} from "@/lib/competency-model";
import {
  qualityMode,
  runQualityChecks,
  type QualityNote,
} from "@/lib/server/quality-checks";
import { emitCoachMeasurement } from "@/lib/server/radar-emit";
import {
  simulationEnabled,
  simulationRadarEmitEnabled,
} from "@/lib/simulation/flags";
import { getScenario } from "@/lib/simulation/scenarios";
import {
  assembleTranscript,
  countUserTurns,
  getSimulation,
  latestFinishedForScenario,
  saveSimulation,
} from "@/lib/server/simulation-store";
import {
  computeDebrief,
  computeDelta,
  type Debrief,
} from "@/lib/simulation/debrief";
import { computeMeasurementDelta } from "@/lib/measurement-delta";
import type { SimulationFeedbackOutput } from "@/ai/flows/simulation-feedback";
import { withRetry, withTimeout, timeoutMs } from "@/lib/with-timeout";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LLM_TIMEOUT_MS = timeoutMs("LLM_TIMEOUT_MS", 45_000);

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
 * POST: Simulation beenden und auswerten. Kostet 1 Credit (spiegelt /api/analyze):
 * Charge vor dem teuren LLM-Call, Persistenz VOR settle, compensate bei jedem
 * Fehler. Idempotency: pro Auswertungs-VERSUCH ein frischer serverseitiger
 * chargeId (SV-Lektion: derselbe Key nur für Retries derselben Kaufentscheidung —
 * ein erneuter Finish-Klick nach Refund ist eine NEUE Entscheidung).
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

  const rl = checkRateLimit(rateLimitKey(req, "sim-finish"), 3, 60_000);
  if (rl) return rl;

  const chargeId = crypto.randomUUID();
  let grant: EntitlementGrant | null = null;

  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const doc = await getSimulation(auth.uid, parsed.data.simId);
    if (!doc) {
      return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
    }
    if (doc.status !== "active") {
      // Idempotent lesbar: bereits ausgewertet -> Ergebnis zurückgeben, nichts chargen.
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
      });
    }
    if (countUserTurns(doc.turns) < MIN_USER_TURNS) {
      return NextResponse.json(
        { ok: false, code: "NOT_ENOUGH_TURNS", minUserTurns: MIN_USER_TURNS },
        { status: 400 }
      );
    }
    const scenario = getScenario(doc.scenarioId);
    if (!scenario) {
      return NextResponse.json({ ok: false, code: "UNKNOWN_SCENARIO" }, { status: 410 });
    }

    const transcript = assembleTranscript(doc.turns, scenario.persona.name);
    const budget = await checkAndConsumeBudget({
      uid: auth.uid,
      email: auth.email,
      estimatedTokens: estimateTokens(transcript),
    });
    if (!budget.allowed && budget.response) return budget.response;

    // Point-of-Sale VOR den teuren LLM-Calls (wie /api/analyze).
    if (creditGateEnabled()) {
      const ent = await reserveEntitlement({
        uid: auth.uid,
        email: auth.email,
        runId: chargeId,
      });
      if (!ent.ok) return ent.response;
      grant = ent.grant;
    }

    // Rubrik-Feedback (Pflichtpfad) + C1–C10-Scoring (degradiert nur) parallel.
    const [fbSettled, compSettled] = await Promise.allSettled([
      withRetry(
        () =>
          generateSimulationFeedback({
            scenario,
            turns: doc.turns,
            focus: doc.focus ?? undefined,
            convoLocale: doc.convoLocale ?? undefined,
            selfAssessment: parsed.data.selfAssessment || undefined,
          }),
        { ms: LLM_TIMEOUT_MS, label: "gemini-sim-feedback", retries: 1 }
      ),
      withTimeout(
        scoreCompetencies({
          transcriptText: transcript,
          // W3-4: why-Begründungen folgen der GESPRÄCHSSPRACHE (vorher hart
          // "de" — englische Läufe bekamen deutsche Begründungen). Zitate
          // bleiben per Prompt im Originalwortlaut.
          lang: doc.convoLocale ?? "de",
          leaderLabel: "Teilnehmer:in",
          employeeLabel: scenario.persona.name,
        }),
        LLM_TIMEOUT_MS,
        "gemini-sim-competencies"
      ),
    ]);

    if (fbSettled.status === "rejected") throw fbSettled.reason;
    const feedback = fbSettled.value;

    let competencyRatings = defaultCompetencyRatings();
    let competencyError: string | null = null;
    try {
      if (compSettled.status === "rejected") throw compSettled.reason;
      competencyRatings = normalizeCompetencyRatings(compSettled.value, {
        lang: doc.convoLocale ?? "de",
        leaderLabel: "Teilnehmer:in",
        employeeLabel: scenario.persona.name,
      });
    } catch (e: any) {
      competencyError = e?.message ?? String(e);
      logger.apiError("/api/simulation/finish/competencies", e);
    }

    // P2 (COACH-UX-BLUEPRINT §6): Grounding auch im Rollenspiel — derselbe
    // deterministische Zitat-Check wie /api/analyze, gegen das zusammengebaute
    // Gesprächsprotokoll, für die C1–C10-Ratings UND die S1–S5-Evidence.
    // Läuft VOR computeDebrief, damit die Gesamtwertung nie auf fabrizierten
    // Belegen aufbaut. quality-core ist pure — direkt nutzbar.
    let qualityNotes: QualityNote[] = [];
    try {
      const rubricForCheck = feedback.rubric.map((r) => ({
        id: r.key,
        score: r.score,
        evidence: r.evidence ?? [],
      }));
      const qc = runQualityChecks(
        {
          summary: feedback.summary,
          competency_ratings: [
            ...(competencyRatings as Array<{ id: string; score: number | null; evidence?: string[] }>),
            ...rubricForCheck,
          ],
        },
        transcript
      );
      qualityNotes = qc.notes;
      if (qc.notes.length) {
        // P3: Zählung je Modus sichtbar machen (App Insights) — Datenbasis
        // für den E2-Entscheid (enforce), analog /api/analyze.
        logger.api("/api/simulation/finish", "quality-notes", {
          uid: auth.uid,
          mode: qualityMode(),
          count: qc.notes.length,
          errors: qc.notes.filter((n) => n.severity === "error").length,
        });
      }
      if (qc.blocked) {
        const fabricated = new Set(
          qc.notes.filter((n) => n.severity === "error" && n.field).map((n) => n.field as string)
        );
        // Gleicher heldWhy-Text wie analyze/route (Muster §2.2 enforce).
        const heldWhy =
          doc.convoLocale === "en"
            ? "evidence not verifiable in transcript — score withheld (quality gate)"
            : "Belege nicht im Transkript verifizierbar — Score zurückgehalten (Qualitäts-Gate)";
        competencyRatings = (competencyRatings as any[]).map((c: any) =>
          fabricated.has(c.id) ? { ...c, score: null, evidence: [], why: heldWhy } : c
        ) as typeof competencyRatings;
        feedback.rubric = feedback.rubric.map((r) =>
          fabricated.has(r.key) ? { ...r, score: null, evidence: [], why: heldWhy } : r
        );
        logger.api("/api/simulation/finish", "quality-enforce-degraded", {
          uid: auth.uid,
          fields: [...fabricated],
        });
      }
    } catch (e) {
      logger.apiError("/api/simulation/finish/quality", e);
    }

    // Debrief 2.0 (D1): deterministische Gesamtwertung in Code — das LLM
    // liefert nur Einzel-Scores. Plus Delta zum Vorversuch (D2), best effort.
    const debrief = computeDebrief({
      rubric: feedback.rubric.map((r) => ({ key: r.key, label: r.label, score: r.score })),
      checkpoints: feedback.checkpoints.map((c) => ({ id: c.id, hit: c.hit })),
      passThreshold: scenario.assessment.passThreshold,
    });
    let delta: (ReturnType<typeof computeDelta> & {
      competencies?: Record<string, number | null>;
    }) | null = null;
    try {
      const prev = await latestFinishedForScenario(auth.uid, doc.scenarioId, doc.id);
      const prevFb = prev?.feedbackJson as SimulationFeedbackOutput | undefined;
      if (prev && prevFb?.rubric) {
        const prevDebrief =
          (prev.debriefJson as Debrief | null) ??
          computeDebrief({
            rubric: prevFb.rubric.map((r) => ({ key: r.key, label: r.label, score: r.score })),
            checkpoints: (prevFb.checkpoints ?? []).map((c) => ({ id: c.id, hit: c.hit })),
            passThreshold: scenario.assessment.passThreshold,
          });
        delta = computeDelta({
          current: debrief,
          previous: prevDebrief,
          prevAttempt: prev.attempt ?? 1,
        });
        // W3-1: zusätzlich das C1–C10-Delta (measurement-delta, dieselbe
        // Rechnung wie die Delta-Card der Analyse) — Datenbasis des
        // Endscreen-CTAs »Erkenntnis → Handlung«. Additiv, best effort.
        if (prev.competencyRatings) {
          try {
            delta.competencies = computeMeasurementDelta(
              competencyRatings,
              prev.competencyRatings
            ).deltas;
          } catch {
            /* C-Delta ist Komfort — Anker-Delta bleibt. */
          }
        }
      }
    } catch (e) {
      logger.apiError("/api/simulation/finish/delta", e, { simId: doc.id });
    }

    // Persistenz VOR settle: Credit verbraucht => Auswertung existiert.
    const finishedAt = new Date().toISOString();
    doc.status = "finished";
    doc.finishedAt = finishedAt;
    doc.selfAssessment = parsed.data.selfAssessment || null;
    doc.feedbackJson = feedback;
    doc.competencyRatings = competencyRatings;
    doc.competencyError = competencyError;
    doc.debriefJson = debrief;
    doc.deltaJson = delta;
    doc.qualityNotes = qualityNotes;
    if (grant) {
      doc.workspaceId = grant.workspaceId;
      doc.centralSpendTxId = grant.centralTxId ?? null;
    }
    await saveSimulation(doc);

    if (grant) await settleEntitlement(grant);

    // Radar-Messpunkt nur mit doppeltem Opt-in (RADAR_EMIT im Emitter +
    // SIMULATION_RADAR_EMIT hier) — Owner-Entscheid offen (Blueprint §6 SIM-2).
    if (grant && simulationRadarEmitEnabled()) {
      try {
        void emitCoachMeasurement({
          workspaceId: grant.workspaceId,
          subjectId: auth.oid ?? "",
          runId: doc.id,
          createdAt: finishedAt,
          competencyRatings,
        }).catch((e) =>
          logger.apiError("/api/simulation/finish/radar", e, { simId: doc.id })
        );
      } catch (e) {
        logger.apiError("/api/simulation/finish/radar", e, { simId: doc.id });
      }
    }

    logger.api("/api/simulation/finish", "complete", {
      uid: auth.uid,
      simId: doc.id,
      overall: debrief.overall,
      verdict: debrief.verdict,
    });
    return NextResponse.json({
      ok: true,
      feedback,
      competencyRatings,
      competencyError,
      debrief,
      delta,
      attempt: doc.attempt ?? 1,
      focus: doc.focus ?? null,
      selfAssessment: doc.selfAssessment ?? null,
    });
  } catch (err) {
    if (grant) await compensateEntitlement(grant);
    logger.apiError("/api/simulation/finish", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
