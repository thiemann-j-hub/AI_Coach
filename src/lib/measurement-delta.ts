/**
 * Delta-Berechnung zwischen zwei Coach-Messungen — fuer die Delta-Card im
 * Report („Entwicklung seit letzter Messung", P0-1 der Best-in-Class-Welle).
 *
 * SKALEN-SSOT (Plattform-Bedingung B): beide Seiten werden ueber
 * `metricsFromCompetencyRatings` aus @/lib/radar-contract gemappt — DIESELBE
 * Funktion, die den Radar-Emit speist. Report-Delta ≡ Radar-Delta per
 * Konstruktion; Anzeige auf der 1–4-Skala (COACH_SCALE), NIE scoreOverall/10.
 *
 * NULL-DISZIPLIN: ist eine Kompetenz in EINEM der beiden Laeufe nicht
 * beobachtbar (null), ist ihr Delta null („nicht vergleichbar") — niemals 0,
 * niemals ein Pseudo-Delta.
 *
 * PURE (kein "server-only", kein I/O) — Server (runs/get) rechnet, der Client
 * rendert nur; Tests decken die Regeln ab.
 */
import {
  COMPETENCY_KEYS,
  metricsFromCompetencyRatings,
  type CompetencyKey,
  type RadarMetrics,
} from "@/lib/radar-contract";

export interface MeasurementDelta {
  /** Aktueller Lauf auf der 1–4-Vertragsskala (null = nicht beobachtbar). */
  current: RadarMetrics;
  /** Vergleichslauf auf der 1–4-Vertragsskala. */
  previous: RadarMetrics;
  /** Delta je Kompetenz + overall; null = in einem der Laeufe nicht beobachtbar. */
  deltas: Record<CompetencyKey, number | null> & { overall: number | null };
  /** Anzahl Kompetenzen mit vergleichbarem (numerischem) Delta. */
  comparableCount: number;
  /** Anzahl Kompetenzen, die in genau einem der beiden Laeufe beobachtbar waren. */
  notComparableCount: number;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Rechnet das Delta zweier Laeufe aus ihren rohen `competency_ratings`.
 * Defensive Eingaben (unknown) — Alt-Formen werfen nie.
 */
export function computeMeasurementDelta(
  currentRatings: unknown,
  previousRatings: unknown
): MeasurementDelta {
  const current = metricsFromCompetencyRatings(currentRatings);
  const previous = metricsFromCompetencyRatings(previousRatings);

  const deltas = {} as MeasurementDelta["deltas"];
  let comparableCount = 0;
  let notComparableCount = 0;

  for (const k of COMPETENCY_KEYS) {
    const cur = current[k];
    const prev = previous[k];
    if (typeof cur === "number" && typeof prev === "number") {
      deltas[k] = round1(cur - prev);
      comparableCount++;
    } else {
      deltas[k] = null;
      // "nicht vergleichbar" zaehlt nur, wenn genau EINE Seite beobachtbar war
      // (beidseitig unbeobachtet ist schlicht keine Aussage, kein Konflikt).
      if (typeof cur === "number" || typeof prev === "number") notComparableCount++;
    }
  }

  deltas.overall =
    typeof current.overall === "number" && typeof previous.overall === "number"
      ? round1(current.overall - previous.overall)
      : null;

  return { current, previous, deltas, comparableCount, notComparableCount };
}
