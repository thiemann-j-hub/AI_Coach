import { describe, expect, it } from "vitest";
import { buildFuehrungPrompt } from "@/ai/flows/interview-fuehrung";
import { buildBerichtPrompt } from "@/ai/flows/interview-bericht";
import {
  INTERVIEW_MIN_ANTWORTEN,
  KURSFEEDBACK,
  OWNER_WORKSPACE_ID,
  abschluss,
  coachInterviewScope,
  eroeffnung,
  interviewAllowedFor,
  ueberleitung,
} from "./pilot";

describe("Welle 6 — Interview-Pilot Kursfeedback", () => {
  it("hat fünf Fragen in de/en, leichte Nachfragetiefe, letzte Frage ohne Nachfrage", () => {
    expect(KURSFEEDBACK.fragen).toHaveLength(5);
    for (const f of KURSFEEDBACK.fragen) {
      expect(f.text.de.length).toBeGreaterThan(10);
      expect(f.text.en.length).toBeGreaterThan(10);
      expect(f.nachfrageMax).toBeLessThanOrEqual(1);
    }
    expect(KURSFEEDBACK.fragen[4].nachfrageMax).toBe(0);
    expect(INTERVIEW_MIN_ANTWORTEN).toBe(5);
  });

  it("Pilot-Rahmen: Standard nur Owner-Workspace; off/all/Liste", () => {
    expect(interviewAllowedFor(OWNER_WORKSPACE_ID, {})).toBe(true);
    expect(interviewAllowedFor("ws-kunde", {})).toBe(false);
    expect(interviewAllowedFor("ws-kunde", { COACH_INTERVIEW: "all" })).toBe(true);
    expect(interviewAllowedFor(OWNER_WORKSPACE_ID, { COACH_INTERVIEW: "off" })).toBe(false);
    expect(interviewAllowedFor("b", { COACH_INTERVIEW: "a, b" })).toBe(true);
    expect(coachInterviewScope({ COACH_INTERVIEW: "off" })).toBe("off");
  });

  it("Eröffnung, Überleitung und Abschluss sind deterministisch und in der Sprache der Person", () => {
    expect(eroeffnung(KURSFEEDBACK, "Klar und fair", "de")).toContain("„Klar und fair“");
    expect(eroeffnung(KURSFEEDBACK, "Klar und fair", "de")).toContain(KURSFEEDBACK.fragen[0].text.de);
    expect(eroeffnung(KURSFEEDBACK, "Clear", "en")).toContain(KURSFEEDBACK.fragen[0].text.en);
    expect(ueberleitung(KURSFEEDBACK, 5, "de")).toContain("Letzte Frage");
    expect(ueberleitung(KURSFEEDBACK, 2, "de")).not.toContain("Letzte Frage");
    expect(abschluss("en")).toContain("last question");
  });

  it("Prompts tragen Ziel, aktuelle Frage und Verlauf, der Bericht die Regeln ohne Namen", () => {
    const p = buildFuehrungPrompt({
      def: KURSFEEDBACK,
      locale: "de",
      kursTitel: "Klar und fair",
      frageNr: 2,
      nachfragenBisher: 0,
      turns: [
        { role: "interviewer", text: "Frage 2?", frageNr: 2, ts: "t" },
        { role: "person", text: "Weiß nicht.", frageNr: 2, ts: "t" },
      ],
    });
    expect(p).toContain(KURSFEEDBACK.fragen[1].text.de);
    expect(p).toContain("PERSON:");
    expect(p).toContain("Weiß nicht");
    expect(p).toContain('"nachfrage": boolean');
    const b = buildBerichtPrompt({
      def: KURSFEEDBACK,
      locale: "de",
      kursTitel: "Klar und fair",
      interviews: [[{ frageNr: 1, text: "Die Beispiele." }], [{ frageNr: 1, text: "Das Video." }]],
    });
    expect(b).toContain("INTERVIEW 2");
    expect(b).toContain("Keine Namen");
  });
});
