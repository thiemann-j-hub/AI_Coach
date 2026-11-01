import { describe, expect, it } from "vitest";
import { bestimmeErgebnis, tatsachenText } from "./tatsachen";

describe("Bewertung 2.0 — Tatsachen für den Richter", () => {
  it("nennt das freigegebene Ziel, die zuletzt gültigen Bedingungen und vorschnelle Züge", () => {
    const t = tatsachenText({
      personaName: "Katja Brenner",
      locale: "de",
      closedByPersona: { ergebnis: "ziel", grund: "Testphase vereinbart." },
      regie: [
        { turn: 4, stufe: 1, erfuellt: ["Bedenken ernst genommen"] },
        { turn: 6, stufe: 1, erfuellt: ["Bedenken ernst genommen"], vorschnell: true },
        { turn: 8, stufe: 2, erfuellt: ["Bedenken ernst genommen", "Datenschutz mit Fakten beantwortet"] },
      ],
    });
    expect(t).toContain("Katja Brenner hat das Ziel freigegeben und das Gespräch beendet: Testphase vereinbart.");
    expect(t).toContain("Bedingung erfüllt (Zug 8): Bedenken ernst genommen");
    expect(t).toContain("Bedingung erfüllt (Zug 8): Datenschutz mit Fakten beantwortet");
    expect(t).toContain("vorschnell ein");
    expect(t).toContain("Zug 6");
  });

  it("ist leer ohne Ende und ohne Bedingungen; Zeitablauf wird genannt", () => {
    expect(tatsachenText({ personaName: "A", locale: "de" })).toBe("");
    expect(tatsachenText({ personaName: "A", locale: "en", closedByTime: true })).toContain("Time ran out");
  });

  it("Ergebnis: Rolle hat Vorrang, dann der Richter, sonst offen", () => {
    expect(bestimmeErgebnis({ closedByPersona: { ergebnis: "ziel", grund: "x" }, zielErreicht: false })).toBe("ziel");
    expect(bestimmeErgebnis({ closedByPersona: { ergebnis: "abbruch", grund: "x" }, zielErreicht: true })).toBe("abbruch");
    expect(bestimmeErgebnis({ closedByPersona: { ergebnis: "verabschiedung", grund: "x" }, zielErreicht: true })).toBe("ziel");
    expect(bestimmeErgebnis({ zielErreicht: null })).toBe("offen");
    expect(bestimmeErgebnis({})).toBe("offen");
  });
});
