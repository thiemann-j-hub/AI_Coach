import { describe, expect, it } from "vitest";
import { OBSERVER_CANON_DE, OBSERVER_CANON_EN, findPersonJudgments, observerCanon } from "./coach-canon";

describe("coach-canon — Beobachter-Kanon (V2)", () => {
  it("Kanon trägt die drei Pflichtschritte und die Begleiter-Haltung (de + en)", () => {
    for (const c of [OBSERVER_CANON_DE, OBSERVER_CANON_EN]) {
      expect(c).toMatch(/MOMENT/);
      expect(c).toMatch(/WIRKUNG|EFFECT/);
      expect(c).toMatch(/WIRKSAMERER WEG|MORE EFFECTIVE PATH/);
      expect(c).toMatch(/Begleiter|companion/);
      expect(c).toMatch(/Richter|judge/);
    }
    expect(observerCanon("de")).toBe(OBSERVER_CANON_DE);
    expect(observerCanon("en")).toBe(OBSERVER_CANON_EN);
  });

  it("findet Personen-Urteile und Generalisierungen", () => {
    const hits = findPersonJudgments(
      "Du bist zu weich im Ton. Du redest immer zu lange. Das war total unklar. You are too aggressive here."
    );
    expect(hits.length).toBeGreaterThanOrEqual(4);
    expect(hits.join(" | ")).toMatch(/Du bist zu weich/i);
    expect(hits.join(" | ")).toMatch(/redest immer/i);
    expect(hits.join(" | ")).toMatch(/total unklar/i);
    expect(hits.join(" | ")).toMatch(/You are too aggressive/i);
  });

  it("lässt kanonkonforme Du-Botschaften durch", () => {
    const ok =
      "In dem Moment, als Deniz den Vorwurf brachte, hast du sofort einen Vorschlag gemacht. Das führte dazu, dass die eigentliche Sorge ungehört blieb. Ein wirksamerer Weg wäre eine offene Frage, zum Beispiel: »Was genau macht dich daran unsicher?«";
    expect(findPersonJudgments(ok)).toEqual([]);
    expect(findPersonJudgments("Du bist dran — wie machst du weiter?")).toEqual([]);
  });
});
