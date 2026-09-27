/**
 * Rollenspiel-Prüfset (Blueprint COACH-OPTIMIERUNG 27.09.2026, O1/O6):
 * sechs realistische Simulationen laufen OFFLINE durch dieselbe Pipeline wie
 * /api/simulation/finish — Debrief (S1–S5, Karten, nextStep), C1–C10-Scoring,
 * Qualitäts-Gate, deterministische Gesamtwertung. Kein Credit, kein Radar-
 * Messpunkt, keine Kundendaten (NorthBay-Welt; zwei Läufe sind Claudes eigene
 * Testgespräche vom 26./27.09.).
 *
 *   npm run quality:sim                      # alle Fälle
 *   npm run quality:sim -- --only=vance-weak-confrontation
 *   npm run quality:sim -- --out=pfad.json   # Rohdaten sichern
 *   npm run quality:sim -- --judge           # zusätzlich Gemini-Judge (O6)
 *
 * Misst je Fall: Urteil/Score, zurückgehaltene Rubrik-Scores (Gate), C-Scores
 * und null-Anteil, Kanon-Treue (nextStep-Muster, 3.-Person-Begründungen,
 * Personen-Urteile), Karten, Wortzahlen. Harte Erwartungen aus dem Set:
 * verdict, maxWithheld, notObservable (C-ids, die null sein MÜSSEN).
 *
 * Env: GEMINI_API_KEY, COSMOS_ENDPOINT/COSMOS_KEY (Karten) aus .env.local.
 * Läuft mit --conditions=react-server (simulation-store ist server-only).
 */
import { config } from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: join(here, "..", "..", ".env.local") });

import { GENKIT_MODEL_ID } from "../../src/ai/genkit";
import { getScenario } from "../../src/lib/simulation/scenarios";
import { generateSimulationFeedback } from "../../src/ai/flows/simulation-feedback";
import { scoreCompetencies } from "../../src/ai/flows/score-competencies";
import { normalizeCompetencyRatings } from "../../src/lib/competency-model";
import { collectQualityNotes, type QualityNote } from "../../src/lib/quality-core";
import { computeDebrief } from "../../src/lib/simulation/debrief";
import { assembleTranscript } from "../../src/lib/server/simulation-store";
import { findPersonJudgments } from "../../src/lib/coach-canon";
import type { SimulationTurn } from "../../src/lib/simulation/types";

type Case = {
  id: string;
  scenarioId: string;
  convoLocale: "de" | "en";
  note?: string;
  turns: Array<{ role: "user" | "persona"; text: string }>;
  expect: {
    verdict?: string[];
    maxWithheld?: number;
    notObservable?: string[];
    minScoredRubric?: number;
    minNullC?: number;
    maxOverall?: number;
    lang?: string;
  };
};

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.split("=")[1];
const outPath = args.find((a) => a.startsWith("--out="))?.split("=")[1];
const withJudge = args.includes("--judge");

const cases: Case[] = JSON.parse(readFileSync(join(here, "sim-golden-set.json"), "utf8")).filter(
  (c: Case) => !only || c.id === only
);

const CANON_DE = /(in dem moment|als du|du hast .{0,80}gesagt|das führte dazu|dadurch|wirksamerer weg|ein wirksamerer)/i;
const CANON_EN = /(at the moment|when you|you said|that led to|more effective (path|way))/i;
const THIRD_PERSON = /^\s*(der\/die|der|die|the)\s+(übende|teilnehmer|führungskraft|participant|leader|trainee|user)/i;
const HEAD_WORDS = (s: string) => String(s ?? "").trim().split(/\s+/).filter(Boolean).length;

