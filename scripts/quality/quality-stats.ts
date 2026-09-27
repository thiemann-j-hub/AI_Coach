/**
 * Kennzahlen der Auswertungsqualität (Blueprint COACH-OPTIMIERUNG 27.09.2026, O6).
 *
 *   npm run quality:stats            # letzte 30 Tage
 *   npm run quality:stats -- --days=90 --json=pfad.json
 *
 * Misst über ALLE Nutzer (Cross-Partition, nur Zähler, keine Inhalte):
 *   Rollenspiele: ausgewertet, Urteile (bestanden/nicht/ohne Urteil), Läufe mit
 *   zurückgehaltenen Rubrik-Scores (Gate), Ø Belegquote, Ø C-Werte je Lauf.
 *   Transkript-Analysen: Anzahl, Läufe mit Gate-Fehlern.
 * Die Kennzahl „Anteil ohne Urteil“ und „Anteil mit zurückgehaltenen Scores“ ist
 * das Frühwarnsignal, das den Gate-Fehler N4-84 seit August hätte zeigen müssen.
 * Datenquelle für das Tagesbriefing (Anbindung dort: Folgepunkt).
 */
import { config } from "dotenv";
import { writeFileSync } from "node:fs";
config({ path: ".env.local" });
import { runsContainer } from "../../src/lib/cosmos";

const args = process.argv.slice(2);
const days = Math.max(1, Number(args.find((a) => a.startsWith("--days="))?.split("=")[1] ?? "30"));
const jsonOut = args.find((a) => a.startsWith("--json="))?.split("=")[1];

async function main() {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const c = runsContainer();

  const { resources: sims } = await c.items
    .query<{ id: string; verdict?: string; coverage?: number; notes?: Array<{ code: string; field?: string }>; ratings?: Array<{ id: string; score: number | null }> }>({
      query:
        "SELECT c.id, c.debriefJson.verdict AS verdict, c.debriefJson.coverage AS coverage, c.qualityNotes AS notes, c.competencyRatings AS ratings " +
        "FROM c WHERE c.docType = 'simulation' AND c.status = 'finished' AND c.finishedAt >= @since",
      parameters: [{ name: "@since", value: since }],
    })
    .fetchAll();

  const verdicts: Record<string, number> = {};
  let withheldRuns = 0;
  let withheldScores = 0;
  let coverageSum = 0;
  let cScored = 0;
  let cTotal = 0;
  for (const s of sims) {
    verdicts[s.verdict ?? "∅"] = (verdicts[s.verdict ?? "∅"] ?? 0) + 1;
    const w = (s.notes ?? []).filter((n) => n.code === "EVIDENCE_ALL_UNGROUNDED");
    if (w.length) withheldRuns++;
    withheldScores += w.length;
    coverageSum += typeof s.coverage === "number" ? s.coverage : 0;
    for (const r of s.ratings ?? []) {
      cTotal++;
      if (typeof r.score === "number") cScored++;
    }
  }

  const { resources: runs } = await c.items
    .query<{ id: string; notes?: Array<{ severity: string }> }>({
      query: "SELECT c.id, c.analysisJson.quality_notes AS notes FROM c WHERE IS_DEFINED(c.analysisJson) AND c.createdAt >= @since",
      parameters: [{ name: "@since", value: since }],
    })
    .fetchAll();
  const runsWithErrors = runs.filter((r) => (r.notes ?? []).some((n) => n.severity === "error")).length;

  const out = {
    since,
    days,
    simulations: {
      finished: sims.length,
      verdicts,
      unratedShare: sims.length ? +((verdicts.unrated ?? 0) / sims.length).toFixed(2) : null,
      withheldRuns,
      withheldRunShare: sims.length ? +(withheldRuns / sims.length).toFixed(2) : null,
      withheldScores,
      avgCoverage: sims.length ? +(coverageSum / sims.length).toFixed(2) : null,
      cScoredShare: cTotal ? +(cScored / cTotal).toFixed(2) : null,
    },
    analyses: { count: runs.length, withGateErrors: runsWithErrors },
  };

  console.log(`── Auswertungsqualität, letzte ${days} Tage (seit ${since.slice(0, 10)}) ──`);
  console.log(`Rollenspiele ausgewertet: ${out.simulations.finished} · Urteile: ${JSON.stringify(verdicts)}`);
  console.log(`  ohne Urteil: ${out.simulations.unratedShare ?? "–"} · Läufe mit zurückgehaltenen Scores: ${withheldRuns} (${out.simulations.withheldRunShare ?? "–"}) · Scores zurückgehalten gesamt: ${withheldScores}`);
  console.log(`  Ø Belegquote Rubrik: ${out.simulations.avgCoverage ?? "–"} · Anteil bewerteter C-Werte: ${out.simulations.cScoredShare ?? "–"}`);
  console.log(`Transkript-Analysen: ${runs.length} · davon mit Gate-Fehlern: ${runsWithErrors}`);
  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify(out, null, 2), "utf8");
    console.log(`JSON: ${jsonOut}`);
  }
}

main().catch((e) => {
  console.error("quality-stats FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
