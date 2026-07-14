import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateDynamicFeedback } from "../../../ai/flows/generate-dynamic-feedback";
import { scoreCompetencies } from "../../../ai/flows/score-competencies";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { checkAndConsumeBudget, estimateTokens } from "@/lib/server/cost-cap";
import {
  checkSessionOwnership,
  persistShadowRun,
  upsertSession,
} from "@/lib/server/runs-store";
import {
  creditGateEnabled,
  reserveEntitlement,
  settleEntitlement,
  compensateEntitlement,
  type EntitlementGrant,
} from "@/lib/server/credits/entitlement";
import { runQualityChecks } from "@/lib/server/quality-checks";
import { emitCoachMeasurement } from "@/lib/server/radar-emit";
import { withTimeout, withRetry, timeoutMs } from "@/lib/with-timeout";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Obergrenze fuer die Route (Serverless-Knob; auf App Service No-Op, dokumentiert
// aber die Intention). Der echte Schutz ist der withTimeout-Race unten.
export const maxDuration = 60;

/** Hartes Timeout je LLM-Call (Default 45s) — verhindert ~230s-Haenger. */
const LLM_TIMEOUT_MS = timeoutMs("LLM_TIMEOUT_MS", 45_000);

const MAX_TRANSCRIPT_LENGTH = 500_000;

const requestSchema = z.object({
  conversationType: z.string().min(1).max(100),
  conversationSubType: z.string().max(100).optional().nullable(),
  goal: z.string().max(500).optional().nullable(),
  transcriptText: z.string().min(1).max(MAX_TRANSCRIPT_LENGTH),
  lang: z.enum(["de", "en"]).optional(),
  jurisdiction: z.string().max(50).optional(),
  leaderLabel: z.string().max(200).optional().nullable(),
  employeeLabel: z.string().max(200).optional().nullable(),
  // Optional: ermoeglicht die Schatten-Persistenz des Runs bei Credit-Verbrauch
  // (Credit verbraucht => Run existiert => Delete/Refund universell ausloesbar).
  sessionId: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});

const COMP_MODEL = [
  { id: "C1", name: "Integrieren und Verbinden" },
  { id: "C2", name: "Klarheit und Entscheidungsstärke" },
  { id: "C3", name: "Befähigen und Entwickeln" },
  { id: "C4", name: "Sicherheit und Stabilität geben" },
  { id: "C5", name: "Kommunikation und Kooperation" },
  { id: "C6", name: "Zielorientierte Umsetzung" },
  { id: "C7", name: "Innovative Kultur fördern" },
  { id: "C8", name: "Selbstreflexion und Lernmotivation" },
  { id: "C9", name: "Zukunftsorientierung und strategischer Weitblick" },
  { id: "C10", name: "KI- und Datenkompetenz" },
];

function defaultCompetencyRatings() {
  return COMP_MODEL.map((c) => ({
    id: c.id,
    name: c.name,
    score: null as number | null,
    confidence: null as number | null,
    why: "nicht ausreichend beobachtbar",
    evidence: [] as string[],
  }));
}

function normalizeScore(v: any): number | null {
  const n = typeof v === "number" ? v : null;
  if (n == null) return null;
  if (n < 1 || n > 4) return null;
  return n;
}

function asStr(v: any): string {
  return typeof v === "string" ? v : String(v ?? "");
}

function normalizeEvidence(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => asStr(x)).filter((s) => s.trim()).slice(0, 2);
}