async function runCase(c: Case) {
  const scenario = getScenario(c.scenarioId);
  if (!scenario) throw new Error(`Szenario ${c.scenarioId} unbekannt`);
  const turns: SimulationTurn[] = c.turns.map((t, i) => ({ role: t.role, text: t.text, ts: new Date(Date.UTC(2026, 8, 27, 9, 0, i)).toISOString() }));
  const transcript = assembleTranscript(turns, scenario.persona.name);
  const rawTurns = turns.map((t) => t.text).join("\n");

  const t0 = Date.now();
  const [fb, comp] = await Promise.all([
    generateSimulationFeedback({ scenario, turns, convoLocale: c.convoLocale }),
    scoreCompetencies({
      transcriptText: transcript,
      lang: c.convoLocale,
      leaderLabel: "Teilnehmer:in",
      employeeLabel: scenario.persona.name,
      scenarioCategory: scenario.category,
    } as any),
  ]);
  const ms = Date.now() - t0;
  const ratings = normalizeCompetencyRatings(comp, { lang: c.convoLocale, leaderLabel: "Teilnehmer:in", employeeLabel: scenario.persona.name });

  // Gate — wie /api/simulation/finish (P2): C-Ratings + S-Rubrik über denselben Check.
  const rubricForCheck = fb.rubric.map((r) => ({ id: r.key, score: r.score, evidence: r.evidence ?? [] }));
  const notes: QualityNote[] = collectQualityNotes(
    { summary: fb.summary, competency_ratings: [...(ratings as any[]), ...rubricForCheck] },
    // Vergleichstext: rohe Beiträge ohne Sprecher-Labels (Blueprint O1a, Gemini Zu 1).
    rawTurns
  );
  const withheld = new Set(notes.filter((n) => n.code === "EVIDENCE_ALL_UNGROUNDED").map((n) => n.field as string));
  const rubricAfterGate = fb.rubric.map((r) => (withheld.has(r.key) ? { ...r, score: null } : r));
  const debrief = computeDebrief({
    rubric: rubricAfterGate.map((r) => ({ key: r.key, label: r.label, score: r.score })),
    checkpoints: fb.checkpoints.map((x) => ({ id: x.id, hit: x.hit })),
    passThreshold: scenario.assessment.passThreshold,
  });

  const cNull = ratings.filter((r) => r.score == null).map((r) => r.id);
  const cScored = ratings.filter((r) => typeof r.score === "number");
  const canonRe = c.convoLocale === "en" ? CANON_EN : CANON_DE;
  const whyThird = [...fb.rubric.map((r) => r.why), ...ratings.map((r) => r.why)].filter((w) => THIRD_PERSON.test(String(w ?? "")));
  const judgments = findPersonJudgments([fb.summary, fb.nextStep, ...fb.rubric.map((r) => r.why), ...fb.checkpoints.map((x) => x.comment)].join("\n"));

  // Harte Erwartungen
  const fails: string[] = [];
  const e = c.expect;
  if (e.verdict && !e.verdict.includes(debrief.verdict)) fails.push(`verdict ${debrief.verdict} (erwartet ${e.verdict.join("|")})`);
  if (typeof e.maxWithheld === "number" && withheld.size > e.maxWithheld) fails.push(`zurückgehalten ${[...withheld].join(",")} (max ${e.maxWithheld})`);
  for (const id of e.notObservable ?? []) {
    const r = ratings.find((x) => x.id === id);
    if (r && typeof r.score === "number") fails.push(`${id}=${r.score}, erwartet null`);
  }
  if (typeof e.minScoredRubric === "number" && rubricAfterGate.filter((r) => typeof r.score === "number").length < e.minScoredRubric)
    fails.push(`nur ${rubricAfterGate.filter((r) => typeof r.score === "number").length}/5 Rubrik-Scores (min ${e.minScoredRubric})`);
  if (typeof e.minNullC === "number" && cNull.length < e.minNullC) fails.push(`nur ${cNull.length} C-null (min ${e.minNullC})`);
  if (typeof e.maxOverall === "number" && (debrief.overall ?? 0) > e.maxOverall) fails.push(`overall ${debrief.overall} > ${e.maxOverall}`);

  // Weiche Beobachtungen (Kanon)
  const soft: string[] = [];
  if (!canonRe.test(fb.nextStep)) soft.push("nextStep ohne Kanon-Muster");
  if (HEAD_WORDS(fb.nextStep) > 110) soft.push(`nextStep ${HEAD_WORDS(fb.nextStep)} Wörter`);
  if (whyThird.length) soft.push(`${whyThird.length} Begründungen in 3. Person`);
  if (judgments.length) soft.push(`Personen-Urteile: ${judgments.slice(0, 3).join(" | ")}`);
  if (!fb.cards?.length) soft.push("keine Karten");

  let judge: any = null;
  if (withJudge) {
    const { judgeSimulation } = await import("./judge");
    judge = await judgeSimulation({ transcript, feedback: fb, ratings });
  }

  return {
    id: c.id, ms, pass: fails.length === 0, fails, soft,
    overall: debrief.overall, verdict: debrief.verdict, coverage: debrief.coverage,
    rubric: rubricAfterGate.map((r) => `${r.key}=${r.score ?? "∅"}`).join(" "),
    withheld: [...withheld],
    cScores: ratings.map((r) => `${r.id}=${r.score ?? "∅"}`).join(" "),
    cNull: cNull.length,
    checkpointsHit: fb.checkpoints.filter((x) => x.hit).length + "/" + fb.checkpoints.length,
    cards: (fb.cards ?? []).map((k) => k.title),
    nextStep: fb.nextStep, summary: fb.summary,
    rubricWhy: fb.rubric.map((r) => ({ key: r.key, why: r.why, evidence: r.evidence })),
    ratings, notes, judge,
  };
}

