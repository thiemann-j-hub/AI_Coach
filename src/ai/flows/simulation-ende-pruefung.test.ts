import { describe, expect, it } from "vitest";
import { getScenario } from "@/lib/simulation/scenarios";
import { buildEndePruefungPrompt, coachEndePruefungOn, endeAbgelehntNote } from "./simulation-ende-pruefung";
import { regieStageNote } from "./simulation-regie";

const morgan = getScenario("sim-coaching-morgan")!;
const stone = getScenario("sim-appraisal-stone")!;

describe("Torwächter — Ende-Prüfung (01.11.2026)", () => {
  it("legt der Spielleitung Grund, Endbedingungen und nur die letzten Züge vor und verlangt Vollständigkeit", () => {
    const turns = Array.from({ length: 16 }, (_, i) => ({ role: i % 2 ? ("persona" as const) : ("user" as const), text: `Zug ${i}`, ts: "t" }));
    const p = buildEndePruefungPrompt(morgan, turns, { grund: "Termin vereinbart.", ergebnis: "ziel" });
    expect(p).toContain("Termin vereinbart.");
    for (const b of morgan.personaDna.endbedingungen ?? []) expect(p).toContain(b);
    expect(p).toContain("VOLLSTÄNDIG");
    expect(p).not.toContain("Zug 0");
    expect(p).toContain("Zug 15");
  });

  it("Regie-Notiz bei abgelehntem Ende nennt, was fehlt, und passt in die Marker-Hülle", () => {
    const n = endeAbgelehntNote(morgan, "Umfang und Termin des Pilots");
    expect(n).toContain("Beende das Gespräch noch nicht");
    expect(n).toContain("Umfang und Termin des Pilots");
    expect(regieStageNote(morgan, { stufe: 0, erfuellt: [], eskaliert: false, notiz: n, turn: 1, ts: "t" })).toMatch(/^\[REGIE — .*\]$/);
    expect(endeAbgelehntNote(stone, "")).toContain("not fully met");
  });

  it("Schalter: Standard an, COACH_ENDE_PRUEFUNG=off schaltet ab", () => {
    expect(coachEndePruefungOn({})).toBe(true);
    expect(coachEndePruefungOn({ COACH_ENDE_PRUEFUNG: "off" })).toBe(false);
  });
});
