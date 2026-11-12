import { describe, expect, it } from "vitest";
import { getScenario } from "@/lib/simulation/scenarios";
import type { SimulationScenario } from "@/lib/simulation/types";
import { buildPersonaSystemPrompt, endeAktiv, personaFirmenZusatz } from "./simulation-persona";

describe("buildPersonaSystemPrompt", () => {
  const scenario = getScenario("sim-peer-lang")!;
  const prompt = buildPersonaSystemPrompt(scenario);

  it("enthält alle DNA-Bausteine der Rolle", () => {
    expect(prompt).toContain(scenario.personaDna.name);
    expect(prompt).toContain(scenario.personaDna.selfImage);
    for (const h of scenario.personaDna.hiddenDrivers) expect(prompt).toContain(h);
    for (const o of scenario.personaDna.objectionPlaybook) expect(prompt).toContain(o.objection);
    for (const c of scenario.personaDna.concessionConditions) expect(prompt).toContain(c);
    for (const f of scenario.personaDna.facts) expect(prompt).toContain(f);
  });

  it("verbietet Namens-Platzhalter in der Anrede (Vance-Vorfall 04.08.)", () => {
    // Das Modell erfand »Herr/Frau [Nachname des CEO]«, weil die Anrede
    // ungeregelt war — die Regel muss in JEDEM Persona-Prompt stehen.
    expect(prompt).toContain("kennst den Namen deines Gegenübers NICHT");
    expect(prompt).toContain("NIE Platzhalter");
  });

  it("trägt die Anti-Leak-Regeln", () => {
    expect(prompt).toContain("NIEMALS OFFENLEGEN");
    expect(prompt).toContain("Verrate NIE, dass du eine KI bist");
    expect(prompt).toContain("GESPRÄCHSBEITRAG deines Gegenübers");
    expect(prompt).toContain("NIE aussprechen");
  });

  it("verlangt Gesprächs-Realismus (kurz, kein Markdown)", () => {
    expect(prompt).toContain("2–5 Sätze");
    expect(prompt).toContain("kein Markdown");
  });

  // Welle 2 (30.10.2026): Freigabe-Regel, Endbedingungen, Fairness-Klausel.
  it("trägt Freigabe-Regel, Endbedingungen und Fairness-Klausel", () => {
    expect(prompt).toContain("FREIGABE-REGEL");
    expect(prompt).toContain(scenario.personaDna.freigabeRegel!);
    expect(prompt).toContain("GESPRÄCHSENDE");
    for (const e of scenario.personaDna.endbedingungen!) expect(prompt).toContain(e);
    expect(prompt).toContain("7. FAIRNESS");
    expect(prompt).toContain("nicht unschlagbar");
    expect(endeAktiv(scenario)).toBe(true);
  });

  // Paket 5, U9/S20 (12.11.2026): Zwei von fünf Antworten begannen mit „Sorry, aber“; ein Treffer blieb unhörbar.
  it("verlangt wechselnde Satzanfänge, keine Entschuldigungs-Floskel als Standard und hörbare Treffer", () => {
    const regeln = prompt.split("=== VERHALTENSREGELN ===")[1];
    const regel = (n: number) => regeln.split("\n").find((z) => z.startsWith(`${n}. `))!;
    expect(regel(1)).toContain("Erfüllt dein Gegenüber eine Öffnungs-Bedingung");
    expect(regel(1)).toContain("Regie-Notiz »Bedingung erfüllt«");
    expect(regel(1)).toContain("in EINEM Satz hören");
    expect(regel(1)).toContain("statt nur still nachzugeben");
    expect(regel(2)).toContain("nie zwei Antworten hintereinander mit denselben Wörtern");
    expect(regel(2)).toContain("»Sorry, aber …«");
    expect(regel(2)).toContain("nie dein Standard-Einstieg");
    // Zusätze zu den Regeln 1 und 2, keine neue Regel: Fairness bleibt Regel 7.
    expect(regeln).toContain("7. FAIRNESS");
    expect(regeln).not.toMatch(/^9\. /m);
    // Auch die englisch verfassten Szenarien und die Kunden-Szenarien tragen beide Zusätze.
    for (const s of [getScenario("sim-appraisal-stone")!, { ...scenario, id: "ws-kundengespraech" }]) {
      const p = buildPersonaSystemPrompt(s);
      expect(p).toContain("in EINEM Satz hören");
      expect(p).toContain("nie dein Standard-Einstieg");
    }
  });

  it("englisches Szenario bekommt die englischen Blöcke", () => {
    const en = buildPersonaSystemPrompt(getScenario("sim-appraisal-stone")!);
    expect(en).toContain("RELEASE RULE");
    expect(en).toContain("END OF THE CONVERSATION");
    expect(en).toContain("7. FAIRNESS: You are demanding, not unwinnable.");
  });
});

// Paket 1, S19/C27 (12.11.2026): Die Rolle arbeitete immer „bei NorthBay Foods“, auch beim Kunden und in Kunden- und Privatszenarien.
describe("Firma der Rolle im Prompt (S19/C27)", () => {
  const vorstellung = (s: SimulationScenario) => buildPersonaSystemPrompt(s).split("\n")[0];
  const lang = getScenario("sim-peer-lang")!;
  const alsKunde = (id: string, firma?: string): SimulationScenario => ({ ...lang, id, persona: { ...lang.persona, ...(firma ? { firma } : {}) } });

  it("eingebaute Rolle im eigenen Haus: die Übungsfirma bleibt", () => {
    expect(personaFirmenZusatz(lang)).toBe(" bei NorthBay Foods");
    expect(vorstellung(lang)).toContain("Du bist Viktor Lang, Werksleiter Kingsport 2 bei NorthBay Foods.");
  });

  it("eingebaute Rollen bei Kunden, Lieferanten und Presse arbeiten nicht mehr bei NorthBay Foods", () => {
    for (const id of ["sim-cold-kessler", "sim-discovery-weber", "sim-complaint-hartmann", "sim-media-vogt", "sim-price-faber", "sim-cold-kessler-freundlich"]) {
      const s = getScenario(id)!;
      expect(s.persona.firma, id).toBeTruthy();
      expect(vorstellung(s), id).not.toContain("NorthBay");
      expect(vorstellung(s), id).toContain(`Du bist ${s.personaDna.name}, ${s.personaDna.role}.`);
    }
  });

  it("Kunden- und Privatszenario ohne Angabe: keine Firma, auch keine erfundene", () => {
    for (const id of ["ws-kundengespraech", "ws-mein-chefgespraech"]) {
      expect(personaFirmenZusatz(alsKunde(id))).toBe("");
      expect(vorstellung(alsKunde(id))).toContain("Du bist Viktor Lang, Werksleiter Kingsport 2.");
      expect(buildPersonaSystemPrompt(alsKunde(id)).split("\n")[0]).not.toContain("NorthBay");
    }
  });

  it("Kundenszenario mit Firma: die Firma aus dem Szenario; steht sie schon in der Rolle, nicht doppelt", () => {
    expect(vorstellung(alsKunde("ws-kundengespraech", "Musterwerke GmbH"))).toContain("Du bist Viktor Lang, Werksleiter Kingsport 2 bei Musterwerke GmbH.");
    expect(personaFirmenZusatz(alsKunde("ws-kundengespraech", "kingsport"))).toBe("");
  });

  it("die Firma liegt nicht in der DNA: die vorbereiteten Spielbücher bleiben gültig", () => {
    for (const s of [getScenario("sim-cold-kessler")!, getScenario("sim-price-faber")!]) {
      expect(s.personaDna).not.toHaveProperty("firma");
    }
  });
});
