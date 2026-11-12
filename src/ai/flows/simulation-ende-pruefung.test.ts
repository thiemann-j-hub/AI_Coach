import { beforeEach, describe, expect, it, vi } from "vitest";

// Keine echte KI: der Aufruf der Spielleitung ist ersetzt (Paket 2, C7).
const h = vi.hoisted(() => ({ generate: vi.fn(), warn: vi.fn() }));
vi.mock("@/ai/genkit", () => ({ ai: { generate: (...a: unknown[]) => h.generate(...a) } }));
vi.mock("@/lib/logger", () => ({ logger: { warn: h.warn, api: vi.fn(), apiError: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { getScenario } from "@/lib/simulation/scenarios";
import { buildEndePruefungPrompt, coachEndePruefungOn, endeAbgelehntNote, pruefeEnde } from "./simulation-ende-pruefung";
import { regieStageNote } from "./simulation-regie";

const morgan = getScenario("sim-coaching-morgan")!;
const stone = getScenario("sim-appraisal-stone")!;

describe("Torwächter — Freigabe ohne Prüfung steht im Protokoll (C7, 12.11.2026)", () => {
  const turns = [
    { role: "user" as const, text: "GEHEIMER NUTZERTEXT: wir machen das so", ts: "t0" },
    { role: "persona" as const, text: "Gut, dann bis Freitag.", ts: "t1" },
  ];
  const ende = { grund: "GEHEIMER GRUND der Rolle", ergebnis: "ziel" as const };
  const ohneNutzertext = () => {
    const zeile = JSON.stringify(h.warn.mock.calls);
    expect(zeile).not.toContain("GEHEIMER NUTZERTEXT");
    expect(zeile).not.toContain("GEHEIMER GRUND");
  };

  beforeEach(() => {
    h.generate.mockReset();
    h.warn.mockReset();
    delete process.env.COACH_ENDE_PRUEFUNG;
  });

  it("Frist: das Ende gilt, und eine Zeile mit Anlass „frist“ steht im Protokoll (ohne Nutzertext)", async () => {
    h.generate.mockReturnValue(new Promise(() => {}));
    expect(await pruefeEnde({ scenario: morgan, turns, ende, timeoutMs: 20 })).toEqual({ erfuellt: true, fehlt: "" });
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(h.warn.mock.calls[0][1]).toEqual({ anlass: "frist", scenarioId: morgan.id, ergebnis: "ziel", turns: 2 });
    ohneNutzertext();
  });

  it("Fehler und leere Antwort: das Ende gilt, Anlass „fehler“ bzw. „leer“", async () => {
    h.generate.mockRejectedValueOnce(new Error("503 overloaded"));
    expect((await pruefeEnde({ scenario: morgan, turns, ende })).erfuellt).toBe(true);
    h.generate.mockResolvedValueOnce({ output: null });
    expect((await pruefeEnde({ scenario: morgan, turns, ende })).erfuellt).toBe(true);
    expect(h.warn.mock.calls.map((c) => c[1].anlass)).toEqual(["fehler", "leer"]);
    ohneNutzertext();
  });

  it("echte Prüfung (erfüllt oder abgelehnt) schreibt keine Zeile", async () => {
    h.generate.mockResolvedValueOnce({ output: { erfuellt: false, fehlt: " ein Termin für den Delegationsplan " } });
    expect(await pruefeEnde({ scenario: morgan, turns, ende })).toEqual({ erfuellt: false, fehlt: "ein Termin für den Delegationsplan" });
    h.generate.mockResolvedValueOnce({ output: { erfuellt: true, fehlt: "egal" } });
    expect(await pruefeEnde({ scenario: morgan, turns, ende })).toEqual({ erfuellt: true, fehlt: "" });
    expect(h.warn).not.toHaveBeenCalled();
  });

  it("ohne Endbedingungen oder mit ausgeschalteter Prüfung läuft kein Aufruf und keine Zeile", async () => {
    const ohne = { ...morgan, personaDna: { ...morgan.personaDna, endbedingungen: undefined } };
    expect((await pruefeEnde({ scenario: ohne, turns, ende })).erfuellt).toBe(true);
    process.env.COACH_ENDE_PRUEFUNG = "off";
    expect((await pruefeEnde({ scenario: morgan, turns, ende })).erfuellt).toBe(true);
    delete process.env.COACH_ENDE_PRUEFUNG;
    expect(h.generate).not.toHaveBeenCalled();
    expect(h.warn).not.toHaveBeenCalled();
  });
});

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