async function main() {
  console.log(`=== Rollenspiel-Prüfset: ${cases.length} Fall/Fälle${withJudge ? " +judge" : ""} · Schreiber ${GENKIT_MODEL_ID} · Konsens ${(process.env.SCORING_CONSENSUS ?? "off").toLowerCase()} ===\n`);
  const results: any[] = [];
  for (const c of cases) {
    try {
      const r = await runCase(c);
      results.push(r);
      console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id} — ${r.overall ?? "–"} % ${r.verdict} · Rubrik ${r.rubric} · zurückgehalten [${r.withheld.join(",")}] · C-null ${r.cNull}/10 · Momente ${r.checkpointsHit} · ${Math.round(r.ms / 1000)} s`);
      console.log(`     C: ${r.cScores}`);
      console.log(`     Karten: ${r.cards.join(" · ") || "—"}`);
      console.log(`     nextStep (${HEAD_WORDS(r.nextStep)} W): ${r.nextStep.slice(0, 220)}${r.nextStep.length > 220 ? "…" : ""}`);
      for (const f of r.fails) console.log(`     ✗ ${f}`);
      for (const s of r.soft) console.log(`     ~ ${s}`);
      if (r.judge) console.log(`     ⚖ Judge Ø ${r.judge.avg.toFixed(2)} — ${Object.entries(r.judge.dims).map(([k, v]) => `${k}=${v}`).join(" ")}`);
    } catch (err) {
      results.push({ id: c.id, pass: false, fails: [String((err as Error)?.message ?? err)] });
      console.log(`FAIL ${c.id} — ${(err as Error)?.message ?? err}`);
    }
    console.log("");
  }
  const passed = results.filter((r) => r.pass).length;
  const withheldTotal = results.reduce((a, r) => a + (r.withheld?.length ?? 0), 0);
  const unrated = results.filter((r) => r.verdict === "unrated").length;
  const cNullAvg = results.filter((r) => typeof r.cNull === "number").reduce((a, r) => a + r.cNull, 0) / Math.max(1, results.length);
  const canonMiss = results.filter((r) => (r.soft ?? []).some((s: string) => s.startsWith("nextStep ohne Kanon"))).length;
  const thirdPerson = results.reduce((a, r) => a + ((r.soft ?? []).find((s: string) => s.includes("3. Person")) ? 1 : 0), 0);
  const msAvg = results.filter((r) => typeof r.ms === "number").reduce((a, r) => a + r.ms, 0) / Math.max(1, results.filter((r) => typeof r.ms === "number").length);
  console.log(`=== Summe: ${passed}/${results.length} PASS · zurückgehaltene Scores gesamt ${withheldTotal} · ohne Urteil ${unrated} · Ø C-null ${cNullAvg.toFixed(1)}/10 · nextStep ohne Kanon ${canonMiss} · Fälle mit 3.-Person-Begründungen ${thirdPerson} · Ø ${Math.round(msAvg / 1000)} s je Fall · Modell ${GENKIT_MODEL_ID} ===`);
  if (outPath) {
    writeFileSync(outPath, JSON.stringify({ at: new Date().toISOString(), model: GENKIT_MODEL_ID, consensus: process.env.SCORING_CONSENSUS ?? "off", results }, null, 1), "utf8");
    console.log(`Rohdaten: ${outPath}`);
  }
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error("sim-regression FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
