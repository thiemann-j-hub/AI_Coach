/**
 * Reliabilitäts-Harness (P0-3, Best-in-Class-Welle) — misst die
 * WIEDERHOL-ZUVERLÄSSIGKEIT des Kompetenz-Scorings: dieselben
 * Golden-Transkripte n-fach durch den ECHTEN `scoreCompetencies`-Flow,
 * dann Streuung je Kompetenz. Der Längsschnitt (das Geschäftsmodell) ist nur
 * so glaubwürdig wie diese Zahl: streut dieselbe Eingabe um ±1 auf der
 * 4er-Skala, ist jede Trendlinie Rauschen.
 *
 * PLATTFORM-AUFLAGEN (Rückmeldung C):
 *  (a) Modell-ID + Temperatur werden im Ergebnis protokolliert (Modell-Drift
 *      von Mess-Streuung trennbar halten).
 *  (b) Streuung wird auf der 1–4-VERTRAGSSKALA ausgewiesen — gemappt über
 *      metricsFromCompetencyRatings (radar-contract), exakt wie der Radar-Emit.
 *  (c) null-Flattern wird mitgemessen: eine Kompetenz, die in Lauf 1
 *      „beobachtbar 3" und in Lauf 3 „nicht beobachtbar" ist, ist auch
 *      Unzuverlässigkeit — die keine Standardabweichung sieht.
 *
 * OPS-/ON-DEMAND-SKRIPT — NICHT im CI-Gate (kostet echte Gemini-Tokens).
 * `--live` ist PFLICHT (expliziter Token-Burn-Consent).
 *
 * Aufruf:
 *   npx tsx --conditions=react-server scripts/quality/reliability.ts --live            # alle Szenarien, n=5
 *   npx tsx --conditions=react-server scripts/quality/reliability.ts --live --n=3
 *   npx tsx --conditions=react-server scripts/quality/reliability.ts --live --only=01-…
 * Ergebnis: stdout-Tabelle + JSON-Report unter scripts/quality/reports/.
 *
 * ROLLENSPIEL-RICHTER (Paket 3, C16/U16, 12.11.2026): mit `--sim` misst das Skript stattdessen die Streuung der
 * Auswertung eines Rollenspiels — dieselben Gespräche aus sim-golden-set.json n-fach durch den ECHTEN Richter
 * (`judgeSimulation`), dann je Szenario: Spanne und Standardabweichung der Stufe je Fähigkeit, Flattern
 * (mal bewertet, mal „nicht beobachtbar“), Spanne der Gesamtpunktzahl, ob das Urteil kippt (bestanden / nicht
 * bestanden), ob Schlüsselmomente kippen. Anlass: Der schnelle Richter läuft seit Paket 3 mit Temperatur 0; diese
 * Messung zeigt, ob das die Streuung genug bremst (ein zweites Urteil an der Grenze gibt es bewusst nicht).
 * Gemessen wird das ROHE Urteil des Richters (ohne Zitat-Gate), gerechnet wie in der Route (Gewichte, Grenze).
 *   npm run quality:reliability -- --live --sim                    # alle Fälle, n=5, Richter laut COACH_RICHTER
 *   npm run quality:reliability -- --live --sim --n=3 --only=morgan-strong
 *   npm run quality:reliability -- --live --sim --richter=gemini   # Richter erzwingen (gemini | opus)
 * Ergebnis: stdout-Tabelle + JSON-Report scripts/quality/reports/reliability-sim-<Datum>.json.
 * Kostet je Fall n Richter-Aufrufe (plus Kartensuche); kein Credit, kein Radar-Messpunkt, keine Kundendaten.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: join(here, "..", "..", ".env.local") });

import { scoreCompetencies } from "../../src/ai/flows/score-competencies";
import { RICHTER_GEMINI_TEMPERATURE, judgeSimulation } from "../../src/ai/flows/simulation-feedback";
import { GENKIT_MODEL_ID, GENKIT_TEMPERATURE } from "../../src/ai/genkit";
import {
  COMPETENCY_KEYS,
  metricsFromCompetencyRatings,
  type CompetencyKey,
} from "../../src/lib/radar-contract";
import { computeDebrief } from "../../src/lib/simulation/debrief";
import { getScenario } from "../../src/lib/simulation/scenarios";
import { bestimmeErgebnis } from "../../src/lib/simulation/tatsachen";
import type { SimulationTurn } from "../../src/lib/simulation/types";

type Scenario = {
  id: string;
  lang: string;
  leaderLabel: string;
  employeeLabel: string;
  transcript: string;
};

const args = process.argv.slice(2);
const live = args.includes("--live");
const only = args.find((a) => a.startsWith("--only="))?.split("=")[1];
const nRuns = Math.max(2, Number(args.find((a) => a.startsWith("--n="))?.split("=")[1] ?? "5"));
/** Paket 3: Streuung des Rollenspiel-Richters statt des Kompetenz-Scorings. */
const simMode = args.includes("--sim");
const richterArg = args.find((a) => a.startsWith("--richter="))?.split("=")[1];
const richterWahl: "gemini" | "opus" | undefined = richterArg === "gemini" || richterArg === "opus" ? richterArg : undefined;

