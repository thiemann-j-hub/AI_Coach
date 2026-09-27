/**
 * Kennzahlen der Auswertungsqualität (Blueprint COACH-OPTIMIERUNG 27.09.2026, O6).
 *
 *   npm run quality:stats            # letzte 30 Tage
 *   npm run quality:stats -- --days=90 --json=pfad.json
 *
 * Dieselbe Rechnung wie /api/quality/stats (Tagesbriefing) — Logik in
 * src/lib/server/quality-stats.ts. Läuft mit --conditions=react-server.
 */
import { config } from "dotenv";
import { writeFileSync } from "node:fs";
config({ path: ".env.local" });
import { computeQualityStats, formatQualityStatsLine } from "../../src/lib/server/quality-stats";

const args = process.argv.slice(2);
const days = Math.max(1, Number(args.find((a) => a.startsWith("--days="))?.split("=")[1] ?? "30"));
const jsonOut = args.find((a) => a.startsWith("--json="))?.split("=")[1];

async function main() {
  const out = await computeQualityStats(days);
  const sim = out.simulations;
  console.log(`── Auswertungsqualität, letzte ${out.days} Tage (seit ${out.since.slice(0, 10)}) ──`);
  console.log(`Rollenspiele ausgewertet: ${sim.finished} · Urteile: ${JSON.stringify(sim.verdicts)}`);
  console.log(`  ohne Urteil: ${sim.unratedShare ?? "–"} · Läufe mit zurückgehaltenen Scores: ${sim.withheldRuns} (${sim.withheldRunShare ?? "–"}) · Scores zurückgehalten gesamt: ${sim.withheldScores}`);
  console.log(`  Ø Belegquote Rubrik: ${sim.avgCoverage ?? "–"} · Anteil bewerteter C-Werte: ${sim.cScoredShare ?? "–"}`);
  console.log(`Transkript-Analysen: ${out.analyses.count} · davon mit Gate-Fehlern: ${out.analyses.withGateErrors}`);
  console.log(`Briefing-Zeile: ${formatQualityStatsLine(out)}`);
  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify(out, null, 2), "utf8");
    console.log(`JSON: ${jsonOut}`);
  }
}

main().catch((e) => {
  console.error("quality-stats FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
