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
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: join(here, "..", "..", ".env.local") });

import { scoreCompetencies } from "../../src/ai/flows/score-competencies";
import { GENKIT_MODEL_ID, GENKIT_TEMPERATURE } from "../../src/ai/genkit";
import {
  COMPETENCY_KEYS,
  metricsFromCompetencyRatings,
  type CompetencyKey,
} from "../../src/lib/radar-contract";

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

if (!live) {
  console.error(
    "ABBRUCH: dieses Skript ruft das ECHTE Gemini-Modell auf (Token-Kosten).\n" +
      "Explizit bestätigen mit:  npx tsx --conditions=react-server scripts/quality/reliability.ts --live [--n=5] [--only=<id>]"
  );
  process.exit(2);
}

const scenarios: Scenario[] = JSON.parse(
  readFileSync(join(here, "golden-set.json"), "utf8")
).filter((s: Scenario) => !only || s.id === only);

if (scenarios.length === 0) {
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

(async () => {
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
