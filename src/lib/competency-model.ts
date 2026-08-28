/**
 * Kompetenzmodell C1–C10 + Normalisierung der LLM-Ratings (SIM-2-Refactor).
 *
 * Vorher lebten COMP_MODEL + Normalisierung privat in /api/analyze — mit der
 * Simulation gäbe es eine dritte Label-Kopie im Repo. Dieses Modul ist jetzt die
 * eine Runtime-Quelle; /api/analyze und /api/simulation/finish teilen sie.
 * (Die bekannte Label-Divergenz zu competencies.ts/Hub bleibt ein eigenes,
 * dokumentiertes Thema — hier wurde NICHTS umbenannt, nur verschoben.)
 */

export const COMP_MODEL = [
  { id: "C1", name: "Beziehungsmanagement und Vernetzung" },
  { id: "C2", name: "Problemlösung und Entscheidungsfindung" },
  { id: "C3", name: "Befähigen und Entwickeln" },
  { id: "C4", name: "Sicherheit und Stabilität geben" },
  { id: "C5", name: "Kommunikation und Teamfähigkeit" },
  { id: "C6", name: "Zielorientierte Umsetzung und Verlässlichkeit" },
  { id: "C7", name: "Innovative Kultur fördern" },
  { id: "C8", name: "Selbstreflexion und Resilienz" },
  { id: "C9", name: "Zukunftsorientierung und strategischer Weitblick" },
  { id: "C10", name: "KI- und Datenkompetenz" },
];

/**
 * Kompetenzmodell v2 (Owner-GO 28.08.) — 6 Core + 4 Leadership.
 * Für das Scoring heißt das: ein Vertriebs- oder Konflikt-Szenario misst in
 * aller Regel nur Core-Kompetenzen; Leadership-Achsen bleiben dort null
 * („nicht beobachtbar"), statt aus einem Verkaufsgespräch Führungsverhalten
 * zu konstruieren. SSOT: pulsenorth-ops/competency-model.json (v3).
 */
export const CORE_COMPETENCY_IDS = ["C1", "C2", "C5", "C6", "C8", "C10"] as const;
export const LEADERSHIP_COMPETENCY_IDS = ["C3", "C4", "C7", "C9"] as const;

/** Ein-Satz-Definitionen — gehen in den Scoring-Prompt (vorher standen dort
 *  nur die nackten Titel, ohne jede Erläuterung). */
export const COMPETENCY_DEFINITIONS: Record<string, string> = {
  C1: "Baut tragfähige Beziehungen auf — im Team, über Abteilungsgrenzen hinweg und zu Kundinnen und Kunden — und bringt die richtigen Menschen zusammen.",
  C2: "Durchdringt Situationen, wägt Optionen ab und trifft nachvollziehbare Entscheidungen, auch wenn nicht alle Informationen vorliegen.",
  C3: "Erkennt Potenzial, delegiert wirksam und unterstützt andere gezielt dabei, zu wachsen.",
  C4: "Schafft Orientierung und Verlässlichkeit, gerade in Unsicherheit und Veränderung.",
  C5: "Sagt verständlich, was gemeint ist, hört aktiv zu und arbeitet auch unter Spannung fair mit anderen zusammen.",
  C6: "Bringt Vorhaben zu Ende, hält Zusagen und Termine und macht Fortschritt für andere sichtbar.",
  C7: "Ermutigt zu neuen Wegen, macht Ausprobieren möglich und geht konstruktiv mit Fehlern um.",
  C8: "Nimmt Feedback an, lernt aus Fehlern und bleibt auch unter Druck handlungsfähig.",
  C9: "Denkt über das Tagesgeschäft hinaus, erkennt Entwicklungen früh und leitet daraus Prioritäten ab.",
  C10: "Nutzt digitale Werkzeuge, Daten und KI sinnvoll, prüft Ergebnisse kritisch und kennt deren Grenzen.",
};

export interface NormalizedCompetencyRating {
  id: string;
  name: string;
  score: number | null;
  confidence: number | null;
  why: string;
  evidence: string[];
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v : String(v ?? "");
}

function normalizeScore(v: unknown): number | null {
  const n = typeof v === "number" ? v : null;
  if (n == null) return null;
  if (n < 1 || n > 4) return null;
  return n;
}

function normalizeEvidence(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => asStr(x))
    .filter((s) => s.trim())
    .slice(0, 2);
}

export function defaultCompetencyRatings(): NormalizedCompetencyRating[] {
  return COMP_MODEL.map((c) => ({
    id: c.id,
    name: c.name,
    score: null,
    confidence: null,
    why: "nicht ausreichend beobachtbar",
    evidence: [],
  }));
}

/**
 * Normalisiert die rohe scoreCompetencies-Ausgabe auf das vollständige
 * C1–C10-Set (identisches Verhalten wie zuvor inline in /api/analyze):
 * fehlende ids -> Default, Score außerhalb 1–4 -> null, Evidenz auf 2 Zitate
 * gekappt und mit den Rollen-Labels anonymisiert.
 */
export function normalizeCompetencyRatings(
  comp: unknown,
  opts: { lang?: string | null; leaderLabel?: string; employeeLabel?: string } = {}
): NormalizedCompetencyRating[] {
  const list = Array.isArray((comp as { competencies?: unknown[] })?.competencies)
    ? ((comp as { competencies: unknown[] }).competencies as Array<Record<string, unknown>>)
    : [];
  const map = new Map<string, Record<string, unknown>>(
    list.map((x) => [asStr(x?.id).trim(), x])
  );
  const defaults = defaultCompetencyRatings();

  return COMP_MODEL.map((c) => {
    const r = map.get(c.id);
    if (!r) return { ...defaults.find((x) => x.id === c.id)! };

    let why = asStr(r?.why ?? "").trim();
    const score = normalizeScore(r?.score);
    const notObservable =
      opts.lang === "en" ? "not sufficiently observable" : "nicht ausreichend beobachtbar";
    if (!score) {
      why = notObservable;
    } else if (!why) {
      why = "—";
    }

    let evidence = normalizeEvidence(r?.evidence);
    evidence = evidence.map((q) => {
      let s = asStr(q);
      if (opts.leaderLabel) s = s.split(opts.leaderLabel).join("Führungskraft");
      if (opts.employeeLabel) s = s.split(opts.employeeLabel).join("Mitarbeiter:in");
      return s;
    });

    const confidenceRaw = typeof r?.confidence === "number" ? (r.confidence as number) : null;

    return { id: c.id, name: c.name, score, confidence: confidenceRaw, why, evidence };
  });
}
