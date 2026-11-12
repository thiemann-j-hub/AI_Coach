import { describe, expect, it } from "vitest";
import { getScenario } from "./scenarios";
import { buildSpielbuchPrompt, buildSpielbuchSystem, rollenFirma, spielbuchBereinigen, spielbuchBlock, spielbuchPlausibel, SPIELBUCH_MAX_CHARS } from "./spielbuch";
import type { SimulationScenario } from "./types";

const morgan = getScenario("sim-coaching-morgan")!;
const stone = getScenario("sim-appraisal-stone")!;

describe("Spielbuch", () => {
  it("schreibt die Anweisung in der Autorensprache mit allen fünf Abschnitten", () => {
    const de = buildSpielbuchPrompt(morgan);
    for (const t of ["1. SACHKERN", "2. ERWARTETE ZÜGE", "3. FRAGEN AUSSERHALB", "4. ÖFFNUNGSVERLAUF", "5. NIEMALS"]) expect(de).toContain(t);
    expect(de).toContain(morgan.personaDna.name);
    expect(de).toContain(morgan.candidateBriefing.goals[0]);
    expect(buildSpielbuchSystem("de")).toContain("Dramaturg");
    const en = buildSpielbuchPrompt(stone);
    for (const t of ["1. CORE SUBSTANCE", "2. EXPECTED MOVES", "5. NEVER"]) expect(en).toContain(t);
    expect(buildSpielbuchSystem("en")).toContain("dramaturg");
  });

  it("gibt die vertrauliche DNA ins Briefing, nicht die Lernenden-Sicht", () => {
    const p = buildSpielbuchPrompt(morgan);
    expect(p).toContain(morgan.personaDna.hiddenDrivers[0]);
    expect(p).not.toContain(morgan.candidateBriefing.yourRole);
  });

  it("baut den Block mit Rahmen und kappt zu lange Texte", () => {
    const b = spielbuchBlock("Text", "de");
    expect(b).toContain("=== SPIELBUCH");
    expect(b).toContain("=== ENDE SPIELBUCH ===");
    expect(spielbuchBlock("Text", "en")).toContain("=== PLAYBOOK");
    const lang = spielbuchBlock("x".repeat(SPIELBUCH_MAX_CHARS + 500), "de");
    expect(lang.length).toBeLessThan(SPIELBUCH_MAX_CHARS + 400);
  });

  it("prüft Plausibilität über Abschnitte und Länge", () => {
    const gut = ["1. SACHKERN", "2. ERWARTETE ZÜGE DES GEGENÜBERS", "3. FRAGEN AUSSERHALB DES WISSENS", "4. ÖFFNUNGSVERLAUF", "5. NIEMALS"].join("\n" + "a".repeat(400) + "\n");
    expect(spielbuchPlausibel(gut, "de")).toBe(true);
    expect(spielbuchPlausibel("1. SACHKERN kurz", "de")).toBe(false);
    expect(spielbuchPlausibel(gut.replace("5. NIEMALS", "Schluss"), "de")).toBe(true); // vier von fünf reichen
    expect(spielbuchPlausibel(gut.replace("5. NIEMALS", "Schluss").replace("4. ÖFFNUNGSVERLAUF", "Vier"), "de")).toBe(false);
    expect(spielbuchPlausibel(gut.replace(/\n/g, "\n## "), "de")).toBe(true); // Markdown-Rauten stören nicht
  });

  it("entfernt Markdown-Fett und Rauten aus dem Spielbuch", () => {
    expect(spielbuchBereinigen("## 1. SACHKERN\n- **Zahl:** 42")).toBe("1. SACHKERN\n- Zahl: 42");
  });
});

// Paket 5 (12.11.2026), Nachtrag zu S19/C27: Das Spielbuch nannte fest „bei NorthBay Foods“, auch für Rollen bei
// Kunden und für Kunden- und Privatszenarien. Jetzt gilt dieselbe Regel wie im Rollen-Prompt.
describe("Firma der Rolle im Spielbuch", () => {
  const ersteZeile = (s: SimulationScenario) => buildSpielbuchPrompt(s).split("\n")[0];
  const alsKunde = (id: string, firma?: string): SimulationScenario => ({ ...morgan, id, persona: { ...morgan.persona, ...(firma ? { firma } : {}) } });

  it("eingebaute Rolle im eigenen Haus: die Übungsfirma, deutsch und englisch", () => {
    expect(rollenFirma(morgan)).toBe("NorthBay Foods");
    expect(ersteZeile(morgan)).toContain("Alex Morgan, Kundenverantwortliche bei NorthBay Foods.");
    expect(ersteZeile(stone)).toContain(`${stone.personaDna.name}, ${stone.personaDna.role} at NorthBay Foods.`);
  });

  it("eingebaute Rolle beim Kunden: die Firma steht schon in der Rollenbezeichnung, die Übungsfirma fällt weg", () => {
    const kessler = getScenario("sim-cold-kessler")!;
    expect(rollenFirma(kessler)).toBeNull();
    expect(ersteZeile(kessler)).toContain(`${kessler.personaDna.name}, ${kessler.personaDna.role}.`);
    expect(ersteZeile(kessler)).not.toContain("NorthBay");
  });

  it("Kunden- und Privatszenario: keine erfundene Firma; mit Angabe die Firma aus dem Szenario", () => {
    for (const id of ["ws-kundengespraech", "ws-mein-chefgespraech"]) {
      expect(rollenFirma(alsKunde(id))).toBeNull();
      expect(ersteZeile(alsKunde(id))).toContain("Alex Morgan, Kundenverantwortliche.");
    }
    expect(ersteZeile(alsKunde("ws-kundengespraech", "Musterwerk GmbH"))).toContain("Alex Morgan, Kundenverantwortliche bei Musterwerk GmbH.");
  });

  it("der feste Text der Anweisung nennt die Übungsfirma nicht mehr", () => {
    // Alles nach dem Briefing der Rolle ist fester Text der Anweisung (die DNA selbst darf die Übungsfirma nennen).
    for (const [s, marke] of [[morgan, "Schreibe das Spielbuch"], [stone, "Write the playbook"]] as const) {
      const fest = buildSpielbuchPrompt(s).split(marke)[1];
      expect(fest.length).toBeGreaterThan(500);
      expect(fest).not.toContain("NorthBay");
    }
  });
});
