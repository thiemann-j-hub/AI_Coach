import { describe, expect, it } from "vitest";
import { buildFeedbackPrompt, parseJudgeJson, type SimulationFeedbackInput } from "./simulation-feedback";

const base: SimulationFeedbackInput = {
  scenarioTitle: "Test",
  personaName: "Alex",
  goalsList: "1. Ziel",
  rubricList: "- konkret: Konkret bleiben\n  BEWERTUNGS-RUBRIK:\n  Definition: …\n  Stufen:\n  1 = Nicht gezeigt: …",
  checkpointList: '- id "x": Moment',
  transcript: "Teilnehmer:in: Hallo\nAlex: Hi",
  focus: "",
  selfAssessment: "",
  outputLanguage: "Deutsch",
  canon: "KANON",
  cardsBlock: "",
  transferReview: "",
  gespraechsende: "",
  regieVerlauf: "",
};

describe("Auswertungs-Prompt (Welle 1)", () => {
  it("erklärt Stufen-Rubrik, Gelungen/Nächstes Mal und verlangt Belege zuerst", () => {
    const p = buildFeedbackPrompt(base);
    expect(p).toContain("1 = Nicht gezeigt · 2 = Ansätze · 3 = Erfüllt · 4 = Übertroffen");
    expect(p).toContain("wentWell");
    expect(p).toContain("tryNext");
    expect(p).toContain("Erfinde KEINE Zitate");
    expect(p).toContain("Kein Fokus-Vorsatz vorgegeben");
    expect(p).toContain("Keine Selbsteinschätzung abgegeben");
    expect(p).not.toContain("GESPRÄCHSENDE");
    expect(p).not.toContain("ÖFFNUNGSVERLAUF");
  });

  it("trägt Gesprächsende und Öffnungsverlauf nur als Kontext ein", () => {
    const p = buildFeedbackPrompt({ ...base, gespraechsende: "Alex beendete das Gespräch (ziel): Termin steht.", regieVerlauf: "Zug 3: Stufe 1" });
    expect(p).toContain("GESPRÄCHSENDE (Kontext, kein Beleg für Scores): Alex beendete");
    expect(p).toContain("ÖFFNUNGSVERLAUF DER ROLLE");
    expect(p).toContain("Zug 3: Stufe 1");
  });

  it("parseJudgeJson verträgt Zäune und Vortext", () => {
    expect(parseJudgeJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJudgeJson('Hier das Ergebnis: {"a":{"b":2}} Ende')).toEqual({ a: { b: 2 } });
    expect(() => parseJudgeJson("kein json")).toThrow();
  });
});
