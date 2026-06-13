import "server-only";

/**
 * Deterministische Output-Validatoren (kein LLM, keine Kosten).
 *
 * Muster aus der Schwester-App (§10): reine Funktionen, ENV-gegated
 * (off | warn | enforce, Default warn), die NIE werfen — sie liefern
 * QualityNote[] und überlassen die Reaktion dem Caller. „warn-first"
 * schützt gegen Fehlalarme, macht Drift aber sichtbar.
 */

export type QualitySeverity = "info" | "warn" | "error";

export interface QualityNote {
  code: string;
  severity: QualitySeverity;
  message: string;
  field?: string;
}

export type QualityMode = "off" | "warn" | "enforce";

export function qualityMode(): QualityMode {
  const m = (process.env.QUALITY_CHECKS_MODE ?? "warn").toLowerCase();
  return m === "off" ? "off" : m === "enforce" ? "enforce" : "warn";
}

/* ------------------------------------------------------------------ */
/*  Einzel-Checks (rein)                                               */
/* ------------------------------------------------------------------ */

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Evidenz-Zitate müssen (normalisiert) im gesendeten Transkript vorkommen. */
export function checkEvidenceGrounding(
  competencies: Array<{ id: string; score: number | null; evidence?: string[] }>,
  transcript: string
): QualityNote[] {
  const notes: QualityNote[] = [];
  const hay = norm(transcript);
  if (!hay) return notes;
  for (const c of competencies) {
    for (const q of c.evidence ?? []) {
      const needle = norm(String(q))
        // Sprecher-Prefix + Anonymisierungs-Token aus dem Zitat entfernen
        .replace(/^(führungskraft|mitarbeiter:in|mitarbeiter|fk|ma)\s*:\s*/i, "")
        .replace(/[„“”"»«›‹]/g, "")
        .trim();
      if (needle.length < 8) continue; // zu kurz, um aussagekräftig zu prüfen
      if (!hay.includes(needle)) {
        notes.push({
          code: "EVIDENCE_NOT_GROUNDED",
          severity: "warn",
          field: c.id,
          message: `Evidenz-Zitat für ${c.id} nicht wörtlich im Transkript gefunden: "${String(q).slice(0, 60)}…"`,
        });
      }
    }
  }
  return notes;
}

/** Score gesetzt, aber keine Evidenz → unbelegte Bewertung. */
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

/** Rewrites, deren "better" identisch zum "original" ist → kein Mehrwert. */
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

/** Floskeln/Füllphrasen im Summary → Qualitäts-Signal (info). */
export function checkBannedPhrases(summary: string): QualityNote[] {
  const hay = norm(summary);
  return FLOSKELN.filter((p) => hay.includes(p)).map((p) => ({
    code: "BANNED_PHRASE",
    severity: "info" as const,
    message: `Floskel im Summary: "${p}"`,
  }));
}

/* ------------------------------------------------------------------ */
/*  Aggregat                                                           */
/* ------------------------------------------------------------------ */

export interface AnalysisForChecks {
  summary?: string | null;
  rewrites?: Array<{ original?: string; better?: string }>;
  competency_ratings?: Array<{ id: string; score: number | null; evidence?: string[] }>;
}

/**
 * Führt alle deterministischen Checks aus. Gibt { notes, blocked } zurück.
 * blocked = true nur in mode=enforce, wenn ein error-Note auftritt
 * (aktuell erzeugt kein Check error → enforce ≈ warn, bis bewusst verschärft).
 */
export function runQualityChecks(
  result: AnalysisForChecks,
  transcript: string
): { notes: QualityNote[]; blocked: boolean } {
  const mode = qualityMode();
  if (mode === "off") return { notes: [], blocked: false };

  const comps = result.competency_ratings ?? [];
  const notes: QualityNote[] = [
    ...checkEvidenceGrounding(comps, transcript),
    ...checkScoreHasEvidence(comps),
    ...checkRewritesDiffer(result.rewrites ?? []),
    ...checkBannedPhrases(String(result.summary ?? "")),
  ];

  const blocked = mode === "enforce" && notes.some((n) => n.severity === "error");
  return { notes, blocked };
}
