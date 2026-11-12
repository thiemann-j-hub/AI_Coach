import { describe, expect, it } from "vitest";
import { bestimmeErgebnis, szenarioFaktenText, tatsachenText } from "./tatsachen";
import { SIMULATION_SCENARIOS } from "./scenarios";

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

describe("Paket 3, S13 — Fakten des Szenarios für die Faktenprüfung", () => {
  it("nimmt die Faktenanker der Rolle und das Faktenblatt, je Fakt eine Zeile, gleiche Zeilen nur einmal", () => {
    const t = szenarioFaktenText({
      personaDna: { facts: ["Vereinbarte Reaktionszeit: 24 Stunden.", "  Abgabe war am   Freitag. "] },
      candidateBriefing: { factSheet: ["Fluktuation: 15 %", "vereinbarte reaktionszeit: 24 stunden."] },
    });
    expect(t.split("\n")).toEqual(["- Vereinbarte Reaktionszeit: 24 Stunden.", "- Abgabe war am Freitag.", "- Fluktuation: 15 %"]);
  });

  it("ohne Zeilen im Faktenblatt werden die beschrifteten Grafiken zu Text", () => {
    const t = szenarioFaktenText({
      candidateBriefing: {
        factVisuals: [
          { kind: "trend", title: "Fluktuation", unit: " %", points: [{ label: "Vorjahr", value: 12 }, { label: "Heute", value: 15, approx: true }] },
          { kind: "bars", title: "Zufriedenheit", max: 4, items: [{ label: "Team A", value: 1.4 }], note: "Skala 1–4" },
          { kind: "kpis", title: "Plan", items: [{ label: "Zeit", value: "+24 %", sub: "Vorjahr +18 %" }] },
        ],
      },
    });
    expect(t).toContain("- Fluktuation: Vorjahr 12 % → Heute ca. 15 %");
    expect(t).toContain("- Zufriedenheit: Team A 1.4 (Skala 1–4)");
    expect(t).toContain("- Plan: Zeit +24 % (Vorjahr +18 %)");
  });

  it("ohne Fakten leer — dann prüft der Richter nichts; die Länge ist gedeckelt", () => {
    expect(szenarioFaktenText({})).toBe("");
    expect(szenarioFaktenText({ personaDna: { facts: [] }, candidateBriefing: { factSheet: [] } })).toBe("");
    const lang = szenarioFaktenText({ personaDna: { facts: ["a".repeat(60), "b".repeat(60), "c".repeat(60)] } }, 130);
    expect(lang.split("\n")).toHaveLength(2);
  });

  it("jedes eingebaute Szenario liefert Fakten", () => {
    for (const s of SIMULATION_SCENARIOS) expect(szenarioFaktenText(s).length, s.id).toBeGreaterThan(20);
  });
});
