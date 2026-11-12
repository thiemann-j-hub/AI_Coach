import { describe, expect, it } from "vitest";
import { computeDeltaCta, computeStudioBridge, empfehlbareSzenarien, type EndscreenScenario } from "./endscreen";
import type { RatingLike, SkillRatingLike } from "./empfehlung";

// C1 bis C10: nur noch Auslöser der Kurs- und der Studio-Brücke.
const ratings: RatingLike[] = [
  { id: "C2", name: "Problemlösung und Entscheidungsfindung", score: 3 },
  { id: "C5", name: "Kommunikation und Teamfähigkeit", score: 2 },
  { id: "C9", name: "Zukunftsorientierung", score: null },
];

// Fähigkeiten der Auswertung (feedback.rubric).
const rubric: SkillRatingLike[] = [
  { key: "rahmen", label: "Rahmen setzen und Sicherheit geben", score: 3 },
  { key: "ursache", label: "Bis zur Ursache zuhören", score: 2 },
  { key: "konkret", label: "Konkret werden", score: 2 },
  { key: "vereinbarung", label: "Verbindlich vereinbaren", score: null },
];

const sc = (id: string, title: string, keys: string[]): EndscreenScenario => ({ id, title, difficulty: 1, competencies: keys.map((key) => ({ key })) });
const scenarios = [
  sc("morgan", "Harmonie vs. Steuerung", ["rahmen", "konkret"]),
  sc("vance", "Der brillante Experte", ["ursache", "konkret"]),
  sc("roth", "Fair bleiben", ["ursache", "vereinbarung"]),
];

describe("computeDeltaCta (W3-1, seit U15 aus den Fähigkeiten)", () => {
  it("Rückschritt gewinnt: stärkster Drop, Szenario ≠ aktuelles bevorzugt", () => {
    const cta = computeDeltaCta({
      rubric,
      deltaAnchors: [{ key: "rahmen", delta: 10 }, { key: "ursache", delta: -34 }, { key: "konkret", delta: -10 }],
      scenarios,
      currentScenarioId: "vance",
    });
    expect(cta?.skillKey).toBe("ursache");
    expect(cta?.mode).toBe("dropped");
    // vance ist der aktuelle Lauf → roth (nächster Treffer für „ursache“) gewinnt.
    expect(cta?.scenarioId).toBe("roth");
    expect(cta?.skillName).toBe("Bis zur Ursache zuhören");
  });

  it("ohne Vorlauf: schwächste beobachtete Fähigkeit (null zählt nie), bei Gleichstand die frühere", () => {
    const cta = computeDeltaCta({ rubric, deltaAnchors: null, scenarios });
    expect(cta?.skillKey).toBe("ursache"); // 2 = 2, „ursache“ steht früher; „vereinbarung“ ist null → ignoriert
    expect(cta?.mode).toBe("weakest");
    expect(cta?.scenarioId).toBe("vance");
  });

  it("Gleichstand: die Fähigkeit des „Größten Hebels“ gewinnt — die Empfehlung widerspricht ihm nicht", () => {
    const cta = computeDeltaCta({ rubric, nextStepKey: "konkret", scenarios, currentScenarioId: "morgan" });
    expect(cta?.skillKey).toBe("konkret");
    expect(cta?.skillName).toBe("Konkret werden");
    // morgan ist der aktuelle Lauf → vance bewertet „konkret“ auch.
    expect(cta?.scenarioId).toBe("vance");
  });

  it("nur positive/null-Deltas oder Deltas fremder Schlüssel → Fallback auf schwächste Fähigkeit", () => {
    const cta = computeDeltaCta({
      rubric,
      deltaAnchors: [{ key: "rahmen", delta: 5 }, { key: "ursache", delta: null }, { key: "gibt-es-nicht", delta: -50 }],
      scenarios,
    });
    expect(cta?.mode).toBe("weakest");
    expect(cta?.skillKey).toBe("ursache");
  });

  it("nur das gerade gespielte Szenario bewertet die Fähigkeit → es wird angeboten", () => {
    const cta = computeDeltaCta({ rubric: [{ key: "rahmen", label: "Rahmen", score: 1 }], scenarios, currentScenarioId: "morgan" });
    expect(cta?.scenarioId).toBe("morgan");
  });

  it("kein Szenario bewertet die Fähigkeit → Satz ohne Szenario (scenarioId null), nie ein fremdes", () => {
    const cta = computeDeltaCta({
      rubric: [{ key: "eigener-anker", label: "Eigene Fähigkeit", score: 1 }],
      scenarios,
    });
    expect(cta?.skillKey).toBe("eigener-anker");
    expect(cta?.scenarioId).toBeNull();
    expect(cta?.scenarioTitle).toBeNull();
  });

  it("gar keine beobachtete Fähigkeit → null (kein leerer CTA); C1 bis C10 zählt hier nicht mehr", () => {
    expect(computeDeltaCta({ rubric: [], scenarios })).toBeNull();
    expect(computeDeltaCta({ rubric: null, scenarios })).toBeNull();
    expect(computeDeltaCta({ rubric: [{ key: "rahmen", label: "Rahmen", score: null }], scenarios })).toBeNull();
  });
});