if (!live) {
  console.error(
    "ABBRUCH: dieses Skript ruft das ECHTE Gemini-Modell auf (Token-Kosten).\n" +
      "Explizit bestätigen mit:  npx tsx --conditions=react-server scripts/quality/reliability.ts --live [--sim] [--n=5] [--only=<id>]"
  );
  process.exit(2);
}

const scenarios: Scenario[] = simMode
  ? []
  : JSON.parse(readFileSync(join(here, "golden-set.json"), "utf8")).filter((s: Scenario) => !only || s.id === only);

if (!simMode && scenarios.length === 0) {
  console.error(`Kein Szenario gefunden${only ? ` für --only=${only}` : ""}.`);
  process.exit(2);
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}
const r2 = (n: number) => Math.round(n * 100) / 100;

interface CompetencyStats {
  key: CompetencyKey;
  /** In wie vielen der n Läufe war die Kompetenz beobachtbar? */
  observedIn: number;
  /** null-Flattern: beobachtbar in MANCHEN, aber nicht allen Läufen. */
  flutter: boolean;
  values: number[]; // 1–4-Skala (nur beobachtete)
  mean: number | null;
  min: number | null;
  max: number | null;
  range: number | null;
  stddev: number | null;
}

async function runScenario(s: Scenario) {
  const perRunMetrics: Array<Record<string, number | null>> = [];
  for (let i = 0; i < nRuns; i++) {
    process.stdout.write(`  Lauf ${i + 1}/${nRuns}…\r`);
    const out: any = await scoreCompetencies({
      transcriptText: s.transcript,
      lang: s.lang,
      leaderLabel: s.leaderLabel,
      employeeLabel: s.employeeLabel,
    } as any);
    const ratings = out?.competencies ?? out?.competency_ratings ?? out ?? [];
    // SSOT: dieselbe Mapping-Funktion wie der Radar-Emit (0/null ⇒ nicht beobachtbar, 1–4)
    perRunMetrics.push(metricsFromCompetencyRatings(ratings));
  }

  const stats: CompetencyStats[] = COMPETENCY_KEYS.map((k) => {
    const values = perRunMetrics
      .map((m) => m[k])
      .filter((v): v is number => typeof v === "number");
    const observedIn = values.length;
    return {
      key: k,
      observedIn,
      flutter: observedIn > 0 && observedIn < nRuns, // (c) null-Flattern
      values,
      mean: observedIn ? r2(values.reduce((a, b) => a + b, 0) / observedIn) : null,
      min: observedIn ? Math.min(...values) : null,
      max: observedIn ? Math.max(...values) : null,
      range: observedIn ? r2(Math.max(...values) - Math.min(...values)) : null,
      stddev: observedIn >= 2 ? r2(stddev(values)) : null,
    };
  });

  const overalls = perRunMetrics
    .map((m) => m.overall)
    .filter((v): v is number => typeof v === "number");

  return {
    scenario: s.id,
    lang: s.lang,
    runs: nRuns,
    perRunMetrics,
    competencies: stats,
    overall: {
      values: overalls,
      mean: overalls.length ? r2(overalls.reduce((a, b) => a + b, 0) / overalls.length) : null,
      range: overalls.length ? r2(Math.max(...overalls) - Math.min(...overalls)) : null,
      stddev: overalls.length >= 2 ? r2(stddev(overalls)) : null,
    },
    flutterCount: stats.filter((c) => c.flutter).length,
    maxRange: Math.max(0, ...stats.map((c) => c.range ?? 0)),
  };
}

