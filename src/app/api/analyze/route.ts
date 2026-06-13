import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateDynamicFeedback } from "../../../ai/flows/generate-dynamic-feedback";
import { scoreCompetencies } from "../../../ai/flows/score-competencies";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    const leaderLbl = asStr(d.leaderLabel ?? "").trim();
    const empLbl = asStr(d.employeeLabel ?? "").trim();

    // 1+2) Feedback (RAG) und Kompetenz-Scoring parallel — beide hängen nur
    // vom Transkript ab; sequenziell verdoppelte das nur die Wartezeit.
    const [baseSettled, compSettled] = await Promise.allSettled([
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
      scoreCompetencies({
        transcriptText: asStr(d.transcriptText ?? ""),
        lang: d.lang,
        leaderLabel: leaderLbl || undefined,
        employeeLabel: empLbl || undefined,
      } as any),
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
        if (!score) {
          why = "nicht ausreichend beobachtbar";
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

    const result = {
      ...baseResult,
      competency_ratings,
      // Sichtbar machen statt droppen: UI zeigt degradiertes Scoring an,
      // runs/save persistiert das Feld bereits (analysisJson.competency_error).
      competency_error,
    };

    logger.api("/api/analyze", "complete", { uid: authResult.uid });
    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (err: any) {
    logger.apiError("/api/analyze", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
