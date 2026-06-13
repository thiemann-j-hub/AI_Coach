/**
 * LLM-as-Judge (Q2): NEUTRALER Fremd-Judge — Claude bewertet den Gemini-Output,
 * nie "Gemini bewertet Gemini" (Eigenlob-Bias). n≥3-Mehrheit, da Temperatur bei
 * manchen Modellen nicht pinbar ist. Gegated auf ANTHROPIC_API_KEY; ohne Key
 * liefert der Harness nur die kostenlosen deterministischen Checks.
 *
 * SLOT: Wenn das erprobte Judge-Prompt + die 6-Dimensionen-Rubrik aus der
 * E-Learning-Schwester-App vorliegen, hier die DIMENSIONS/RUBRIK ersetzen.
 */

const MODEL = process.env.JUDGE_MODEL ?? "claude-opus-4-20250514";
const N = 3;

const DIMENSIONS = [
  ["faithfulness", "Sind ALLE Aussagen (Stärken, Verbesserungen, Evidenz-Zitate, Scores) durch das Transkript gedeckt? Keine erfundenen Zitate/Ereignisse."],
  ["coverage", "Adressiert die Analyse die wesentlichen Coaching-Momente des Gesprächs?"],
  ["actionability", "Sind Verbesserungen/Hinweise konkret und umsetzbar (nicht generisch wie 'besser kommunizieren')?"],
  ["competency_consistency", "Sind die Kompetenz-Scores durch die jeweilige Evidenz gerechtfertigt und in sich konsistent?"],
  ["tone", "Ist die Rückmeldung konstruktiv/respektvoll (Coaching-Haltung, nicht abwertend)?"],
  ["locale", "Durchgängig in der Zielsprache, korrekte Anredeform?"],
] as const;

type Verdict = { dims: Record<string, number>; avg: number; summary: string } | null;

async function callClaudeOnce(system: string, user: string): Promise<any | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    console.warn(`     ⚖ Judge HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    return null;
  }
  const data = await res.json();
  const text = data?.content?.[0]?.text ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

export async function judgeAnalysis(scenario: any, comps: any[]): Promise<Verdict> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("     ⚖ Judge übersprungen (ANTHROPIC_API_KEY nicht gesetzt).");
    return null;
  }

  const system =
    "Du bist ein strenger, neutraler Gutachter für KI-generiertes Leadership-Coaching-Feedback. " +
    "Du bewertest die Qualität der Analyse gegen das Transkript. Antworte AUSSCHLIESSLICH mit JSON.";

  const rubric = DIMENSIONS.map(([k, d]) => `- ${k} (1–5): ${d}`).join("\n");
  const user = `TRANSKRIPT:\n${scenario.transcript}\n\nKI-ANALYSE (Kompetenz-Bewertungen):\n${JSON.stringify(
    comps.map((c) => ({ id: c.id, score: c.score, why: c.why, evidence: c.evidence })),
    null,
    2
  )}\n\nBewerte jede Dimension 1–5 (1=schlecht, 5=exzellent):\n${rubric}\n\nGib NUR JSON zurück: { ${DIMENSIONS.map(([k]) => `"${k}": <1-5>`).join(", ")}, "summary": "<ein knapper Satz>" }`;

  // n≥3 Läufe, Median je Dimension
  const runs: any[] = [];
  for (let i = 0; i < N; i++) {
    const r = await callClaudeOnce(system, user);
    if (r) runs.push(r);
  }
  if (!runs.length) return null;

  const dims: Record<string, number> = {};
  for (const [k] of DIMENSIONS) {
    const vals = runs.map((r) => Number(r?.[k])).filter((n) => Number.isFinite(n));
    dims[k] = vals.length ? median(vals) : 0;
  }
  const avg = Object.values(dims).reduce((a, b) => a + b, 0) / DIMENSIONS.length;
  const summary = runs[runs.length - 1]?.summary ?? "—";
  return { dims, avg, summary };
}
