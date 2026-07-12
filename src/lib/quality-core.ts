/**
 * Reine, deterministische Qualitäts-Checks (KEIN server-only, KEIN I/O) —
 * gemeinsame Basis für die Laufzeit-Validatoren (src/lib/server/quality-checks.ts)
 * UND den Offline-Regression-Harness (scripts/quality/*). So misst der Harness
 * exakt dieselben Checks, die in Produktion laufen ("eigene Bausteine messen").
 */

export type QualitySeverity = "info" | "warn" | "error";

export interface QualityNote {
  code: string;
  severity: QualitySeverity;
  message: string;
  field?: string;
}

export interface AnalysisForChecks {
  summary?: string | null;
  rewrites?: Array<{ original?: string; better?: string }>;
  competency_ratings?: Array<{ id: string; score: number | null; evidence?: string[] }>;
}

export function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Evidenz-Zitat auf den belegbaren Kern reduzieren (Sprecher-Prefix/Quotes entfernen).
 *  Strippt einen beliebigen führenden Sprecher-Prefix ("Lead:", "Führungskraft:", "FK:" …),
 *  damit der Grounding-Check den Zitat-Körper wörtlich im Transkript findet. */
export function evidenceNeedle(q: string): string {
  return norm(String(q))
    .replace(/^[\p{L}][\p{L}\d _.\-]{0,24}:\s*/u, "")
    .replace(/[„“”"»«›‹]/g, "")
    .trim();
}

/**
 * Evidenz-Zitate müssen (normalisiert) im gesendeten Transkript vorkommen.
 *
 * Eskalation (§2.2 enforce): Ist die GESAMTE Evidenz einer gescorten Kompetenz
 * nicht im Transkript auffindbar (jedes prüfbare Zitat fabriziert), ist der
 * Score nicht vertrauenswürdig → severity "error" (EVIDENCE_ALL_UNGROUNDED).
 * Einzelne ungroundete Zitate neben groundeten bleiben "warn" — das kann
 * legitime Paraphrase sein; komplett fabrizierte Belegketten nicht.
 */
export function checkEvidenceGrounding(
  competencies: Array<{ id: string; score: number | null; evidence?: string[] }>,
  transcript: string
): QualityNote[] {
  const notes: QualityNote[] = [];
  const hay = norm(transcript);
  if (!hay) return notes;
  for (const c of competencies) {
    let checkable = 0;
    let ungrounded = 0;
    for (const q of c.evidence ?? []) {
      const needle = evidenceNeedle(q);
      if (needle.length < 8) continue;
      checkable++;
      if (!hay.includes(needle)) {
        ungrounded++;
        notes.push({
          code: "EVIDENCE_NOT_GROUNDED",
          severity: "warn",
          field: c.id,
          message: `Evidenz-Zitat für ${c.id} nicht wörtlich im Transkript: "${String(q).slice(0, 60)}…"`,
        });
      }
    }
    if (checkable > 0 && ungrounded === checkable && typeof c.score === "number") {
      notes.push({
        code: "EVIDENCE_ALL_UNGROUNDED",
        severity: "error",
        field: c.id,
        message: `${c.id}: Score ${c.score}, aber KEIN Evidenz-Zitat im Transkript verifizierbar (${ungrounded}/${checkable} fabriziert).`,
      });
    }
  }
  return notes;
}

export function checkScoreHasEvidence(
  competencies: Array<{ id: string; score: number | null; evidence?: string[] }>
): QualityNote[] {
  const notes: QualityNote[] = [];
  for (const c of competencies) {
    if (typeof c.score === "number" && (!c.evidence || c.evidence.length === 0)) {
      notes.push({
        code: "SCORE_WITHOUT_EVIDENCE",
        severity: "warn",
        field: c.id,
        message: `${c.id} hat Score ${c.score}, aber keine Evidenz.`,
      });
    }
  }
  return notes;
}

export function checkRewritesDiffer(
  rewrites: Array<{ original?: string; better?: string }>
): QualityNote[] {
  const notes: QualityNote[] = [];
  rewrites.forEach((r, i) => {
    const o = norm(String(r?.original ?? ""));
    const b = norm(String(r?.better ?? ""));
    if (o && b && o === b) {
      notes.push({
        code: "REWRITE_NOT_DIFFERENT",
        severity: "warn",
        field: `rewrites[${i}]`,
        message: "Rewrite ist identisch zum Original.",
      });
    }
  });
  return notes;
}

const FLOSKELN = [
  "wie bereits erwähnt",
  "es ist wichtig zu beachten",
  "zusammenfassend lässt sich sagen",
  "in der heutigen schnelllebigen welt",
  "as an ai language model",
];

export function checkBannedPhrases(summary: string): QualityNote[] {
  const hay = norm(summary);
  return FLOSKELN.filter((p) => hay.includes(p)).map((p) => ({
    code: "BANNED_PHRASE",
    severity: "info" as const,
    message: `Floskel im Summary: "${p}"`,
  }));
}

/** Alle deterministischen Checks; reine Funktion, kein ENV/IO. */
export function collectQualityNotes(
  result: AnalysisForChecks,
  transcript: string
): QualityNote[] {
  const comps = result.competency_ratings ?? [];
  return [
    ...checkEvidenceGrounding(comps, transcript),
    ...checkScoreHasEvidence(comps),
    ...checkRewritesDiffer(result.rewrites ?? []),
    ...checkBannedPhrases(String(result.summary ?? "")),
  ];
}
