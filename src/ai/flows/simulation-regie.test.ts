import { describe, expect, it } from "vitest";
import { getScenario } from "@/lib/simulation/scenarios";
import { buildRegiePrompt, offeneRegieNotiz, regieStageNote, regieVerlaufText, type RegieStand } from "./simulation-regie";

const morgan = getScenario("sim-coaching-morgan")!;
const stone = getScenario("sim-appraisal-stone")!;

describe("Regie-Beobachter (Welle 2)", () => {
  it("gibt dem Beobachter Bedingungen, Freigabe-Regel, Trigger und nur die letzten Züge", () => {
    const turns = Array.from({ length: 14 }, (_, i) => ({ role: i % 2 ? ("persona" as const) : ("user" as const), text: `Zug ${i}`, ts: "t" }));
    const p = buildRegiePrompt(morgan, turns, null);
    for (const c of morgan.personaDna.concessionConditions) expect(p).toContain(c);
    expect(p).toContain(morgan.personaDna.freigabeRegel!);
    expect(p).toContain("Bisherige Stufe: 0");
    expect(p).not.toContain("Zug 0");
    expect(p).toContain("Zug 13");
    expect(p).not.toContain(morgan.personaDna.hiddenDrivers[0]); // keine Motive, nur Bedingungen
  });

  it("baut die Regie-Notiz als Marker und lässt sie leer, wenn nichts Neues ist", () => {
    const stand: RegieStand = { stufe: 1, erfuellt: ["Anerkennung"], eskaliert: false, notiz: "Du stehst auf Stufe 1.", turn: 3, ts: "t" };
    expect(regieStageNote(morgan, stand)).toBe("[REGIE — nicht Teil des Gesprächs, nie vorlesen: Du stehst auf Stufe 1.]");
    expect(regieStageNote(stone, stand)).toContain("[STAGE NOTE");
    expect(regieStageNote(morgan, { ...stand, notiz: "" })).toBe("");
  });

  it("findet die letzte offene Notiz und schreibt den Verlauf für den Richter", () => {
    const regie: RegieStand[] = [
      { stufe: 1, erfuellt: ["Anerkennung"], eskaliert: false, notiz: "A", turn: 3, ts: "t", delivered: true },
      { stufe: 1, erfuellt: ["Anerkennung"], eskaliert: false, notiz: "", turn: 5, ts: "t" },
      { stufe: 2, erfuellt: ["Anerkennung", "Delegation als Lernziel"], eskaliert: false, notiz: "B", turn: 7, ts: "t" },
    ];
    expect(offeneRegieNotiz(regie)?.notiz).toBe("B");
    expect(offeneRegieNotiz(undefined)).toBeNull();
    const text = regieVerlaufText(regie, "de");
    expect(text).toContain("Zug 3: Stufe 1 (Anerkennung)");
    expect(text).toContain("Zug 7: Stufe 2");
    expect(text).not.toContain("Zug 5");
    expect(regieVerlaufText(regie, "en")).toContain("turn 7: level 2");
  });
});
