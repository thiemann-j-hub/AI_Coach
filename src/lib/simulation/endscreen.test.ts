import { describe, expect, it } from "vitest";
import { computeDeltaCta, computeStudioBridge } from "./endscreen";
import type { RatingLike } from "./empfehlung";

const ratings: RatingLike[] = [
  { id: "C2", name: "Klarheit und Entscheidungsstärke", score: 3 },
  { id: "C5", name: "Kommunikation und Kooperation", score: 2 },
  { id: "C9", name: "Zukunftsorientierung", score: null },
];

const scenarios = [
  { id: "morgan", title: "Harmonie vs. Steuerung", competencyFocus: ["C3", "C2"] },
  { id: "vance", title: "Der brillante Experte", competencyFocus: ["C5", "C2"] },
  { id: "roth", title: "Fair bleiben", competencyFocus: ["C5", "C4"] },
];

describe("computeDeltaCta (W3-1)", () => {
  it("Rückschritt gewinnt: stärkster Drop, Szenario ≠ aktuelles bevorzugt", () => {
    const cta = computeDeltaCta({
      ratings,
      deltaCompetencies: { C2: 0.5, C5: -1, C7: -0.5 },
      scenarios,
      currentScenarioId: "vance",
    });
    expect(cta?.cKey).toBe("C5");
    expect(cta?.mode).toBe("dropped");
    // vance ist der aktuelle Lauf → roth (nächster C5-Treffer) gewinnt.
    expect(cta?.scenarioId).toBe("roth");
    expect(cta?.cName).toContain("Kommunikation");
  });

  it("ohne Vorlauf: schwächste beobachtete Kompetenz (null zählt nie)", () => {
    const cta = computeDeltaCta({ ratings, deltaCompetencies: null, scenarios });
    expect(cta?.cKey).toBe("C5"); // score 2 < 3; C9 ist null → ignoriert
    expect(cta?.mode).toBe("weakest");
    expect(cta?.scenarioId).toBe("vance");
  });

  it("nur positive/null-Deltas → Fallback auf schwächste Kompetenz", () => {
    const cta = computeDeltaCta({
      ratings,
      deltaCompetencies: { C2: 0.5, C5: null },
      scenarios,
    });
    expect(cta?.mode).toBe("weakest");
  });

  it("kein Fokus-Treffer → Satz ohne Szenario (scenarioId null)", () => {
    const cta = computeDeltaCta({
      ratings: [{ id: "C8", name: "Selbstreflexion", score: 1 }],
      scenarios,
    });
    expect(cta?.cKey).toBe("C8");
    expect(cta?.scenarioId).toBeNull();
  });

  it("gar keine beobachtete Kompetenz → null (kein leerer CTA)", () => {
    expect(computeDeltaCta({ ratings: [], scenarios })).toBeNull();
    expect(computeDeltaCta({ ratings: null, scenarios })).toBeNull();
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

  it("keine Brücke ohne echte Schwäche (alles ≥3) oder ohne Beobachtung", () => {
    expect(
      computeStudioBridge([{ id: "C1", name: "x", score: 3 }])
    ).toBeNull();
    expect(computeStudioBridge([])).toBeNull();
    expect(computeStudioBridge(null)).toBeNull();
  });
});
