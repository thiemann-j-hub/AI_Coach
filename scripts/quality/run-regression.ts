/**
 * Regression-Harness für den Kompetenz-Generator (Q2, Muster der Schwester-App).
 *
 * Misst den ECHTEN Generator: ruft `scoreCompetencies` (App-eigener Flow + Prompt)
 * gegen das Golden-Set und prüft mit den App-eigenen Core-Checks (quality-core).
 * Quellen werden direkt injiziert (kein RAG/keine Persistenz → saubere Isolation:
 * ein schlechter Score liegt am Generator, nicht an einem Retrieval-Treffer).
 *
 * Aufruf:
 *   npx tsx scripts/quality/run-regression.ts                 # deterministisch (Gemini-Calls)
 *   npx tsx scripts/quality/run-regression.ts --only=03-...   # ein Szenario
 *   npx tsx scripts/quality/run-regression.ts --n=3           # Score-Stabilität über 3 Läufe
 *   npx tsx scripts/quality/run-regression.ts --judge         # zusätzlich LLM-Judge (ANTHROPIC_API_KEY)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: join(here, "..", "..", ".env.local") });

import { scoreCompetencies } from "../../src/ai/flows/score-competencies";
import { checkEvidenceGrounding, norm } from "../../src/lib/quality-core";

type Scenario = {
  id: string;
  lang: string;
  leaderLabel: string;
  employeeLabel: string;
  transcript: string;
  expect: {
    observableCompetencies: string[];
    notObservableCompetencies: string[];
    mustNotMention: string[];
    expectedLang: string;
  };
};

type Comp = { id: string; name?: string; score: number | null; evidence?: string[]; why?: string };

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.split("=")[1];
const nRuns = Math.max(1, Number(args.find((a) => a.startsWith("--n="))?.split("=")[1] ?? "1"));
const withJudge = args.includes("--judge");

const scenarios: Scenario[] = JSON.parse(
  readFileSync(join(here, "golden-set.json"), "utf8")
).filter((s: Scenario) => !only || s.id === only);

// Sehr grobe Sprachheuristik (de vs en) für den Locale-Check
function looksGerman(text: string): boolean {
  const t = norm(text);
  if (/[äöüß]/.test(t)) return true;
  return /\b(und|nicht|der|die|das|wird|sich|für|sie|ich|haben|werden)\b/.test(t);
}

async function runScenario(s: Scenario) {
  const hardFails: string[] = [];
  const warns: string[] = [];

  // ggf. mehrfach laufen für Score-Stabilität
  const runs: Comp[][] = [];
  for (let i = 0; i < nRuns; i++) {
    const out: any = await scoreCompetencies({
      transcriptText: s.transcript,
      lang: s.lang,
      leaderLabel: s.leaderLabel,
      employeeLabel: s.employeeLabel,
    } as any);
    runs.push(Array.isArray(out?.competencies) ? out.competencies : []);
  }
  const comps = runs[0];
  const byId = new Map(comps.map((c) => [String(c.id).trim(), c]));

  // 1) FAITHFULNESS (hart): Evidenz muss wörtlich im Transkript stehen
  const grounding = checkEvidenceGrounding(comps as any, s.transcript);
  for (const g of grounding) hardFails.push(`grounding: ${g.message}`);

  // 2) NEGATIV-TEST (hart): nicht-beobachtbare Kompetenzen MÜSSEN score=null haben
  for (const id of s.expect.notObservableCompetencies) {
    const c = byId.get(id);
    if (c && typeof c.score === "number") {
      hardFails.push(`negativ: ${id} hat Score ${c.score}, erwartet null (nicht beobachtbar)`);
    }
  }

  // 3) HALLUZINATION (hart): verbotene Begriffe dürfen nicht in why/evidence auftauchen
  const blob = norm(comps.map((c) => `${c.why ?? ""} ${(c.evidence ?? []).join(" ")}`).join(" "));
  for (const term of s.expect.mustNotMention) {
    if (blob.includes(norm(term))) hardFails.push(`halluzination: erwähnt "${term}" (nicht im Transkript)`);
  }

  // 4) OBSERVABLE (weich): beobachtbare Kompetenzen sollten einen Score haben
  for (const id of s.expect.observableCompetencies) {
    const c = byId.get(id);
    if (!c || typeof c.score !== "number") warns.push(`observable: ${id} ohne Score (erwartet bewertet)`);
  }

  // 5) LOCALE (weich): Begründungen in der Zielsprache — nur GESCORTE Kompetenzen,
  // da nicht-beobachtbare einen sprach-neutralen Fallback-Text tragen.
  const whyBlob = comps.filter((c) => typeof c.score === "number").map((c) => c.why ?? "").join(" ");
  if (whyBlob.trim()) {
    const isGerman = looksGerman(whyBlob);
    if (s.expect.expectedLang === "de" && !isGerman) warns.push("locale: erwartet DE, wirkt nicht deutsch");
    if (s.expect.expectedLang === "en" && isGerman) warns.push("locale: erwartet EN, wirkt deutsch");
  }

  // 6) STABILITÄT (weich, nur bei --n>1): Score-Spannweite je Kompetenz
  if (nRuns > 1) {
    for (const id of [...byId.keys()]) {
      const scores = runs.map((r) => r.find((c) => String(c.id).trim() === id)?.score).filter((x) => typeof x === "number") as number[];
      if (scores.length >= 2) {
        const spread = Math.max(...scores) - Math.min(...scores);
        if (spread >= 2) warns.push(`stabilität: ${id} schwankt um ${spread} Punkte über ${nRuns} Läufe`);
      }
    }
  }

  return { id: s.id, pass: hardFails.length === 0, hardFails, warns, comps };
}

(async () => {
  console.log(`\n=== Regression: ${scenarios.length} Szenario(en), n=${nRuns}${withJudge ? ", +judge" : ""} ===\n`);
  let passed = 0;
  const judgeResults: any[] = [];

  for (const s of scenarios) {
    try {
      const r = await runScenario(s);
      if (r.pass) passed++;
      console.log(`${r.pass ? "✅ PASS" : "❌ FAIL"}  ${r.id}`);
      r.hardFails.forEach((f) => console.log(`     ✗ ${f}`));
      r.warns.forEach((w) => console.log(`     ⚠ ${w}`));

      if (withJudge) {
        const { judgeAnalysis } = await import("./judge");
        const verdict = await judgeAnalysis(s, r.comps);
        if (verdict) {
          judgeResults.push({ id: s.id, ...verdict });
          console.log(`     ⚖ Judge: ${verdict.summary} (Ø ${verdict.avg.toFixed(2)}/5)`);
        }
      }
    } catch (e: any) {
      console.log(`❌ FAIL  ${s.id}  (Exception: ${e?.message ?? e})`);
    }
  }

  console.log(`\n=== Ergebnis: ${passed}/${scenarios.length} PASS (deterministisch) ===`);
  if (withJudge && judgeResults.length) {
    const avg = judgeResults.reduce((n, j) => n + j.avg, 0) / judgeResults.length;
    console.log(`=== Judge-Durchschnitt: ${avg.toFixed(2)}/5 über ${judgeResults.length} Szenarien ===`);
  }
  process.exit(passed === scenarios.length ? 0 : 1);
})();
