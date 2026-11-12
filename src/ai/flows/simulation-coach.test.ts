import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Paket 1 (12.11.2026), Coach-Pause. U6: „Seine Überlastung“ bei Alex Morgan (einer Frau) — der Coach bekam nur den
 * Namen. U7: Der Prompt zwang zu „GENAU EINER“ Karte, auch wenn keine zum Gespräch passte. Keine echte KI: der
 * Prompt wird abgefangen (Vorlage und Eingabe), die Kartensuche ist ersetzt.
 */
const h = vi.hoisted(() => ({
  vorlage: "",
  eingaben: [] as Array<Record<string, string>>,
  antwort: { tip: "Frag nach, was sie abgeben könnte.", cardTitle: null as string | null },
  search: vi.fn(),
}));

vi.mock("@/ai/genkit", () => ({
  ai: {
    definePrompt: (cfg: { prompt: string }) => {
      h.vorlage = cfg.prompt;
      return async (input: Record<string, string>) => {
        h.eingaben.push(input);
        return { output: h.antwort };
      };
    },
  },
}));
vi.mock("@/lib/cosmos-cards", () => ({ searchCards: (a: unknown) => h.search(a) }));

import { getScenario } from "@/lib/simulation/scenarios";
import type { SimulationScenario } from "@/lib/simulation/types";
import { personaBezug, personaGeschlecht, runCoachTimeout } from "./simulation-coach";

const morgan = getScenario("sim-coaching-morgan")!;
const lang = getScenario("sim-peer-lang")!;
const turns = [
  { role: "persona" as const, text: "Du wolltest mich sprechen?", ts: "t0" },
  { role: "user" as const, text: "Du machst zu viele Überstunden.", ts: "t1" },
];
const karte = (id: string, title: string) => ({ id, metadata: { title, card_group_id: id, card_type: "checklist", chunk_text: `TITLE: ${title}\n\nWHEN TO USE:\nWenn es passt.\n\nSTEPS:\n1. Schritt.\n` } });

beforeEach(() => {
  h.eingaben.length = 0;
  h.antwort = { tip: "Frag nach, was sie abgeben könnte.", cardTitle: null };
  h.search.mockReset();
  h.search.mockResolvedValue({ results: [] });
});

describe("Coach-Pause: Geschlecht der Rolle (U6)", () => {
  it("leitet das Geschlecht aus der Stimme ab: Live-Stimme zuerst, sonst Vorlesestimme, ohne Stimme unbekannt", () => {
    expect(personaGeschlecht(morgan.persona)).toBe("w");
    expect(personaGeschlecht(lang.persona)).toBe("m");
    expect(personaGeschlecht({ name: "X", role: "Y", voice: "florian-hd", liveVoice: "Aoede" })).toBe("w");
    expect(personaGeschlecht({ name: "X", role: "Y", voice: "emma-hd" })).toBe("w");
    expect(personaGeschlecht({ name: "X", role: "Y" })).toBeNull();
  });

  it("jedes eingebaute Szenario hat ein Geschlecht (keine Rolle ohne Stimme)", async () => {
    const { SIMULATION_SCENARIOS } = await import("@/lib/simulation/scenarios");
    for (const s of SIMULATION_SCENARIOS) expect(personaGeschlecht(s.persona), s.id).not.toBeNull();
  });

  it("sagt dem Coach, mit welchen Pronomen er über die Rolle schreibt", () => {
    expect(personaBezug(morgan)).toContain("Alex Morgan ist eine Frau");
    expect(personaBezug(morgan)).toContain("„sie“, „ihr“, „ihre“");
    expect(personaBezug(lang)).toContain("Viktor Lang ist ein Mann");
    const ohne: SimulationScenario = { ...morgan, persona: { name: "Kim Patel", role: "Junior-Expert" } };
    expect(personaBezug(ohne)).toContain("nicht hinterlegt");
    expect(personaBezug(ohne)).toContain("beim Namen");
  });

  it("der Prompt bekommt den Satz und verbietet großgeschriebene Pronomen der dritten Person; Du/Dein bleibt groß", async () => {
    await runCoachTimeout({ scenario: morgan, turns });
    expect(h.eingaben[0].personaBezug).toContain("Alex Morgan ist eine Frau");
    expect(h.vorlage).toContain("{{{personaBezug}}}");
    expect(h.vorlage).toMatch(/Pronomen der dritten Person \(sie, ihr, ihre, er, ihm, sein, seine …\)[^\n]*\n\s*klein, außer am Satzanfang/);
    expect(h.vorlage).toContain("Groß schreibst du nur die Anrede der/des Übenden (Du, Dir, Dich, Dein)");
  });
});

describe("Coach-Pause: Merkkarte nur, wenn sie passt (U7)", () => {
  it("der Prompt erlaubt „keine Karte“ und verbietet Wörter aus unpassenden Karten", () => {
    expect(h.vorlage).not.toContain("GENAU EINE");
    expect(h.vorlage).toContain("HÖCHSTENS EINE");
    expect(h.vorlage).toContain("Passt keine Karte zum Thema, dann cardTitle = null");
    expect(h.vorlage).toMatch(/Übernimm dann KEINE\s+Wörter, Fachbegriffe oder Formulierungen aus den Karten/);
  });

  it("nennt das Modell keine Karte, kommt der Impuls ohne Karte zurück, obwohl Karten vorlagen", async () => {
    h.search.mockResolvedValue({ results: [karte("c1", "Zielerreichung wird unterschiedlich bewertet: Gespräch sauber kalibrieren")] });
    const r = await runCoachTimeout({ scenario: morgan, turns, question: "Wie komme ich zum Delegieren?" });
    expect(h.eingaben[0].cardsBlock).toContain("kalibrieren");
    expect(r).toEqual({ tip: "Frag nach, was sie abgeben könnte.", card: null });
  });

  it("nennt das Modell eine Karte aus dem Block, kommt sie als Merkkarte zurück; ein erfundener Titel nicht", async () => {
    h.search.mockResolvedValue({ results: [karte("c1", "Delegieren in drei Schritten"), karte("c2", "Redeanteil steuern")] });
    h.antwort = { tip: "Gib eine Aufgabe ab.", cardTitle: "Delegieren in drei Schritten" };
    expect((await runCoachTimeout({ scenario: morgan, turns })).card).toMatchObject({ id: "c1", title: "Delegieren in drei Schritten" });

    h.antwort = { tip: "Gib eine Aufgabe ab.", cardTitle: "Eine Karte, die es nicht gibt" };
    expect((await runCoachTimeout({ scenario: morgan, turns })).card).toBeNull();
  });

  it("ohne Karten in der Bibliothek bleibt der Karten-Block leer", async () => {
    await runCoachTimeout({ scenario: morgan, turns });
    expect(h.eingaben[0].cardsBlock).toBe("");
  });
});
