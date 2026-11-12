import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { GENKIT_MODEL_ID } from "@/ai/genkit";
import { generateDynamicFeedback } from "../../../ai/flows/generate-dynamic-feedback";
import { scoreCompetencies } from "../../../ai/flows/score-competencies";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkAndConsumeBudget, estimateTokens } from "@/lib/server/cost-cap";
import { claimSession, persistShadowRun } from "@/lib/server/runs-store";
import {
  creditGateEnabled,
  reserveEntitlement,
  settleEntitlement,
  compensateEntitlement,
  type EntitlementGrant,
} from "@/lib/server/credits/entitlement";
import {
  buchenMitVermerk,
  rueckbuchenMitVermerk,
  vermerkAustragen,
  type Buchungsvermerk,
} from "@/lib/server/credits/buchungsvermerk";
import { qualityMode, runQualityChecks } from "@/lib/server/quality-checks";
import {
  defaultCompetencyRatings,
  normalizeCompetencyRatings,
} from "@/lib/competency-model";
import { emitCoachMeasurement } from "@/lib/server/radar-emit";
import { withTimeout, withRetry, timeoutMs } from "@/lib/with-timeout";
import { logger } from "@/lib/logger";
import { getApiMessages } from "@/lib/server/get-request-locale";
import { REQUEST_ID_HEADER, aiErrorResponse, requestIdInUiOn, requestIdOf } from "@/lib/server/request-id";

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
  // B1 (Go-Live-Prüfung 12.11.2026): Pflicht. Ohne Sitzung lässt sich der Lauf nicht speichern (Credit verbraucht =>
  // Lauf existiert). Vorher war sie freiwillig: Die Route rechnete, buchte zurück und lieferte das Ergebnis aus.
  sessionId: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
});

// COMP_MODEL + Normalisierung leben seit SIM-2 im geteilten Modul
// @/lib/competency-model (eine Runtime-Quelle für Analyze UND Simulation).

function asStr(v: any): string {
  return typeof v === "string" ? v : String(v ?? "");
}

/**
 * B1/B3 (Go-Live-Prüfung 12.11.2026): Die Sitzung gehört nicht der Person. Nichts gebucht, nichts gerechnet.
 * Die Analyse-Seite zeigt zu einer Absage nur dann einen Satz, wenn die Antwort eine KI-Fehlerart trägt (`aiCode`),
 * sonst bloß die Fehler-Nr. Deshalb steht neben 403 FORBIDDEN die Art `ai_general` („Das hat … nicht geklappt.
 * Versuch es noch einmal. Bleibt der Fehler, schick uns die Fehler-Nummer.“).
 */
function fremdeSitzung(req: NextRequest, uid: string): NextResponse {
  const requestId = requestIdOf(req);
  const showId = requestIdInUiOn();
  logger.api("/api/analyze", "foreign-session", { uid, requestId });
  return NextResponse.json(
    { ok: false, code: "FORBIDDEN", aiCode: "ai_general", error: getApiMessages(req).accessDenied, ...(showId ? { requestId } : {}) },
    { status: 403, headers: showId ? { [REQUEST_ID_HEADER]: requestId } : undefined }
  );
}

