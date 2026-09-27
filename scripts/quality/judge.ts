/**
 * LLM-Judge für Coaching-Feedback (Regression + Rollenspiel-Prüfset).
 *
 * Owner-Entscheid 27.09.2026 (E-2): KEIN Anthropic-Schlüssel (DSGVO-Linie) —
 * der Richter ist Gemini. Damit Gemini nicht sich selbst benotet, gilt:
 *   - anderes Modell als der Schreiber (Schreiber: gemini-2.5-flash,
 *     Richter: gemini-2.5-pro; überschreibbar via JUDGE_MODEL),
 *   - der Richter sieht NUR Transkript + Ergebnis, nie den Schreiber-Prompt,
 *   - Rubrik mit Ankern, n=3 Läufe, Median je Dimension,
 *   - Ergebnis als Trend lesen; die deterministischen Checks (Grounding,
 *     findPersonJudgments) bleiben die zweite Meinung.
 */
import { ai } from "../../src/ai/genkit";
import { z } from "genkit";

const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "googleai/gemini-2.5-pro";
const N = 3;

export const DIMENSIONS = [
  ["faithfulness", "Sind ALLE Aussagen (Stärken, Verbesserungen, Evidenz-Zitate, Scores) durch das Transkript gedeckt? Keine erfundenen Zitate/Ereignisse."],
  ["coverage", "Adressiert die Analyse die wesentlichen Coaching-Momente des Gesprächs?"],
  ["actionability", "Sind Verbesserungen/Hinweise konkret und umsetzbar (nicht generisch wie 'besser kommunizieren')?"],
  ["competency_consistency", "Sind die Kompetenz-Scores durch die jeweilige Evidenz gerechtfertigt und in sich konsistent? Werden nicht beobachtbare Kompetenzen ehrlich als nicht beobachtbar geführt?"],
  ["tone", "Ist die Rückmeldung konstruktiv/respektvoll (Coaching-Haltung, nicht abwertend)?"],
  ["observer_canon", "Folgt die Rückmeldung dem Beobachter-Kanon: Verhalten statt Person (kein 'du bist …'), Entwicklungspunkte als Du-Botschaft MOMENT → WIRKUNG → WIRKSAMERER WEG mit Beispiel/Zitat, Stärken verb-first mit Wirkung und Beleg, keine Generalisierungen ('immer', 'total'), Begleiter- statt Richter-Haltung, durchgängig direkte Ansprache (nie 'Der/die Übende …')?"],
  ["locale", "Durchgängig in der Zielsprache, korrekte Anredeform?"],
] as const;

export type Verdict = { dims: Record<string, number>; avg: number; summary: string; model: string } | null;

const VerdictSchema = z.object(
  Object.fromEntries([
    ...DIMENSIONS.map(([k]) => [k, z.number().min(1).max(5)]),
    ["summary", z.string()],
  ]) as Record<string, z.ZodTypeAny>
);

const SYSTEM =
  "Du bist ein strenger, neutraler Gutachter für KI-generiertes Leadership-Coaching-Feedback. " +
  "Du bewertest die Qualität der Rückmeldung gegen das Transkript — nicht das Gespräch selbst. " +
  "Du kennst weder den Autor noch dessen Anweisungen. Antworte AUSSCHLIESSLICH mit JSON.";

async function judgeOnce(user: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await ai.generate({
      model: JUDGE_MODEL,
      system: SYSTEM,
      prompt: user,
      output: { schema: VerdictSchema },
      config: { temperature: 0.2 },
    });
    return (res.output as Record<string, unknown>) ?? null;
  } catch (e) {
    console.warn(`     ⚖ Judge-Aufruf fehlgeschlagen: ${(e as Error)?.message ?? e}`);
    return null;
  }
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

function rubricText(): string {
  return DIMENSIONS.map(([k, d]) => `- ${k} (1–5): ${d}`).join("\n");
}

async function judge(user: string): Promise<Verdict> {
  if (!process.env.GEMINI_API_KEY) {
    console.log("     ⚖ Judge übersprungen (GEMINI_API_KEY nicht gesetzt).");
    return null;
  }
  const runs: Record<string, unknown>[] = [];
  for (let i = 0; i < N; i++) {
    const r = await judgeOnce(user);
    if (r) runs.push(r);
  }
  if (!runs.length) return null;
  const dims: Record<string, number> = {};
  for (const [k] of DIMENSIONS) {
    const vals = runs.map((r) => Number(r?.[k])).filter((n) => Number.isFinite(n));
    dims[k] = vals.length ? median(vals) : 0;
  }
  const avg = Object.values(dims).reduce((a, b) => a + b, 0) / DIMENSIONS.length;
  const summary = String(runs[runs.length - 1]?.summary ?? "—");
  return { dims, avg, summary, model: JUDGE_MODEL };
}

/** Transkript-Analyse (golden-set.json): Kompetenz-Bewertungen gegen das Transkript. */
export async function judgeAnalysis(scenario: { transcript: string }, comps: unknown[]): Promise<Verdict> {
  const user =
    `TRANSKRIPT:\n${scenario.transcript}\n\nKI-ANALYSE (Kompetenz-Bewertungen):\n` +
    JSON.stringify(
      (comps as Array<Record<string, unknown>>).map((c) => ({ id: c.id, score: c.score, why: c.why, evidence: c.evidence })),
      null,
      2
    ) +
    `\n\nBewerte jede Dimension 1–5 (1=schlecht, 5=exzellent):\n${rubricText()}\n\nGib NUR JSON zurück mit den Feldern ${DIMENSIONS.map(([k]) => k).join(", ")} und "summary" (ein knapper Satz).`;
  return judge(user);
}

/** Rollenspiel-Debrief (sim-golden-set.json): Gesamtbild, Rubrik, nextStep, C-Ratings. */
export async function judgeSimulation(args: {
  transcript: string;
  feedback: { summary: string; nextStep: string; rubric: Array<{ key: string; label: string; score: number | null; why: string; evidence: string[] }>; checkpoints: Array<{ id: string; hit: boolean; comment: string }> };
  ratings: Array<{ id: string; score: number | null; why: string; evidence: string[] }>;
}): Promise<Verdict> {
  const user =
    `TRANSKRIPT (Rollenspiel; „Teilnehmer:in" ist die übende Person, die bewertet wird):\n${args.transcript}\n\n` +
    `KI-DEBRIEF:\n` +
    JSON.stringify(
      {
        summary: args.feedback.summary,
        nextStep: args.feedback.nextStep,
        rubric: args.feedback.rubric.map((r) => ({ key: r.key, label: r.label, score: r.score, why: r.why, evidence: r.evidence })),
        checkpoints: args.feedback.checkpoints,
        competencies: args.ratings.map((c) => ({ id: c.id, score: c.score, why: c.why, evidence: c.evidence })),
      },
      null,
      2
    ) +
    `\n\nBewerte jede Dimension 1–5 (1=schlecht, 5=exzellent):\n${rubricText()}\n\nGib NUR JSON zurück mit den Feldern ${DIMENSIONS.map(([k]) => k).join(", ")} und "summary" (ein knapper Satz).`;
  return judge(user);
}
