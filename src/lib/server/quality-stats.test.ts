import { describe, expect, it } from "vitest";
import { formatQualityStatsLine, summarizeJudge, summarizeSpeech, type QualityStats } from "./quality-stats";

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

/** Paket 4, S22 (12.11.2026): Messwerte des Sprachwegs in der Qualitäts-Statistik. */
describe("summarizeSpeech", () => {
  it("rechnet Median und 95 % über die einzelnen Antwortzeiten aller Läufe mit Sprachweg", () => {
    const s = summarizeSpeech([
      {}, // Textlauf: kein Sprachweg
      { liveStats: null },
      { liveStats: { antworten: 3, p50Ms: 1000, zeiten: [800, 1000, 1400], unterbrechungen: 2, gekuerztZeichen: 120 } },
      { liveStats: { antworten: 2, p50Ms: 900, zeiten: [900, 2600], unterbrechungen: 1, gekuerztZeichen: 40 } },
    ]);
    expect(s).toEqual({ runs: 2, answers: 5, p50Ms: 1000, p95Ms: 2600, interruptions: 3, cutChars: 160 });
  });

  it("Läufe von vor dem 12.11.2026 tragen nur ihren Median: er zählt als ein Messwert", () => {
    const s = summarizeSpeech([{ liveStats: { antworten: 4, p50Ms: 1300 } }, { liveStats: { antworten: 1, p50Ms: 700, zeiten: [700] } }]);
    expect(s).toEqual({ runs: 2, answers: 5, p50Ms: 700, p95Ms: 1300, interruptions: 0, cutChars: 0 });
  });

  it("ohne Sprachweg: keine Zeiten statt 0", () => {
    expect(summarizeSpeech([{}, {}])).toEqual({ runs: 0, answers: 0, p50Ms: null, p95Ms: null, interruptions: 0, cutChars: 0 });
    // Eine Sitzung ohne gemessene Antwort (nur eine Unterbrechung) zählt als Lauf, liefert aber keine Zeit.
    expect(summarizeSpeech([{ liveStats: { antworten: 0, p50Ms: 0, zeiten: [], unterbrechungen: 1 } }])).toMatchObject({ runs: 1, p50Ms: null, interruptions: 1 });
  });
});

describe("formatQualityStatsLine", () => {
  const KEIN_SPRACHWEG = { runs: 0, answers: 0, p50Ms: null, p95Ms: null, interruptions: 0, cutChars: 0 };
  const stats = (
    judge: QualityStats["simulations"]["judge"],
    speech: QualityStats["simulations"]["speech"] = KEIN_SPRACHWEG
  ): QualityStats => ({
    since: "2026-10-13T00:00:00.000Z",
    days: 30,
    simulations: { finished: 25, verdicts: { passed: 20 }, unratedShare: 0, withheldRuns: 0, withheldRunShare: 0, withheldScores: 0, avgCoverage: 0.9, cScoredShare: 0.8, judge, speech },
    analyses: { count: 3, withGateErrors: 0 },
  });

  it("nennt die Messwerte des Sprachwegs, sobald in einem Lauf gesprochen wurde", () => {
    const line = formatQualityStatsLine(
      stats({ measured: 0, fallbacks: 0, fallbackShare: null, reasons: {} }, { runs: 4, answers: 31, p50Ms: 1240, p95Ms: 3080, interruptions: 6, cutChars: 410 })
    );
    expect(line).toContain("gesprochen in 4 Läufen: Antwort der Rolle nach 1,2 s (Median, 95 % bis 3,1 s), 6 Unterbrechungen (410 Zeichen gekürzt)");
    expect(formatQualityStatsLine(stats({ measured: 0, fallbacks: 0, fallbackShare: null, reasons: {} }))).not.toContain("gesprochen");
  });

  it("nennt den Rückfall-Anteil, sobald Läufe Kennzahlen tragen", () => {
    const line = formatQualityStatsLine(stats({ measured: 25, fallbacks: 2, fallbackShare: 0.08, reasons: { frist: 2 } }));
    expect(line).toContain("Rückfall auf den schnellen Richter 8 % (2 von 25)");
  });

  it("schweigt dazu, solange kein Lauf Kennzahlen trägt", () => {
    expect(formatQualityStatsLine(stats({ measured: 0, fallbacks: 0, fallbackShare: null, reasons: {} }))).not.toContain("Rückfall");
  });
});