export async function POST(req: NextRequest) {
  // Auth check
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  // 10 Analysen je Minute. S4 (Go-Live-Prüfung 12.11.2026): je Person statt je Adresse.
  const rlResponse = checkRateLimit(`analyze:${authResult.uid}`, 10, 60_000, getApiMessages(req).rateLimited);
  if (rlResponse) return rlResponse;

  // Kennung des Laufs serverseitig erzeugen: Sie bindet die Buchung (`spend:<runId>`) an den späteren Lauf
  // (Save übernimmt sie), damit die Rückgabe beim Löschen (`refund:<runId>`) greift.
  const runId = crypto.randomUUID();
  let grant: EntitlementGrant | null = null;
  // S3: Spur der Buchung, bis der Lauf gespeichert oder der Credit zurück ist (siehe buchungsvermerk.ts).
  let vermerk: Buchungsvermerk | null = null;
  // true, sobald der Schatten-Lauf steht: Ab dann ist der Credit verbraucht und wird nicht mehr zurückgebucht.
  let gespeichert = false;

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

    // B3: Die Sitzung muss der Person gehören. Eine neue Sitzung legt nur dieser Weg an (erste Analyse); alle
    // anderen Wege (/api/runs/*) verlangen das Sitzungsdokument. Geprüft VOR Budget, Buchung und Rechnung.
    if (!(await claimSession(d.sessionId, authResult.uid))) return fremdeSitzung(req, authResult.uid);

    logger.api("/api/analyze", "start", { uid: authResult.uid, lang: d.lang, textLen: d.transcriptText.length });

    // Pro-User-Token-Budget (Cosmos, instanzübergreifend) — der eigentliche
    // Kostenschutz, anders als die Begrenzung je Minute oben. Reserviert vor dem Call.
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
      const buchung = await buchenMitVermerk({ uid: authResult.uid, art: "analyse", kennung: runId }, (kennung) =>
        reserveEntitlement({ uid: authResult.uid, email: authResult.email, runId: kennung })
      );
      vermerk = buchung.vermerk;
      if (!buchung.ent.ok) return buchung.ent.response;
      grant = buchung.ent.grant;
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

      competency_ratings = normalizeCompetencyRatings(comp, {
        lang: d.lang,
        leaderLabel: leaderLbl || undefined,
        employeeLabel: empLbl || undefined,
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
        // P3: Modus + Fehlerzahl mitloggen — Datenbasis für den E2-Entscheid.
        logger.api("/api/analyze", "quality-notes", {
          uid: authResult.uid,
          mode: qualityMode(),
          count: qc.notes.length,
          errors: qc.notes.filter((n) => n.severity === "error").length,
        });
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
      // Provenienz (27.09.): Schreiber-Modell — der Client reicht es an /api/runs/save weiter.
      model: GENKIT_MODEL_ID,
    };

    // Schatten-Lauf: Credit verbraucht => Lauf existiert (ohne Transkript), damit Löschen und Rückgabe immer greifen.
    // B1 (Go-Live-Prüfung 12.11.2026): Lässt sich der Lauf nicht speichern, gibt es KEIN Ergebnis. Der Fehler geht in
    // den catch unten (Rückbuchung, Fehlerantwort). Vorher buchte die Route zurück und lieferte das Ergebnis aus.
    if (grant) {
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
          // O2b: eigener 7-Tage-Schritt aus dem Modell (vorher fiel die
          // Anzeige auf improvements[0] zurück — eine wörtliche Kopie).
          practice7Days: (result as any).practice7Days ?? null,
          // Provenienz (27.09.): Schreiber-Modell dieser Analyse.
          model: GENKIT_MODEL_ID,
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
      // persistShadowRun gibt {ok:false} (statt zu werfen) zurück, wenn die runId schon einer ANDEREN Person gehört.
      if (!shadow.ok) throw new Error("Analyse-Lauf nicht gespeichert: " + (shadow.reason ?? "unbekannt"));
      gespeichert = true;
      // Der Lauf steht: Die Buchung war schon final (kein Hold), die Spur der Buchung kann weg.
      await settleEntitlement(grant);
      await vermerkAustragen(vermerk);

      if (shadow.createdAt) {
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

    logger.api("/api/analyze", "complete", { uid: authResult.uid });
    // Mit Bezahlsystem steht der Lauf hier garantiert. Ohne Bezahlsystem ist die runId nur ein Hinweis für
    // /api/runs/save, das den Lauf dann anlegt.
    return NextResponse.json({ ok: true, result, runId }, { status: 200 });
  } catch (err: any) {
    // Technischer Abbruch nach der Buchung: Credit zurückbuchen. Scheitert das, bleibt der Buchungsvermerk stehen
    // und `scripts/credits-abgleich.mts` listet ihn; einen Nachlauf, der von selbst zurückbucht, gibt es nicht.
    // Steht der Lauf schon, ist der Credit verbraucht: keine Rückbuchung.
    if (grant && !gespeichert) {
      const gebucht = grant;
      await rueckbuchenMitVermerk({ art: "analyse", kennung: runId, vermerk }, () => compensateEntitlement(gebucht));
    }
    // W1-1/W1-2: KI-Fehlerart + Fehler-Nr. statt „Internal server error“ (Rückweg AI_ERROR_CONTRACT=off).
    return aiErrorResponse(err, req, "/api/analyze");
  }
}
