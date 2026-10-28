import { describe, expect, it } from "vitest";
import { getScenario } from "./scenarios";
import { buildSpielbuchPrompt, buildSpielbuchSystem, spielbuchBereinigen, spielbuchBlock, spielbuchPlausibel, SPIELBUCH_MAX_CHARS } from "./spielbuch";

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
