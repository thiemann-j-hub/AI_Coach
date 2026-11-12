/**
 * Endscreen-Mechaniken der Wiederkehr (COACH-UX-BLUEPRINT §5, Welle 3) — pure.
 *
 * W3-1 Delta als Auslöser: aus Erkenntnis wird Handlung. Gab es gegenüber dem
 * Vorversuch einen Rückschritt bei einer Fähigkeit, wird SIE benannt und ein
 * Szenario angeboten, das sie bewertet. Ohne Vorlauf (erster Versuch)
 * übernimmt die schwächste beobachtete Fähigkeit.
 *
 * U15, Rest (Paket 6, 12.11.2026): Grundlage sind die Fähigkeiten der Auswertung (`feedback.rubric`, Vergleich
 * `delta.anchors`), nicht mehr das Modell C1 bis C10. Vorher nannte der Reiter „Weiter üben“ eine Lücke aus
 * C1 bis C10, die dem „Größten Hebel“ widersprach. Dieselbe Regel wie am Einstieg (empfehlung.ts).
 *
 * W3-3 Studio-Brücke: echte Schwäche (score ≤ 2) → Deeplink ins Learning
 * Studio im Hub-Format (radar-ui-logic; Studio validiert hart). BEWUSST keine
 * Radar-Historien-Lesung (Sparring-Kürzung: 80 % Wirkung, 10 % Kosten).
 * Auslöser, Kurs-Abgleich und Deeplink bleiben beim Modell C1 bis C10, weil Kurse und Studio nur dieses kennen.
 * Wo die Brücken die Lücke der Person benennen, steht die schwächste Fähigkeit (`gapName`).
 */

import {
  recommendScenarios,
  weakestObservedC,
  weakestObservedSkill,
  type RatingLike,
  type ScenarioLike,
  type SkillRatingLike,
} from "./empfehlung";

/** Katalog-Projektion für die Empfehlung im Reiter „Weiter üben“. */
export interface EndscreenScenario extends ScenarioLike {
  title: string;
}

/**
 * Aus der Antwort von /api/simulation/scenarios die Szenarien, die zur Empfehlung stehen: wie am Einstieg ohne
 * Varianten (sie hängen an ihrer Grundkarte) und ohne selbst vorbereitete Gespräche (`ws-mein-`).
 */
export function empfehlbareSzenarien(scenarios: unknown): EndscreenScenario[] {
  if (!Array.isArray(scenarios)) return [];
  const out: EndscreenScenario[] = [];
  for (const raw of scenarios) {
    const s = raw as { id?: unknown; title?: unknown; difficulty?: unknown; variante?: unknown; competencies?: unknown } | null;
    if (!s || typeof s.id !== "string" || typeof s.title !== "string") continue;
    if (s.variante || s.id.startsWith("ws-mein-")) continue;
    const keys = Array.isArray(s.competencies)
      ? s.competencies.flatMap((c) => (c && typeof (c as { key?: unknown }).key === "string" ? [{ key: (c as { key: string }).key }] : []))
      : [];
    out.push({ id: s.id, title: s.title, difficulty: s.difficulty === 2 || s.difficulty === 3 ? s.difficulty : 1, competencies: keys });
  }
  return out;
}

export interface DeltaCta {
  /** Schlüssel der Fähigkeit (`feedback.rubric`). */
  skillKey: string;
  /** Name der Fähigkeit, wie er im Reiter „Fähigkeiten“ steht. */
  skillName: string | null;
  /** dropped = Rückschritt ggü. Vorversuch; weakest = größte aktuelle Lücke. */
  mode: "dropped" | "weakest";
  scenarioId: string | null;
  scenarioTitle: string | null;
}

export function computeDeltaCta<T extends EndscreenScenario>(args: {
  /** Fähigkeiten dieser Auswertung (`feedback.rubric`). */
  rubric: SkillRatingLike[] | null | undefined;
  /** Fähigkeit des „Größten Hebels“ (`feedback.nextStepKey`): entscheidet bei Gleichstand. */
  nextStepKey?: string | null;
  /** Veränderung je Fähigkeit ggü. Vorversuch (`delta.anchors`, Prozentpunkte); null = kein Vorlauf. */
  deltaAnchors?: ReadonlyArray<{ key: string; delta: number | null }> | null;
  /** Katalog wie am Einstieg: ohne Varianten und ohne selbst vorbereitete Gespräche. */
  scenarios: T[];
  currentScenarioId?: string | null;
}): DeltaCta | null {
  const rubric = Array.isArray(args.rubric) ? args.rubric : [];
  const nameOf = (key: string): string | null => {
    const r = rubric.find((x) => x && x.key === key);
    return r && typeof r.label === "string" && r.label ? r.label : null;
  };

  // 1) Rückschritt ggü. Vorversuch — stärkster Drop gewinnt, Gleichstand →
  //    die frühere Fähigkeit in der Rubrik (deterministisch).
  let skillKey: string | null = null;
  let mode: DeltaCta["mode"] = "weakest";
  let worst: number | null = null;
  for (const a of Array.isArray(args.deltaAnchors) ? args.deltaAnchors : []) {
    if (!a || typeof a.key !== "string" || typeof a.delta !== "number" || !(a.delta < 0)) continue;
    if (!rubric.some((r) => r && r.key === a.key)) continue;
    if (worst === null || a.delta < worst) {
      worst = a.delta;
      skillKey = a.key;
    }
  }
  if (skillKey) mode = "dropped";
  // 2) Fallback: schwächste beobachtete Fähigkeit DIESER Auswertung.
  if (!skillKey) {
    const w = weakestObservedSkill(rubric, args.nextStepKey);
    if (!w) return null;
    skillKey = w.key;
  }

  // Passendes Szenario: das erste, das diese Fähigkeit bewertet, bevorzugt ein
  // ANDERES als das gerade gespielte (Abwechslung schlägt Wiederholung).
  const key = skillKey;
  const first = recommendScenarios(args.scenarios, key, 1, args.currentScenarioId ?? null)[0];
  const target = first && (first.competencies ?? []).some((c) => c.key === key) ? first : null;

  return {
    skillKey,
    skillName: nameOf(skillKey),
    mode,
    scenarioId: target?.id ?? null,
    scenarioTitle: target?.title ?? null,
  };
}

export interface StudioBridge {
  cKey: string;
  /** Name der Kompetenz: das, was ein passender Kurs übt (Kurse tragen C1 bis C10). */
  cName: string | null;
  score: number;
  /** Deeplink im Hub-Format — Studio-Parser validiert hart (radar-ui-logic). */
  href: string;
  /** Name der Lücke für die Texte: die schwächste beobachtete Fähigkeit, sonst die Kompetenz. */
  gapName: string | null;
}

/**
 * W3-3: nur bei ECHTER Schwäche (schwächste beobachtete Kompetenz ≤ 2). `rubric` und `nextStepKey` liefern nur
 * den Namen der Lücke (U15); am Auslöser ändern sie nichts.
 */
export function computeStudioBridge(
  ratings: RatingLike[] | null | undefined,
  rubric?: SkillRatingLike[] | null,
  nextStepKey?: string | null
): StudioBridge | null {
  const w = weakestObservedC(ratings);
  if (!w || w.score > 2) return null;
  const skill = weakestObservedSkill(rubric, nextStepKey);
  return {
    cKey: w.id,
    cName: w.name,
    score: w.score,
    href: `https://app.pulsenorth.ai/studio/projects/new?intent=gap&c=${w.id}&t=3&i=${w.score}`,
    gapName: skill?.label ?? w.name,
  };
}