// ── Rollenspiel-Richter: Streuung je Szenario (Paket 3, C16/U16) ─────────────

type SimCase = {
  id: string;
  scenarioId: string;
  convoLocale: "de" | "en";
  turns: Array<{ role: "user" | "persona"; text: string }>;
};

interface SimRun {
  /** Stufe 1–4 je Fähigkeit; null = nicht beobachtbar. */
  scores: Record<string, number | null>;
  /** Schlüsselmoment getroffen? */
  hits: Record<string, boolean>;
  /** Gesamtpunktzahl 0–100 (computeDebrief); null = nicht bewertbar. */
  overall: number | null;
  verdict: string;
  judge: string;
  fallback: string | null;
  judgeMs: number;
  sachlichNichtGedeckt: number;
}

async function runSimCase(c: SimCase) {
  const scenario = getScenario(c.scenarioId);
  if (!scenario) throw new Error(`Szenario ${c.scenarioId} unbekannt`);
  const turns: SimulationTurn[] = c.turns.map((t, i) => ({
    role: t.role,
    text: t.text,
    ts: new Date(Date.UTC(2026, 10, 12, 9, 0, i)).toISOString(),
  }));
  const weightByKey = new Map(scenario.assessment.competencies.map((x) => [x.key, x.weight]));

  const runs: SimRun[] = [];
  for (let i = 0; i < nRuns; i++) {
    process.stdout.write(`  Lauf ${i + 1}/${nRuns}…\r`);
    const { feedback, richter } = await judgeSimulation({ scenario, turns, convoLocale: c.convoLocale, richter: richterWahl });
    // Rechnung wie in der Route: Gewichte und Bestehensgrenze des Szenarios, Ergebnis aus dem Urteil des Richters.
    const debrief = computeDebrief({
      rubric: feedback.rubric.map((r) => ({ key: r.key, label: r.label, score: r.score, weight: weightByKey.get(r.key) })),
      checkpoints: feedback.checkpoints.map((x) => ({ id: x.id, hit: x.hit })),
      passThreshold: scenario.assessment.passThreshold,
      ergebnis: bestimmeErgebnis({ zielErreicht: feedback.zielErreicht ?? null }),
    });
    runs.push({
      scores: Object.fromEntries(feedback.rubric.map((r) => [r.key, r.score])),
      hits: Object.fromEntries(feedback.checkpoints.map((x) => [x.id, x.hit])),
      overall: debrief.overall,
      verdict: debrief.verdict,
      judge: richter.judge,
      fallback: richter.fallback,
      judgeMs: richter.judgeMs,
      sachlichNichtGedeckt: feedback.sachlichNichtGedeckt?.length ?? 0,
    });
  }

  const anchors = scenario.assessment.competencies.map((a) => {
    const values = runs.map((r) => r.scores[a.key]).filter((v): v is number => typeof v === "number");
    const observedIn = values.length;
    return {
      key: a.key,
      label: a.label,
      observedIn,
      flutter: observedIn > 0 && observedIn < nRuns,
      values,
      mean: observedIn ? r2(values.reduce((x, y) => x + y, 0) / observedIn) : null,
      range: observedIn ? r2(Math.max(...values) - Math.min(...values)) : null,
      stddev: observedIn >= 2 ? r2(stddev(values)) : null,
    };
  });
  const checkpoints = scenario.assessment.checkpoints.map((cp) => {
    const hitIn = runs.filter((r) => r.hits[cp.id]).length;
    return { id: cp.id, hitIn, flip: hitIn > 0 && hitIn < nRuns };
  });
  const overalls = runs.map((r) => r.overall).filter((v): v is number => typeof v === "number");
  const verdicts = [...new Set(runs.map((r) => r.verdict))];

  return {
    case: c.id,
    scenario: c.scenarioId,
    lang: c.convoLocale,
    runs: nRuns,
    perRun: runs,
    anchors,
    checkpoints,
    overall: {
      values: overalls,
      mean: overalls.length ? r2(overalls.reduce((x, y) => x + y, 0) / overalls.length) : null,
      range: overalls.length ? r2(Math.max(...overalls) - Math.min(...overalls)) : null,
      stddev: overalls.length >= 2 ? r2(stddev(overalls)) : null,
    },
    verdicts,
    /** Das Urteil ist bei gleicher Eingabe nicht dasselbe — der Befund, den U16 beschreibt. */
    verdictFlip: verdicts.length > 1,
    flutterCount: anchors.filter((a) => a.flutter).length,
    checkpointFlips: checkpoints.filter((x) => x.flip).length,
    maxAnchorRange: Math.max(0, ...anchors.map((a) => a.range ?? 0)),
    judges: [...new Set(runs.map((r) => (r.fallback ? `${r.judge} (Rückfall: ${r.fallback})` : r.judge)))],
    meanJudgeMs: Math.round(runs.reduce((x, r) => x + r.judgeMs, 0) / runs.length),
  };
}

