/**
 * Einstiegs-Empfehlung (COACH-UX-BLUEPRINT §3/W1-4) — pure, getestet.
 *
 * Quelle ist bewusst NUR die eigene jüngste Auswertung (Run ODER Simulation):
 * der Coach bleibt Radar-SCHREIBER, kein Radar-Leser (Sparring-Entscheid 09.08.,
 * Kürzung gegenüber Geminis Historien-Variante). Cold Start = keine Auswertung
 * vorhanden → drei Stufe-1-Szenarien (Lerntreppe existiert als difficulty 1–3).
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
  /** Bewusst `string[]` — Client-Projektionen kennen den CompetencyKey-Typ nicht. */
  competencyFocus?: readonly string[];
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
 * Top-N-Empfehlung: Szenarien mit Fokus auf der schwächsten Kompetenz zuerst
 * (stabil — innerhalb einer Gruppe bleibt die Katalog-Reihenfolge erhalten),
 * ohne weakestC: die drei Stufe-1-Szenarien (Cold Start).
 */
export function recommendScenarios<T extends ScenarioLike>(
  scenarios: T[],
  weakestC: string | null,
  count = 3
): T[] {
  if (!weakestC) {
    // Cold Start: leichteste Szenarien zuerst. Stufe 1 hat aktuell nur zwei
    // Einträge — es wird stabil mit der nächsten Stufe aufgefüllt, damit der
    // Streifen immer `count` Karten zeigt (stabile Sortierung: Katalog-Reihenfolge).
    return [...scenarios]
      .sort((a, b) => a.difficulty - b.difficulty)
      .slice(0, count);
  }
  const hit = scenarios.filter((s) => (s.competencyFocus ?? []).includes(weakestC));
  const rest = scenarios.filter((s) => !(s.competencyFocus ?? []).includes(weakestC));
  return [...hit, ...rest].slice(0, count);
}
