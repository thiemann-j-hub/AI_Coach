import "server-only";

/**
 * Laufzeit-Wrapper um die reinen Checks aus quality-core.ts.
 * ENV-gegated (off | warn | enforce, Default warn); die Checks selbst liegen
 * in @/lib/quality-core und werden vom Regression-Harness wiederverwendet.
 */

import {
  collectQualityNotes,
  type AnalysisForChecks,
  type QualityNote,
} from "@/lib/quality-core";

export type { QualityNote, QualitySeverity, AnalysisForChecks } from "@/lib/quality-core";

export type QualityMode = "off" | "warn" | "enforce";

export function qualityMode(): QualityMode {
  const m = (process.env.QUALITY_CHECKS_MODE ?? "warn").toLowerCase();
  return m === "off" ? "off" : m === "enforce" ? "enforce" : "warn";
}

/**
 * Führt alle deterministischen Checks aus. Gibt { notes, blocked } zurück.
 * blocked = true nur in mode=enforce bei einem error-Note. error emittiert
 * aktuell EVIDENCE_ALL_UNGROUNDED (gesamte Belegkette einer gescorten
 * Kompetenz fabriziert) — die Route degradiert dann gezielt diese Kompetenz.
 */
export function runQualityChecks(
  result: AnalysisForChecks,
  transcript: string
): { notes: QualityNote[]; blocked: boolean } {
  const mode = qualityMode();
  if (mode === "off") return { notes: [], blocked: false };
  const notes = collectQualityNotes(result, transcript);
  const blocked = mode === "enforce" && notes.some((n) => n.severity === "error");
  return { notes, blocked };
}
