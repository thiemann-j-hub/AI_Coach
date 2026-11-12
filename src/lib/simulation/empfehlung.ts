/**
 * Einstiegs-Empfehlung (COACH-UX-BLUEPRINT §3/W1-4) — pure, getestet.
 *
 * Quelle ist bewusst NUR die eigene jüngste Rollenspiel-Auswertung: der Coach bleibt Radar-SCHREIBER,
 * kein Radar-Leser (Sparring-Entscheid 09.08.). Cold Start = keine Auswertung vorhanden → die leichtesten
 * Szenarien (Lerntreppe existiert als difficulty 1–3).
 *
 * U15 (Owner-Entscheid 12.11.2026): Grundlage ist die schwächste beobachtete FÄHIGKEIT (Schlüssel aus
 * `feedback.rubric`), nicht mehr das Modell C1 bis C10. Vorher nannte der Einstieg eine „größte Lücke“ aus
 * C1 bis C10, die dem „Größten Hebel“ der Auswertung widersprach. `weakestObservedC` bleibt für die
 * Auswertungsseite (endscreen.ts).
 */

import type { CompetencyKey } from "./types";

export interface RatingLike {
  id: string;
  name?: string;
  score: number | null;
}

export interface ScenarioLike {
  id: string;
  difficulty: 1 | 2 | 3;
  /** Fähigkeiten, die das Szenario bewertet (`assessment.competencies` bzw. deren Projektion im Katalog). */
  competencies?: ReadonlyArray<{ key: string }>;
}

/** Eine Zeile aus `feedback.rubric` der Auswertung (nur die Felder, die die Empfehlung braucht). */
export interface SkillRatingLike {
  key: string;
  label?: string;
  score: number | null;
}

const C_ORDER: CompetencyKey[] = [
  "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10",
];

/**
 * Schwächste BEOBACHTETE Kompetenz einer Auswertung.
 * null-Scores sind »nicht beobachtbar« und zählen nie (null-statt-0-Regel);
 * bei Gleichstand gewinnt die niedrigere C-Nummer (deterministisch).
 */
export function weakestObservedC(
  ratings: RatingLike[] | null | undefined
): { id: CompetencyKey; name: string | null; score: number } | null {
  if (!Array.isArray(ratings)) return null;
  let best: { id: CompetencyKey; name: string | null; score: number } | null = null;
  for (const key of C_ORDER) {
    const r = ratings.find((x) => x && x.id === key);
    if (!r || typeof r.score !== "number" || !Number.isFinite(r.score)) continue;
    if (best === null || r.score < best.score) {
      best = { id: key, name: typeof r.name === "string" ? r.name : null, score: r.score };
    }
  }
  return best;
}

/**
 * U15: Schwächste BEOBACHTETE Fähigkeit einer Rollenspiel-Auswertung (`feedback.rubric`).
 * null-Scores sind »nicht beobachtbar« und zählen nie. Bei Gleichstand gewinnt die Fähigkeit, zu der der
 * „Größte Hebel“ der Auswertung gehört (`feedback.nextStepKey`), sonst die frühere in der Rubrik (deterministisch).
 */
export function weakestObservedSkill(
  rubric: SkillRatingLike[] | null | undefined,
  nextStepKey?: string | null
): { key: string; label: string | null; score: number } | null {
  if (!Array.isArray(rubric)) return null;
  let best: { key: string; label: string | null; score: number } | null = null;
  for (const r of rubric) {
    if (!r || typeof r.key !== "string" || !r.key) continue;
    if (typeof r.score !== "number" || !Number.isFinite(r.score)) continue;
    const hebel = !!nextStepKey && r.key === nextStepKey;
    if (best === null || r.score < best.score || (r.score === best.score && hebel && best.key !== nextStepKey)) {
      best = { key: r.key, label: typeof r.label === "string" && r.label ? r.label : null, score: r.score };
    }
  }
  return best;
}

/**
 * Top-N-Empfehlung: Szenarien, die die schwächste Fähigkeit bewerten, zuerst (stabil — innerhalb einer
 * Gruppe bleibt die Katalog-Reihenfolge erhalten). Das gerade gespielte Szenario steht hinter den anderen
 * Treffern, nicht zuerst. Ohne Fähigkeit: die leichtesten Szenarien (Cold Start).
 */
export function recommendScenarios<T extends ScenarioLike>(
  scenarios: T[],
  skillKey: string | null,
  count = 3,
  lastPlayedId: string | null = null
): T[] {
  if (!skillKey) {
    // Cold Start: leichteste Szenarien zuerst. Stufe 1 hat aktuell nur zwei
    // Einträge — es wird stabil mit der nächsten Stufe aufgefüllt, damit der
    // Streifen immer `count` Karten zeigt (stabile Sortierung: Katalog-Reihenfolge).
    return [...scenarios]
      .sort((a, b) => a.difficulty - b.difficulty)
      .slice(0, count);
  }
  const trains = (s: T) => (s.competencies ?? []).some((c) => c.key === skillKey);
  const hit = scenarios.filter((s) => trains(s) && s.id !== lastPlayedId);
  const justPlayed = scenarios.filter((s) => trains(s) && s.id === lastPlayedId);
  const rest = scenarios.filter((s) => !trains(s));
  return [...hit, ...justPlayed, ...rest].slice(0, count);
}