export async function POST(req: NextRequest) {
  // Auth check
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  // Rate limit: 10 analyze requests per minute per IP
  const rlKey = rateLimitKey(req, "analyze");
  const rlResponse = checkRateLimit(rlKey, 10, 60_000);
  if (rlResponse) return rlResponse;

  // Run-/Hold-Identifier serverseitig erzeugen: bindet die Credit-Reservierung
  // an den spaeteren Run (Save uebernimmt diese id), damit der Delete-Refund
  // refund:{runId} greift.
  const runId = crypto.randomUUID();
  let grant: EntitlementGrant | null = null;

  try {
    const json = await req.json();
    const parsed = requestSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const d = parsed.data;
    logger.api("/api/analyze", "start", { uid: authResult.uid, lang: d.lang, textLen: d.transcriptText.length });

    // Pro-User-Token-Budget (Cosmos, instanzübergreifend) — der eigentliche
    // Kostenschutz, anders als das IP-Rate-Limit oben. Reserviert vor dem Call.
    const budget = await checkAndConsumeBudget({
      uid: authResult.uid,
      email: authResult.email,
      estimatedTokens: estimateTokens(d.transcriptText),
    });
    if (!budget.allowed && budget.response) return budget.response;

    // Business-Gate (Credits) — Point-of-Sale, VOR dem teuren Gemini-Call.
    // Greift bei CREDITS_CENTRAL=on (zentral verbrauchen; KK-1: das lokale
    // PAYMENTS_ENABLED-Ledger ist abgebaut). Bei off kein Credit-Gate (nur cost-cap).
    if (creditGateEnabled()) {
      const ent = await reserveEntitlement({
        uid: authResult.uid,
        email: authResult.email,
        runId,
      });
      if (!ent.ok) return ent.response;
      grant = ent.grant;
    }

    const leaderLbl = asStr(d.leaderLabel ?? "").trim();
    const empLbl = asStr(d.employeeLabel ?? "").trim();

    // 1+2) Feedback (RAG) und Kompetenz-Scoring parallel — beide hängen nur
    // vom Transkript ab; sequenziell verdoppelte das nur die Wartezeit.
    const [baseSettled, compSettled] = await Promise.allSettled([
      // Pflicht-Pfad: 1 Retry heilt transiente Kaltstart-Fehler/Timeouts des
      // Basis-LLM (sonst 500 beim 1. Request, ok beim 2.). RAG degradiert intern.
      withRetry(
        () =>
          generateDynamicFeedback({
            conversationType: d.conversationType,
            conversationSubType: d.conversationSubType ?? undefined,
            goal: d.goal ?? undefined,
            transcriptText: d.transcriptText,
            lang: d.lang,
            jurisdiction: d.jurisdiction,
            leaderLabel: d.leaderLabel ?? undefined,
            employeeLabel: d.employeeLabel ?? undefined,
          } as any),
        { ms: LLM_TIMEOUT_MS, label: "gemini-feedback", retries: 1 }
      ),
      withTimeout(
        scoreCompetencies({
          transcriptText: asStr(d.transcriptText ?? ""),
          lang: d.lang,
          leaderLabel: leaderLbl || undefined,
          employeeLabel: empLbl || undefined,
        } as any),
        LLM_TIMEOUT_MS,
        "gemini-competencies"
      ),
    ]);

    // Basis-Analyse ist Pflicht — Kompetenzen degradieren nur (mit sichtbarem Fehler).
    if (baseSettled.status === "rejected") throw baseSettled.reason;
    const baseResult = baseSettled.value;

    let competency_ratings = defaultCompetencyRatings();
    let competency_error: string | null = null;

    try {
      if (compSettled.status === "rejected") throw compSettled.reason;
      const comp = compSettled.value;

      const list = Array.isArray((comp as any)?.competencies) ? (comp as any).competencies : [];
      const map = new Map<string, any>(list.map((x: any) => [asStr(x?.id).trim(), x]));

      competency_ratings = COMP_MODEL.map((c) => {
        const r = map.get(c.id);
        if (!r) return { ...defaultCompetencyRatings().find((x) => x.id === c.id)! };

        let why = asStr(r?.why ?? "").trim();
        const score = normalizeScore(r?.score);
        const notObservable = d.lang === "en" ? "not sufficiently observable" : "nicht ausreichend beobachtbar";
        if (!score) {
          why = notObservable;
        } else if (!why) {
          why = "—";
        }

        let evidence = normalizeEvidence(r?.evidence);
        evidence = evidence.map((q) => {
          let s = asStr(q);
          if (leaderLbl) s = s.split(leaderLbl).join("Führungskraft");
          if (empLbl) s = s.split(empLbl).join("Mitarbeiter:in");
          return s;
        });

        const confidenceRaw = typeof r?.confidence === "number" ? r.confidence : null;

        return {
          id: c.id,
          name: c.name,
          score,
          confidence: confidenceRaw,
          why,
          evidence,
        };
      });
    } catch (e: any) {
      competency_error = e?.message ?? String(e);
      logger.apiError("/api/analyze/competencies", e);
    }

    // Deterministische Qualitäts-Checks (kein LLM): Evidenz-Grounding gegen
    // das (anonymisierte) Transkript, Score⇒Evidenz, Rewrite≠Original, Floskeln.
    let quality_notes: { code: string; severity: string; message: string; field?: string }[] = [];
    try {
      let groundTxt = asStr(d.transcriptText ?? "");
      if (leaderLbl) groundTxt = groundTxt.split(leaderLbl).join("Führungskraft");
      if (empLbl) groundTxt = groundTxt.split(empLbl).join("Mitarbeiter:in");
      const qc = runQualityChecks(
        {
          summary: (baseResult as any)?.summary,
          rewrites: (baseResult as any)?.rewrites,
          competency_ratings,
        },
        groundTxt
      );
      quality_notes = qc.notes;
      if (qc.notes.length) {
        logger.api("/api/analyze", "quality-notes", { uid: authResult.uid, count: qc.notes.length });
      }
      // §2.2 enforce: fabrizierte Belegketten NICHT ausliefern. Gezielt nur die
      // betroffene Kompetenz degradieren (Score zurückhalten, Fabrikat-Zitate
      // strippen) statt die ganze bezahlte Analyse zu blocken — der Kunde sieht
      // "nicht verifizierbar" statt eines halluzinierten Scores.
      if (qc.blocked) {
        const fabricated = new Set(
          qc.notes.filter((n) => n.severity === "error" && n.field).map((n) => n.field as string)
        );
        const heldWhy =
          d.lang === "en"
            ? "evidence not verifiable in transcript — score withheld (quality gate)"
            : "Belege nicht im Transkript verifizierbar — Score zurückgehalten (Qualitäts-Gate)";
        competency_ratings = competency_ratings.map((c: any) =>
          fabricated.has(c.id) ? { ...c, score: null, evidence: [], why: heldWhy } : c
        );
        logger.api("/api/analyze", "quality-enforce-degraded", {
          uid: authResult.uid,
          fields: [...fabricated],
        });
      }
    } catch (e: any) {
      logger.apiError("/api/analyze/quality", e);
    }

    const result = {
      ...baseResult,
      competency_ratings,
      // Sichtbar machen statt droppen: UI zeigt degradiertes Scoring an,
      // runs/save persistiert das Feld bereits (analysisJson.competency_error).
      competency_error,
      quality_notes,
    };

    // Schatten-Persistenz: Credit verbraucht => Run existiert. Vor dem Settle,
    // damit der Run-Record garantiert vorliegt, bevor der Hold final wird.
    // shadowPersisted bleibt nur true, wenn der Run wirklich geschrieben wurde —
    // davon haengt ab, ob der Hold gesettlet (Credit verbraucht) werden DARF.
    let shadowPersisted = false;
    if (grant && d.sessionId) {
      try {
        const own = await checkSessionOwnership(d.sessionId, authResult.uid);
        if (own.allowed) {
          await upsertSession(d.sessionId, authResult.uid);
          const shadow = await persistShadowRun({
            sessionId: d.sessionId,
            runId,
            uid: authResult.uid,
            workspaceId: grant.workspaceId,
            // Zentraler Spend-Anker fuer den spaeteren Refund (CREDITS_CENTRAL-Pfad).
            centralSpendTxId: grant.centralTxId ?? null,
            conversationType: d.conversationType,
            conversationSubType: d.conversationSubType ?? null,
            goal: d.goal ?? null,
            lang: d.lang ?? null,
            jurisdiction: d.jurisdiction ?? null,
            analysisJson: {
              summary: (result as any).summary ?? null,
              strengths: (result as any).strengths ?? [],
              improvements: (result as any).improvements ?? [],
              rewrites: (result as any).rewrites ?? [],
              riskFlags: (result as any).riskFlags ?? [],
              scores: (result as any).scores ?? {},
              competency_ratings,
              competency_error,
              quality_notes,
            },
            summary: (result as any).summary ?? null,
            scoreOverall:
              typeof (result as any)?.scores?.overall === "number"
                ? (result as any).scores.overall
                : null,
          });
          // Nur als persistiert werten, wenn der Run wirklich geschrieben wurde.
          // persistShadowRun gibt {ok:false} (statt zu werfen) zurueck, wenn die
          // runId bereits einem ANDEREN Owner gehoert (id_conflict) — dann darf
          // der Hold NICHT gesettlet werden (kein verbrauchter Credit ohne Run).
          shadowPersisted = shadow.ok === true;
          if (!shadow.ok) {
            logger.apiError("/api/analyze/shadow", new Error("persistShadowRun not ok: " + (shadow.reason ?? "unknown")));
          } else if (shadow.createdAt) {
            // Radar-Messpunkt (Wirbelsäule V6 Kap. 6): fire-and-forget NACH der
            // Run-Persistenz — der Fachpfad darf NIE an Radar scheitern
            // (radar-emit ist fail-soft; try/catch + .catch als Doppelboden).
            // subjectId = Entra-oid (app-uebergreifend stabil), workspaceId =
            // ZENTRALER Workspace aus dem Entitlement-Grant (resolve-workspace),
            // ts = runDoc.createdAt (gelockt — NIE Date.now). Flag-gated:
            // RADAR_EMIT=on, sonst No-Op.
            try {
              void emitCoachMeasurement({
                workspaceId: grant.workspaceId,
                subjectId: authResult.oid ?? "",
                runId,
                createdAt: shadow.createdAt,
                competencyRatings: competency_ratings,
              }).catch((e) => logger.apiError("/api/analyze/radar", e, { runId }));
            } catch (e) {
              logger.apiError("/api/analyze/radar", e, { runId });
            }
          }
        }
      } catch (e) {
        // Schatten-Persistenz darf den erfolgreichen Response nicht killen.
        logger.apiError("/api/analyze/shadow", e);
      }
    }

    // Hold NUR final verbuchen, wenn der Run-Record garantiert persistiert wurde
    // (Invariante: kein verbrauchter Credit ohne zugehoerigen Run, sonst koennte
    // der User bei totem Tab fuer nichts bezahlen und haette keinen Delete-Button).
    // Schlug die Schatten-Persistenz fehl ODER fehlte die sessionId, wird der
    // Credit zurueckgebucht statt verbucht; Lazy Reconciliation ist der Backstop,
    // falls dieser synchrone Refund selbst scheitert.
    if (grant) {
      if (shadowPersisted) await settleEntitlement(grant);
      else await compensateEntitlement(grant);
    }

    logger.api("/api/analyze", "complete", { uid: authResult.uid });
    // runId NUR ausliefern, wenn der Run garantiert persistiert wurde
    // (shadowPersisted) bzw. ohne aktives Bezahlsystem (dann ist runId nur ein
    // optionaler Hint, kein Hold-Anker). Bei Payments-on + Persist-Fehler wird
    // die runId zurueckgehalten, damit der Client keinen abrechenbaren Save mit
    // erstattetem/fehlendem Hold anstoesst (Defense-in-Depth zur Save-Grenze).
    const exposeRunId = shadowPersisted || !grant;
    return NextResponse.json(
      { ok: true, result, ...(exposeRunId ? { runId } : {}) },
      { status: 200 }
    );
  } catch (err: any) {
    // Technischer Abbruch nach Reservierung -> Credit synchron zuruckbuchen
    // (Schnellpfad; Lazy Reconciliation ist der Backstop fuer uncatchable Tod).
    if (grant) await compensateEntitlement(grant);
    logger.apiError("/api/analyze", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
