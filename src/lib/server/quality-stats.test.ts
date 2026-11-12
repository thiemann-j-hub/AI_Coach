import { describe, expect, it } from "vitest";
import { formatQualityStatsLine, summarizeJudge, type QualityStats } from "./quality-stats";

/** Paket 2, C7 (12.11.2026): Rückfälle des Richters in der Qualitäts-Statistik. */
describe("summarizeJudge", () => {
  it("zählt nur Läufe mit Kennzahlen und nennt den Anteil der Rückfälle je Grund", () => {
    const s = summarizeJudge([
      {}, // Lauf vor dem 12.11.2026: keine Kennzahlen
      { evalStats: null },
      { evalStats: { fallback: null } },
      { evalStats: { fallback: null } },
      { evalStats: { fallback: "frist" } },
      { evalStats: { fallback: "konfiguration" } },
      { evalStats: { fallback: "frist" } },
    ]);
    expect(s).toEqual({ measured: 5, fallbacks: 3, fallbackShare: 0.6, reasons: { frist: 2, konfiguration: 1 } });
  });

  it("ohne Läufe mit Kennzahlen: Anteil unbekannt statt 0", () => {
    expect(summarizeJudge([{}, {}])).toEqual({ measured: 0, fallbacks: 0, fallbackShare: null, reasons: {} });
  });
});

describe("formatQualityStatsLine", () => {
  const stats = (judge: QualityStats["simulations"]["judge"]): QualityStats => ({
    since: "2026-10-13T00:00:00.000Z",
    days: 30,
    simulations: { finished: 25, verdicts: { passed: 20 }, unratedShare: 0, withheldRuns: 0, withheldRunShare: 0, withheldScores: 0, avgCoverage: 0.9, cScoredShare: 0.8, judge },
    analyses: { count: 3, withGateErrors: 0 },
  });

  it("nennt den Rückfall-Anteil, sobald Läufe Kennzahlen tragen", () => {
    const line = formatQualityStatsLine(stats({ measured: 25, fallbacks: 2, fallbackShare: 0.08, reasons: { frist: 2 } }));
    expect(line).toContain("Rückfall auf den schnellen Richter 8 % (2 von 25)");
  });

  it("schweigt dazu, solange kein Lauf Kennzahlen trägt", () => {
    expect(formatQualityStatsLine(stats({ measured: 0, fallbacks: 0, fallbackShare: null, reasons: {} }))).not.toContain("Rückfall");
  });
});
