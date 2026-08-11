/**
 * Endscreen-Mechaniken der Wiederkehr (COACH-UX-BLUEPRINT §5, Welle 3) — pure.
 *
 * W3-1 Delta als Auslöser: aus Erkenntnis wird Handlung. Gab es gegenüber dem
 * Vorversuch einen Rückschritt bei einer Kompetenz, wird SIE benannt und das
 * passende Szenario (competencyFocus) angeboten. Ohne Vorlauf (erster Versuch)
 * übernimmt die schwächste beobachtete Kompetenz.
 *
 * W3-3 Studio-Brücke: echte Schwäche (score ≤ 2) → Deeplink ins Learning
 * Studio im Hub-Format (radar-ui-logic; Studio validiert hart). BEWUSST keine
 * Radar-Historien-Lesung (Sparring-Kürzung: 80 % Wirkung, 10 % Kosten).
 */

import { weakestObservedC, type RatingLike } from "./empfehlung";

const C_ORDER = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"];

export interface DeltaCta {
  cKey: string;
  cName: string | null;
  /** dropped = Rückschritt ggü. Vorversuch; weakest = größte aktuelle Lücke. */
  mode: "dropped" | "weakest";
  scenarioId: string | null;
  scenarioTitle: string | null;
}

export function computeDeltaCta(args: {
  ratings: RatingLike[] | null | undefined;
  /** C-Deltas ggü. Vorversuch (measurement-delta.deltas); null = kein Vorlauf. */
  deltaCompetencies?: Record<string, number | null> | null;
  scenarios: Array<{ id: string; title: string; competencyFocus?: readonly string[] }>;
  currentScenarioId?: string | null;
}): DeltaCta | null {
  const nameOf = (key: string): string | null => {
    const r = (args.ratings ?? []).find((x) => x && x.id === key);
    return r && typeof r.name === "string" ? r.name : null;
  };

  // 1) Rückschritt ggü. Vorversuch — stärkster Drop gewinnt, Gleichstand →
  //    niedrigere C-Nummer (deterministisch, wie weakestObservedC).
  let cKey: string | null = null;
  let mode: DeltaCta["mode"] = "weakest";
  const dc = args.deltaCompetencies;
  if (dc) {
    let worst: { key: string; delta: number } | null = null;
    for (const key of C_ORDER) {
      const d = dc[key];
      if (typeof d === "number" && d < 0 && (worst === null || d < worst.delta)) {
        worst = { key, delta: d };
      }
    }
    if (worst) {
      cKey = worst.key;
      mode = "dropped";
    }
  }
  // 2) Fallback: schwächste beobachtete Kompetenz DIESER Auswertung.
  if (!cKey) {
    const w = weakestObservedC(args.ratings);
    if (!w) return null;
    cKey = w.id;
  }

  // Passendes Szenario: erstes im Katalog mit Fokus-Treffer, bevorzugt ein
  // ANDERES als das gerade gespielte (Abwechslung schlägt Wiederholung).
  const hits = args.scenarios.filter((s) => (s.competencyFocus ?? []).includes(cKey));
  const other = hits.find((s) => s.id !== args.currentScenarioId);
  const target = other ?? hits[0] ?? null;

  return {
    cKey,
    cName: nameOf(cKey),
    mode,
    scenarioId: target?.id ?? null,
    scenarioTitle: target?.title ?? null,
  };
}

export interface StudioBridge {
  cKey: string;
  cName: string | null;
  score: number;
  /** Deeplink im Hub-Format — Studio-Parser validiert hart (radar-ui-logic). */
  href: string;
}

/** W3-3: nur bei ECHTER Schwäche (schwächste beobachtete Kompetenz ≤ 2). */
export function computeStudioBridge(
  ratings: RatingLike[] | null | undefined
): StudioBridge | null {
  const w = weakestObservedC(ratings);
  if (!w || w.score > 2) return null;
  return {
    cKey: w.id,
    cName: w.name,
    score: w.score,
    href: `https://app.pulsenorth.ai/studio/projects/new?intent=gap&c=${w.id}&t=3&i=${w.score}`,
  };
}
