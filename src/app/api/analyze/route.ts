import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateDynamicFeedback } from "../../../ai/flows/generate-dynamic-feedback";
import { scoreCompetencies } from "../../../ai/flows/score-competencies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
    conversationType: z.string().min(1),
    conversationSubType: z.string().optional().nullable(),
    goal: z.string().optional().nullable(),
    transcriptText: z.string().min(1),
    lang: z.string().optional(),
    jurisdiction: z.string().optional(),
    leaderLabel: z.string().optional().nullable(),
    employeeLabel: z.string().optional().nullable(),
  })
  .passthrough();

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
  const debug = req.nextUrl.searchParams.get("debug") === "1";

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

    // 1) Base analysis (RAG + coaching feedback)
    const baseResult = await generateDynamicFeedback({
      conversationType: d.conversationType,
      conversationSubType: d.conversationSubType ?? undefined,
      goal: d.goal ?? undefined,
      transcriptText: d.transcriptText,
      lang: d.lang,
      jurisdiction: d.jurisdiction,
      leaderLabel: d.leaderLabel ?? undefined,
      employeeLabel: d.employeeLabel ?? undefined,
    } as any);

    // 2) Competencies (robust: always return 10 items)
    let competency_ratings = defaultCompetencyRatings();
    let competency_error: string | null = null;

    try {
      const leaderLbl = asStr(d.leaderLabel ?? "").trim();
      const empLbl = asStr(d.employeeLabel ?? "").trim();

      const comp = await scoreCompetencies({
        transcriptText: asStr(d.transcriptText ?? ""),
        lang: d.lang,
        leaderLabel: leaderLbl || undefined,
        employeeLabel: empLbl || undefined,
      } as any);

      const list = Array.isArray((comp as any)?.competencies) ? (comp as any).competencies : [];
      const map = new Map<string, any>(list.map((x: any) => [asStr(x?.id).trim(), x]));

      competency_ratings = COMP_MODEL.map((c) => {
        const r = map.get(c.id);
        if (!r) return { ...defaultCompetencyRatings().find((x) => x.id === c.id)! };

        let why = asStr(r?.why ?? "").trim();
        const score = normalizeScore(r?.score);
        if (!score) {
          // Wenn score null oder invalide -> konsequent "nicht beobachtbar"
          why = "nicht ausreichend beobachtbar";
        } else if (!why) {
          why = "—";
        }

        let evidence = normalizeEvidence(r?.evidence);
        // anonymize labels in evidence
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
      // competency_ratings bleibt default (10x null) -> App bleibt stabil
    }

    const result = {
      ...baseResult,
      competency_ratings,
      ...(debug ? { competency_error } : {}),
    };

    return NextResponse.json(
      { ok: true, result, ...(debug ? { debug: { competency_error, hasCompetencies: Array.isArray(competency_ratings) } } : {}) },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: err?.message ?? String(err),
        ...(debug ? { stack: err?.stack ?? null } : {}),
      },
      { status: 500 }
    );
  }
}
