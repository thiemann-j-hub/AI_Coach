import { beforeEach, describe, expect, it, vi } from "vitest";

// Keine echte KI: der Aufruf des Beobachters ist ersetzt (Paket 1, C14).
const h = vi.hoisted(() => ({ generate: vi.fn(), warn: vi.fn() }));
vi.mock("@/ai/genkit", () => ({ ai: { generate: (...a: unknown[]) => h.generate(...a) } }));
vi.mock("@/lib/logger", () => ({ logger: { warn: h.warn, api: vi.fn(), apiError: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { getScenario } from "@/lib/simulation/scenarios";
import { REGIE_TIMEOUT_MS, beobachteRegie, buildRegiePrompt, halteNotiz, offeneRegieNotiz, regieStageNote, regieVerlaufText, type RegieStand } from "./simulation-regie";

const morgan = getScenario("sim-coaching-morgan")!;
const stone = getScenario("sim-appraisal-stone")!;

describe("Regie-Beobachter: Frist (C14, 12.11.2026)", () => {
  const turns = [
    { role: "persona" as const, text: "Du wolltest mich sprechen?", ts: "t0" },
    { role: "user" as const, text: "GEHEIMER NUTZERTEXT über das Angebot", ts: "t1" },
  ];

  beforeEach(() => {
    h.generate.mockReset();
    h.warn.mockReset();
  });

  it("hängt der Beobachter, kommt nach der Frist null zurück (die Notiz dieses Zugs entfällt), und es steht im Protokoll", async () => {
    h.generate.mockReturnValue(new Promise(() => {}));
    const start = Date.now();
    const stand = await beobachteRegie({ scenario: morgan, turns, bisher: null, timeoutMs: 20 });
    expect(stand).toBeNull();
    expect(Date.now() - start).toBeLessThan(1_000);
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(h.warn.mock.calls[0][1]).toMatchObject({ anlass: "frist", scenarioId: morgan.id, turn: 2 });
    expect(JSON.stringify(h.warn.mock.calls[0])).not.toContain("GEHEIMER NUTZERTEXT");
  });

  it("die Standardfrist liegt zwischen drei und fünf Sekunden", () => {
    expect(REGIE_TIMEOUT_MS).toBeGreaterThanOrEqual(3_000);
    expect(REGIE_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  });

  it("Fehler des Modells: null, mit Protokollzeile ohne Nutzertext", async () => {
    h.generate.mockRejectedValue(new Error("503 overloaded"));
    expect(await beobachteRegie({ scenario: morgan, turns, bisher: null })).toBeNull();
    expect(h.warn.mock.calls[0][1]).toMatchObject({ anlass: "fehler", scenarioId: morgan.id });
    expect(JSON.stringify(h.warn.mock.calls[0])).not.toContain("GEHEIMER NUTZERTEXT");
  });

  it("antwortet der Beobachter in der Frist, kommt der Stand wie bisher (höchstens eine Stufe je Zug)", async () => {
    h.generate.mockResolvedValue({ output: { stufe: 3, erfuellt: ["Anerkennung kam ehrlich"], eskaliert: false, notiz: "Du stehst jetzt auf Stufe 1.", vorschnell: false, fehlt: "nach der Ursache fragen" } });
    const stand = await beobachteRegie({ scenario: morgan, turns, bisher: null, now: () => Date.parse("2026-11-12T08:00:00.000Z") });
    expect(stand).toMatchObject({ stufe: 1, notiz: "Du stehst jetzt auf Stufe 1.", turn: 2, ts: "2026-11-12T08:00:00.000Z", fehlt: "nach der Ursache fragen" });
    expect(h.warn).not.toHaveBeenCalled();
  });

  it("ohne Zug der lernenden Person läuft kein Aufruf", async () => {
    expect(await beobachteRegie({ scenario: morgan, turns: [turns[0]], bisher: null })).toBeNull();
    expect(h.generate).not.toHaveBeenCalled();
  });
});

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

  it("Torwächter: Beobachter prüft vorschnelles Einlenken; Halte-Notiz nennt, was fehlt; Verlauf zeigt es dem Richter", () => {
    expect(buildRegiePrompt(morgan, [], null)).toContain("vorschnell = true");
    const n = halteNotiz(morgan, 0, "nach der Ursache fragen", true);
    expect(n).toContain("Halte deine Position");
    expect(n).toContain("vorschnell eingelenkt");
    expect(n).toContain("Es fehlt: nach der Ursache fragen");
    expect(halteNotiz(stone, 1, "", false)).toContain("Hold your position");
    const regie: RegieStand[] = [{ stufe: 0, erfuellt: [], eskaliert: false, notiz: "", turn: 4, ts: "t", vorschnell: true, fehlt: "x" }];
    expect(regieVerlaufText(regie, "de")).toContain("Zug 4: Stufe 0, Rolle lenkte vorschnell ein");
  });
});
