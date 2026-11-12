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
    /** Paket 2, C7 (12.11.2026): Rückfälle vom starken Richter auf das schnelle Modell. */
    judge: JudgeStats;
    /** Paket 4, S22 (12.11.2026): Messwerte des Sprachwegs (Antwortzeit, Unterbrechungen). */
    speech: SpeechStats;
  };
  analyses: { count: number; withGateErrors: number };
}

export interface JudgeStats {
  /** Läufe mit Kennzahlen der Auswertung (`evalStats`; Läufe vor dem 12.11.2026 haben keine). */
  measured: number;
  fallbacks: number;
  /** Anteil Rückfälle an den Läufen mit Kennzahlen. */
  fallbackShare: number | null;
  /** Rückfälle je Grund (konfiguration, frist, schema, fehler). */
  reasons: Record<string, number>;
}

/** Rein (getestet): zählt Rückfälle des Richters über die Läufe mit Kennzahlen. */
export function summarizeJudge(
  rows: ReadonlyArray<{ evalStats?: { fallback?: string | null } | null }>
): JudgeStats {
  let measured = 0;
  let fallbacks = 0;
  const reasons: Record<string, number> = {};
  for (const r of rows) {
    if (!r.evalStats) continue;
    measured++;
    const grund = r.evalStats.fallback;
    if (!grund) continue;
    fallbacks++;
    reasons[grund] = (reasons[grund] ?? 0) + 1;
  }
  return { measured, fallbacks, fallbackShare: measured ? +(fallbacks / measured).toFixed(2) : null, reasons };
}

/**
 * Paket 4, S22 (12.11.2026): Messwerte des Sprachwegs. Das Relais legt sie je Lauf in `liveStats` ab; gelesen hat
 * sie bisher niemand. Messlatte aus dem Vergleich: Antwort der Rolle nach 1,3 s, Ton aus 0,8 s nach einem Einwurf.
 */
export interface SpeechStats {
  /** Ausgewertete Läufe, in denen gesprochen wurde (`liveStats` am Lauf). */
  runs: number;
  /** Gemessene Antworten der Rolle über diese Läufe. */
  answers: number;
  /** Antwortzeit (Ende der Eingabe-Mitschrift → erster Ton) in Millisekunden: Median und 95 %. */
  p50Ms: number | null;
  p95Ms: number | null;
  /** So oft fiel die Person der Rolle ins Wort; `cutChars` = dabei gekürzte Zeichen der Rolle (S31). */
  interruptions: number;
  cutChars: number;
}

type LiveStatsRow = {
  antworten?: number;
  p50Ms?: number;
  zeiten?: number[];
  unterbrechungen?: number;
  gekuerztZeichen?: number;
};

/**
 * Rein (getestet): fasst die Antwortzeiten aller Läufe mit Sprachweg zusammen. Gerechnet wird über die einzelnen
 * Antwortzeiten; Läufe von vor dem 12.11.2026 tragen nur ihren Median, er zählt dann als ein Messwert.
 */
export function summarizeSpeech(rows: ReadonlyArray<{ liveStats?: LiveStatsRow | null }>): SpeechStats {
  let runs = 0;
  let answers = 0;
  let interruptions = 0;
  let cutChars = 0;
  const zeiten: number[] = [];
  for (const r of rows) {
    const s = r.liveStats;
    if (!s) continue;
    runs++;
    answers += s.antworten ?? 0;
    interruptions += s.unterbrechungen ?? 0;
    cutChars += s.gekuerztZeichen ?? 0;
    if (s.zeiten?.length) zeiten.push(...s.zeiten);
    else if (s.antworten && typeof s.p50Ms === "number") zeiten.push(s.p50Ms);
  }
  zeiten.sort((a, b) => a - b);
  const q = (p: number) => (zeiten.length ? Math.round(zeiten[Math.min(zeiten.length - 1, Math.max(0, Math.ceil(p * zeiten.length) - 1))]) : null);
  return { runs, answers, p50Ms: q(0.5), p95Ms: q(0.95), interruptions, cutChars };
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
      evalStats?: { fallback?: string | null } | null;
      liveStats?: LiveStatsRow | null;
    }>({
      query:
        "SELECT c.id, c.debriefJson.verdict AS verdict, c.debriefJson.coverage AS coverage, c.qualityNotes AS notes, c.competencyRatings AS ratings, c.evalStats AS evalStats, c.liveStats AS liveStats " +
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
      judge: summarizeJudge(sims),
      speech: summarizeSpeech(sims),
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
  // Paket 2, C7: Rückfall-Anteil nur nennen, wenn es Läufe mit Kennzahlen gibt (sonst stünde dort dauerhaft „–“).
  const j = sim.judge;
  const rueckfall = j?.measured ? `, Rückfall auf den schnellen Richter ${pct(j.fallbackShare)} (${j.fallbacks} von ${j.measured})` : "";
  // Paket 4, S22: Sprachweg nur nennen, wenn in einem der Läufe gesprochen wurde.
  const sp = sim.speech;
  const sek = (ms: number | null) => (ms == null ? "–" : `${(ms / 1000).toFixed(1).replace(".", ",")} s`);
  const sprachweg = sp?.runs
    ? `, gesprochen in ${sp.runs} Läufen: Antwort der Rolle nach ${sek(sp.p50Ms)} (Median, 95 % bis ${sek(sp.p95Ms)}), ` +
      `${sp.interruptions} Unterbrechungen (${sp.cutChars} Zeichen gekürzt)`
    : "";
  return (
    `Coach (${s.days} Tage): ${sim.finished} Rollenspiele ausgewertet — ohne Urteil ${pct(sim.unratedShare)}, ` +
    `mit zurückgehaltenen Scores ${pct(sim.withheldRunShare)} (${sim.withheldScores} Scores), Belegquote Ø ${pct(sim.avgCoverage)}${rueckfall}${sprachweg}; ` +
    `${s.analyses.count} Transkript-Analysen, davon ${s.analyses.withGateErrors} mit Gate-Fehlern.`
  );
}
