import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  SIMULATION_SCENARIOS,
  SIM_RUBRIC,
  getScenario,
  publicScenario,
  publicScenarios,
} from "./scenarios";

/**
 * Verbots-Test (Owner-Auflage): Das AC-Quellmaterial darf nur ABGEWANDELT
 * verwendet werden — Original-Namen/-Firmen/-Marken dürfen nirgends im
 * Simulations-Modul auftauchen. Maschinell erzwungen statt erinnert.
 */
const FORBIDDEN_ORIGINALS = [
  "Baumann",
  "Foodorest",
  "Canadian Fresh",
  "Halifax",
  "Thunder Bay",
  "Shrimpy",
  "Maremar",
  "Herr Carl",
  "Draak",
  "Brecht",
  "Grey",
  "Bain",
  "Jacobs",
  "Bonamie",
  "SystemSolution",
  "Easy-Error",
];

describe("simulation scenarios — Abwandlungs-Auflage", () => {
  const serialized = JSON.stringify(SIMULATION_SCENARIOS);
  const source = readFileSync(join(__dirname, "scenarios.ts"), "utf8");

  it.each(FORBIDDEN_ORIGINALS)("Original '%s' kommt nicht vor", (name) => {
    expect(serialized).not.toContain(name);
    expect(source).not.toContain(name);
  });
});

describe("simulation scenarios — Schema-Vollständigkeit (Rollen-DNA)", () => {
  it("es gibt genau 3 Szenarien als Lerntreppe (Stufe 1, 2, 3)", () => {
    expect(SIMULATION_SCENARIOS).toHaveLength(3);
    expect(SIMULATION_SCENARIOS.map((s) => s.difficulty).sort()).toEqual([1, 2, 3]);
  });

  it.each(SIMULATION_SCENARIOS.map((s) => [s.id, s] as const))(
    "%s: DNA-Pflichtfelder gefüllt",
    (_id, s) => {
      const dna = s.personaDna;
      expect(dna.name.length).toBeGreaterThan(0);
      expect(dna.background.length).toBeGreaterThan(0);
      expect(dna.selfImage.length).toBeGreaterThan(0);
      expect(dna.openingLine.length).toBeGreaterThan(0);
      for (const arr of [
        dna.publicBehavior,
        dna.hiddenDrivers,
        dna.positions,
        dna.interests,
        dna.objectionPlaybook,
        dna.concessionConditions,
        dna.escalationTriggers,
        dna.knowledgeBounds,
        dna.facts,
        dna.personality.quirks,
      ]) {
        expect(arr.length).toBeGreaterThan(0);
      }
      for (const o of dna.objectionPlaybook) {
        expect(o.trigger.length).toBeGreaterThan(0);
        expect(o.objection.length).toBeGreaterThan(0);
      }
    }
  );

  it.each(SIMULATION_SCENARIOS.map((s) => [s.id, s] as const))(
    "%s: Briefing folgt dem AC-Muster (genau 3 Ziele) + Checkpoints vorhanden",
    (_id, s) => {
      expect(s.candidateBriefing.goals).toHaveLength(3);
      expect(s.candidateBriefing.incidents.length).toBeGreaterThanOrEqual(2);
      expect(s.assessment.checkpoints.length).toBeGreaterThanOrEqual(4);
      expect(s.assessment.competencies).toEqual(SIM_RUBRIC);
      // Persona-Angaben im Public-Teil müssen zur DNA passen (kein Drift).
      expect(s.persona.name).toBe(s.personaDna.name);
    }
  );

  it("Checkpoint-ids sind global eindeutig", () => {
    const ids = SIMULATION_SCENARIOS.flatMap((s) =>
      s.assessment.checkpoints.map((c) => c.id)
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("publicScenario — Anti-Leak", () => {
  it("entfernt personaDna vollständig (kein verdecktes Feld im Serialisat)", () => {
    for (const s of SIMULATION_SCENARIOS) {
      const pub = publicScenario(s);
      const json = JSON.stringify(pub);
      expect((pub as unknown as Record<string, unknown>).personaDna).toBeUndefined();
      expect(json).not.toContain("hiddenDrivers");
      expect(json).not.toContain("objectionPlaybook");
      expect(json).not.toContain("concessionConditions");
      expect(json).not.toContain("openingLine");
      // Stichprobe: verdeckte Motive dürfen nicht als Text durchsickern.
      for (const driver of s.personaDna.hiddenDrivers) {
        expect(json).not.toContain(driver);
      }
    }
    expect(publicScenarios()).toHaveLength(3);
  });

  it("getScenario findet per id und liefert null für Unbekanntes", () => {
    expect(getScenario("sim-peer-lang")?.persona.name).toBe("Viktor Lang");
    expect(getScenario("nope")).toBeNull();
  });
});
