import { describe, expect, it } from "vitest";
import { FAEHIGKEITEN, anker, ergaenzeAnker, faehigkeit, faehigkeitRubrik, faehigkeitenKatalog } from "./faehigkeiten";
import { SIMULATION_SCENARIOS } from "./scenarios";

describe("Fähigkeiten-Bibliothek (Welle 1)", () => {
  it("führt eindeutige, schema-taugliche Keys und je vier Stufen in beiden Sprachen", () => {
    const ids = FAEHIGKEITEN.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const x of FAEHIGKEITEN) {
      expect(x.id).toMatch(/^[a-z-]{3,20}$/);
      expect(x.titel.de.length).toBeGreaterThan(5);
      expect(x.titel.en.length).toBeGreaterThan(5);
      expect(x.definition.de.length).toBeGreaterThan(30);
      expect(x.definition.en.length).toBeGreaterThan(30);
      expect(x.stufen).toHaveLength(4);
      for (const s of x.stufen) {
        expect(s.de.length).toBeGreaterThan(30);
        expect(s.en.length).toBeGreaterThan(30);
      }
    }
    expect(FAEHIGKEITEN.length).toBeGreaterThanOrEqual(30);
  });

  it("baut die Rubrik mit Definition und vier nummerierten Stufen", () => {
    const r = faehigkeitRubrik(faehigkeit("konkret")!, "de");
    expect(r).toContain("Definition:");
    expect(r).toContain("1 = Nicht gezeigt:");
    expect(r).toContain("4 = Übertroffen:");
    const e = faehigkeitRubrik(faehigkeit("konkret")!, "en");
    expect(e).toContain("Levels:");
    expect(e).toContain("3 = Meets the bar:");
  });

  it("anker() liefert Key, Titel, Gewicht und Rubrik; unbekannte Ids werfen", () => {
    const a = anker("de", [["rahmen", 25], ["konkret", 75]]);
    expect(a.map((x) => x.key)).toEqual(["rahmen", "konkret"]);
    expect(a[0].label).toBe("Rahmen setzen und Sicherheit geben");
    expect(a[1].weight).toBe(75);
    expect(a[1].rubric).toContain("Stufen:");
    expect(() => anker("de", [["gibt-es-nicht", 1]])).toThrow(/Unbekannte Fähigkeit/);
  });

  it("ergaenzeAnker() füllt Bibliotheks-Keys und lässt eigene Anker in Ruhe", () => {
    const out = ergaenzeAnker(
      [
        { key: "ursache", label: "x", weight: 2 },
        { key: "eigen-1", label: "Eigener Anker", weight: 1, rubric: "4 = …" },
      ],
      "de"
    );
    expect(out[0].label).toBe("Bis zur Ursache zuhören");
    expect(out[0].rubric).toContain("Stufen:");
    expect(out[1]).toEqual({ key: "eigen-1", label: "Eigener Anker", weight: 1, rubric: "4 = …" });
  });

  it("der Katalog für den Generator nennt jede Gruppe mit Ids", () => {
    const k = faehigkeitenKatalog("de");
    expect(k).toContain("Kaltakquise");
    expect(k).toContain("einstieg (Einstieg und Erlaubnis)");
    expect(faehigkeitenKatalog("en")).toContain("cold call");
  });

  it("jeder Anker der Standard-Szenarien stammt aus der Bibliothek, in der Sprache des Szenarios", () => {
    for (const s of SIMULATION_SCENARIOS) {
      for (const c of s.assessment.competencies) {
        const x = faehigkeit(c.key);
        expect(x, `${s.id}: ${c.key}`).toBeDefined();
        expect(c.label).toBe(x!.titel[s.locale]);
      }
    }
  });
});