describe("empfehlbareSzenarien (Katalog wie am Einstieg)", () => {
  it("ohne Varianten und ohne selbst vorbereitete Gespräche; nur die Felder, die die Empfehlung braucht", () => {
    const liste = empfehlbareSzenarien([
      { id: "sim-a", title: "A", difficulty: 2, competencies: [{ key: "rahmen", label: "Rahmen", weight: 50 }], teaser: "x" },
      { id: "sim-a-2", title: "A2", difficulty: 2, variante: { von: "sim-a" }, competencies: [{ key: "rahmen" }] },
      { id: "ws-mein-abc", title: "Mein Gespräch", difficulty: 1, competencies: [{ key: "rahmen" }] },
      { id: "ws-team", title: "Team", competencies: null },
      { title: "ohne Id" },
      null,
    ]);
    expect(liste).toEqual([
      { id: "sim-a", title: "A", difficulty: 2, competencies: [{ key: "rahmen" }] },
      { id: "ws-team", title: "Team", difficulty: 1, competencies: [] },
    ]);
  });

  it("kaputte Antwort → leere Liste", () => {
    expect(empfehlbareSzenarien(null)).toEqual([]);
    expect(empfehlbareSzenarien("kaputt")).toEqual([]);
  });
});

describe("computeStudioBridge (W3-3)", () => {
  it("echte Schwäche (≤2) → Deeplink im Hub-Format", () => {
    const b = computeStudioBridge(ratings);
    expect(b?.cKey).toBe("C5");
    expect(b?.href).toBe(
      "https://app.pulsenorth.ai/studio/projects/new?intent=gap&c=C5&t=3&i=2"
    );
  });

  it("U15: Auslöser und Link bleiben bei C1 bis C10, die Lücke heißt wie die schwächste Fähigkeit", () => {
    const b = computeStudioBridge(ratings, rubric, "konkret");
    expect(b?.cKey).toBe("C5");
    expect(b?.cName).toContain("Kommunikation");
    expect(b?.href).toContain("c=C5");
    expect(b?.gapName).toBe("Konkret werden");
    // Alt-Lauf ohne Fähigkeiten: der Name der Kompetenz.
    expect(computeStudioBridge(ratings)?.gapName).toContain("Kommunikation");
    expect(computeStudioBridge(ratings, [])?.gapName).toContain("Kommunikation");
  });

  it("keine Brücke ohne echte Schwäche (alles ≥3) oder ohne Beobachtung", () => {
    expect(
      computeStudioBridge([{ id: "C1", name: "x", score: 3 }])
    ).toBeNull();
    expect(computeStudioBridge([])).toBeNull();
    expect(computeStudioBridge(null)).toBeNull();
  });
});
