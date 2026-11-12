/**
 * Katalog am Einstieg (Paket 5, U21, 12.11.2026) — pure, getestet.
 *
 * Vorher standen die drei Empfehlungen direkt darunter noch einmal in der Gesamtliste, die Liste war nicht nach
 * Stufe geordnet, und keine Karte zeigte, was schon gespielt ist. Hier liegen die zwei Regeln dazu:
 * bestes Ergebnis je Szenario aus den eigenen abgeschlossenen Läufen und die Reihenfolge der Gesamtliste.
 */

export interface PlayedInfo {
  /** Bestes Gesamtergebnis 0–100 aus den abgeschlossenen Läufen; null = gespielt, aber ohne Punktzahl. */
  best: number | null;
  /** Zahl der abgeschlossenen Läufe. */
  count: number;
}

/**
 * Bestes Ergebnis je Szenario. Die Zeilen kommen aus einer schlanken Abfrage (nur Szenario und Gesamtwert,
 * keine Gespräche); Zeilen ohne Szenario zählen nicht, Läufe ohne Punktzahl zählen als gespielt.
 */
export function bestByScenario(
  rows: ReadonlyArray<{ scenarioId?: unknown; overall?: unknown }> | null | undefined
): Record<string, PlayedInfo> {
  const out = new Map<string, PlayedInfo>();
  if (!Array.isArray(rows)) return {};
  for (const r of rows) {
    if (!r || typeof r.scenarioId !== "string" || !r.scenarioId) continue;
    const cur = out.get(r.scenarioId) ?? { best: null, count: 0 };
    const pct = typeof r.overall === "number" && Number.isFinite(r.overall) ? Math.round(r.overall) : null;
    out.set(r.scenarioId, {
      best: pct == null ? cur.best : cur.best == null ? pct : Math.max(cur.best, pct),
      count: cur.count + 1,
    });
  }
  return Object.fromEntries(out);
}

/**
 * Reihenfolge der Gesamtliste: nach Stufe (1, 2, 3), innerhalb der Stufe wie bisher (Katalog-Reihenfolge).
 * Szenarien, die schon darüber stehen (die Empfehlungen), fallen heraus.
 */
export function catalogOrder<T extends { id: string; difficulty: number }>(
  scenarios: readonly T[],
  shownAbove: ReadonlyArray<{ id: string }> = []
): T[] {
  const skip = new Set(shownAbove.map((s) => s.id));
  return scenarios
    .filter((s) => !skip.has(s.id))
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.difficulty - b.s.difficulty || a.i - b.i)
    .map((x) => x.s);
}