async function runSimReliability() {
  const cases: SimCase[] = JSON.parse(readFileSync(join(here, "sim-golden-set.json"), "utf8")).filter(
    (c: SimCase) => !only || c.id === only
  );
  if (cases.length === 0) {
    console.error(`Kein Fall gefunden${only ? ` für --only=${only}` : ""}.`);
    process.exit(2);
  }
  const wunsch = richterWahl ?? ((process.env.COACH_RICHTER ?? "gemini").trim().toLowerCase() === "opus" ? "opus" : "gemini");
  console.log(
    `Reliabilitäts-Harness Rollenspiel-Richter — Richter: ${wunsch} · schnelles Modell: ${GENKIT_MODEL_ID} (Temperatur ${RICHTER_GEMINI_TEMPERATURE}) · n=${nRuns} je Fall · ${cases.length} Fall/Fälle\n`
  );
  const results = [];
  for (const c of cases) {
    console.log(`Fall ${c.id} (Szenario ${c.scenarioId}, ${c.convoLocale}):`);
    const r = await runSimCase(c);
    results.push(r);
    console.log(
      `  Gesamt: mean=${r.overall.mean} Spanne=${r.overall.range} stddev=${r.overall.stddev} [${r.overall.values.join(",")}] (0–100) · Urteil: ${r.verdicts.join(" / ")}${r.verdictFlip ? "  ⚠ URTEIL KIPPT" : ""}`
    );
    for (const a of r.anchors) {
      const flutter = a.flutter ? `  ⚠ FLATTERN (bewertet in ${a.observedIn}/${nRuns})` : "";
      console.log(
        a.observedIn
          ? `  ${a.key}: mean=${a.mean} Spanne=${a.range} stddev=${a.stddev} [${a.values.join(",")}]${flutter}`
          : `  ${a.key}: in keinem Lauf beobachtbar`
      );
    }
    const flips = r.checkpoints.filter((x) => x.flip);
    if (flips.length) console.log(`  Schlüsselmomente kippen: ${flips.map((x) => `${x.id} (${x.hitIn}/${nRuns})`).join(", ")}`);
    console.log(`  Richter: ${r.judges.join(", ")} · im Mittel ${r.meanJudgeMs} ms je Urteil\n`);
  }

  const worstRange = Math.max(...results.map((r) => r.maxAnchorRange));
  const worstOverall = Math.max(...results.map((r) => r.overall.range ?? 0));
  const verdictFlips = results.filter((r) => r.verdictFlip).map((r) => r.case);
  const totalFlutter = results.reduce((a, r) => a + r.flutterCount, 0);
  console.log("=== VERDIKT ROLLENSPIEL-RICHTER ===");
  console.log(`größte Spanne einer Fähigkeit (Stufen 1–4): ${worstRange}`);
  console.log(`größte Spanne der Gesamtpunktzahl (0–100): ${worstOverall}`);
  console.log(`Urteil kippt in ${verdictFlips.length} von ${results.length} Fällen${verdictFlips.length ? `: ${verdictFlips.join(", ")}` : ""}`);
  console.log(`Flattern gesamt: ${totalFlutter} Fähigkeit×Fall`);
  console.log(
    verdictFlips.length > 0 || worstRange > 1 || totalFlutter > 0
      ? "→ AUFFÄLLIG: Dieselbe Eingabe führt zu verschiedenen Urteilen oder Stufen — Rubrik-Texte der betroffenen Fähigkeiten schärfen; erst danach über ein zweites Urteil an der Grenze nachdenken."
      : "→ STABIL: Spanne je Fähigkeit ≤ 1 Stufe, kein Flattern, kein Fall kippt."
  );

  const report = {
    generatedAt: new Date().toISOString(),
    kind: "simulation-judge",
    richter: wunsch,
    fastModel: GENKIT_MODEL_ID,
    fastModelTemperature: RICHTER_GEMINI_TEMPERATURE,
    scale: "Fähigkeiten: Stufe 1–4 · Gesamt: 0–100 (computeDebrief)",
    nRuns,
    results,
  };
  const outDir = join(here, "reports");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `reliability-sim-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`\nJSON-Report: ${outFile}`);
}

(async () => {
  if (simMode) {
    await runSimReliability();
    return;
  }
  console.log(
    `Reliabilitäts-Harness — Modell: ${GENKIT_MODEL_ID} · Temperatur: ${GENKIT_TEMPERATURE} · n=${nRuns} je Szenario · ${scenarios.length} Szenario(s)\n`
  );
  const results = [];
  for (const s of scenarios) {
    console.log(`Szenario ${s.id} (${s.lang}):`);
    const r = await runScenario(s);
    results.push(r);
    console.log(
      `  overall: mean=${r.overall.mean} range=${r.overall.range} stddev=${r.overall.stddev} (1–4-Skala)`
    );
    for (const c of r.competencies) {
      if (c.observedIn === 0) continue;
      const flutter = c.flutter ? `  ⚠ FLATTERN (beobachtbar in ${c.observedIn}/${nRuns})` : "";
      console.log(
        `  ${c.key}: mean=${c.mean} range=${c.range} stddev=${c.stddev} [${c.values.join(",")}]${flutter}`
      );
    }
    console.log("");
  }

  // Verdikt-Heuristik: range > 1 auf der 4er-Skala oder Flattern = rot.
  const worstRange = Math.max(...results.map((r) => r.maxRange));
  const totalFlutter = results.reduce((a, r) => a + r.flutterCount, 0);
  console.log("=== VERDIKT ===");
  console.log(`max. Kompetenz-Range über alle Szenarien: ${worstRange} (auf 1–4)`);
  console.log(`null-Flattern gesamt: ${totalFlutter} Kompetenz×Szenario`);
  console.log(
    worstRange > 1 || totalFlutter > 0
      ? "→ AUFFÄLLIG: Streuung/Flattern gefährdet die Trend-Aussage — Median-of-n bzw. Prompt-Härtung prüfen."
      : "→ STABIL genug für Trendlinien (Range ≤ 1, kein Flattern)."
  );

  const report = {
    generatedAt: new Date().toISOString(),
    model: GENKIT_MODEL_ID,
    temperature: GENKIT_TEMPERATURE,
    scale: "1-4 (radar-contract, metricsFromCompetencyRatings)",
    nRuns,
    results,
  };
  const outDir = join(here, "reports");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `reliability-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`\nJSON-Report: ${outFile}`);
})().catch((e) => {
  console.error("Harness-Fehler:", e);
  process.exit(1);
});
