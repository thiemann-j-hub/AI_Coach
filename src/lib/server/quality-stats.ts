import "server-only";

/**
 * Kennzahlen der Auswertungsqualität (Blueprint COACH-OPTIMIERUNG 27.09.2026, O6;
 * N4-88 Owner-GO 27.09.: ins Tagesbriefing). Eine Quelle für Skript
 * (scripts/quality/quality-stats.ts) und Service-Route (/api/quality/stats).
 *
 * Nur Zähler, keine Inhalte, über alle Nutzer (Cross-Partition). Das Frühwarn-
 * signal ist „Anteil Läufe ohne Urteil“ und „Anteil Läufe mit zurückgehaltenen
 * Scores“ — genau die Zahl, die den Gate-Fehler N4-84 seit August gezeigt hätte.
 */
import { runsContainer } from "@/lib/cosmos";

export interface QualityStats {
  since: string;
  days: number;
  simulations: {
    finished: number;
    verdicts: Record<string, number>;
    unratedShare: number | null;
    withheldRuns: number;
    withheldRunShare: number | null;
    withheldScores: number;
    avgCoverage: number | null;
    cScoredShare: number | null;
  };
  analyses: { count: number; withGateErrors: number };
}

export async function computeQualityStats(days: number): Promise<QualityStats> {
  const d = Math.max(1, Math.min(365, Math.floor(days)));
  const since = new Date(Date.now() - d * 86_400_000).toISOString();
  const c = runsContainer();

  const { resources: sims } = await c.items
    .query<{
      id: string;
      verdict?: string;
      coverage?: number;
      notes?: Array<{ code: string; field?: string }>;
      ratings?: Array<{ id: string; score: number | null }>;
    }>({
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
    const v = s.verdict ?? "unknown";
    verdicts[v] = (verdicts[v] ?? 0) + 1;
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
      query:
        "SELECT c.id, c.analysisJson.quality_notes AS notes FROM c WHERE IS_DEFINED(c.analysisJson) AND c.createdAt >= @since",
      parameters: [{ name: "@since", value: since }],
    })
    .fetchAll();
  const withGateErrors = runs.filter((r) => (r.notes ?? []).some((n) => n.severity === "error")).length;

  const share = (num: number, den: number) => (den ? +(num / den).toFixed(2) : null);
  return {
    since,
    days: d,
    simulations: {
      finished: sims.length,
      verdicts,
      unratedShare: share(verdicts.unrated ?? 0, sims.length),
      withheldRuns,
      withheldRunShare: share(withheldRuns, sims.length),
      withheldScores,
      avgCoverage: share(coverageSum, sims.length),
      cScoredShare: share(cScored, cTotal),
    },
    analyses: { count: runs.length, withGateErrors },
  };
}

/** Ein-Zeilen-Fassung fürs Tagesbriefing (deutsch, keine Fachbegriffe). */
export function formatQualityStatsLine(s: QualityStats): string {
  const sim = s.simulations;
  if (sim.finished === 0 && s.analyses.count === 0) {
    return `Coach: in den letzten ${s.days} Tagen keine Auswertungen.`;
  }
  const pct = (v: number | null) => (v == null ? "–" : `${Math.round(v * 100)} %`);
  return (
    `Coach (${s.days} Tage): ${sim.finished} Rollenspiele ausgewertet — ohne Urteil ${pct(sim.unratedShare)}, ` +
    `mit zurückgehaltenen Scores ${pct(sim.withheldRunShare)} (${sim.withheldScores} Scores), Belegquote Ø ${pct(sim.avgCoverage)}; ` +
    `${s.analyses.count} Transkript-Analysen, davon ${s.analyses.withGateErrors} mit Gate-Fehlern.`
  );
}
