import { readFileSync, readdirSync } from "fs";
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
  // Nachgeliefertes AC-Material (02.08.2026): Azubi-Peer-Übung, Post-Merger-
  // Teammeeting, Performance-Gespräch + Rollenspieler-Briefings. Regel:
  // Original-Namen ZUERST hierher, dann abwandeln.
  "Redder",
  "FREICAMP",
  "Freicamp",
  "E-Movement",
  "ABACUS",
  "Damis",
  "Amado",
  "Robyn",
  "Tina Anderson",
  "Tim Martin",
  "Näther",
  "Canadian Meat",
  "Stauch",
  "Bierschuppen",
  "Frau König",
  // Rollenspiel AC1 (02.08.2026, Peer-Gespräch Produktlinien/Fuhrpark):
  "Herking",
  "PrimeLube",
  "Mika Wagner",
  "Fliedner",
  "Frau Beck",
  "Lubricants",
  "SolutionConsultants",
  // Employee Appraisal AC2 (02.08.2026, EN High-Performer-Kritikgespräch):
  "Radtke",
  "NoRa",
  "Teuber",
  "Wollner",
  "Bohne",
  "Gerber",
  "Arno Müller",
  "Rudolf",
  "Plant Super",
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
  it("Lerntreppe mit zwei Spuren: jede Stufe 1–3 hat beide Gesprächstypen", () => {
    expect(SIMULATION_SCENARIOS).toHaveLength(8);
    expect(SIMULATION_SCENARIOS.map((s) => s.difficulty).sort()).toEqual([1, 1, 2, 2, 3, 3, 3, 3]);
    for (const stufe of [1, 2, 3]) {
      const types = new Set(
        SIMULATION_SCENARIOS.filter((s) => s.difficulty === stufe).map(
          (s) => s.conversationType,
        ),
      );
      expect(types.has("mitarbeitergespräch")).toBe(true);
      expect(types.has("kollegengespräch")).toBe(true);
    }
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
    expect(publicScenarios()).toHaveLength(SIMULATION_SCENARIOS.length);
  });

  it("getScenario findet per id und liefert null für Unbekanntes", () => {
    expect(getScenario("sim-peer-lang")?.persona.name).toBe("Viktor Lang");
    expect(getScenario("nope")).toBeNull();
  });

  it("reicht category + competencyFocus durch (W1, §2.1/§2.2) — DNA bleibt draußen", () => {
    for (const s of SIMULATION_SCENARIOS) {
      const pub = publicScenario(s);
      expect(pub.category).toBe(s.category);
      expect(pub.competencyFocus).toEqual(s.competencyFocus);
      expect((pub as unknown as Record<string, unknown>).personaDna).toBeUndefined();
    }
  });
});

describe("Szenario-Kategorien + Kompetenz-Fokus (§2.1/§2.2)", () => {
  const VALID_CATEGORIES = [
    "mitarbeiterfuehrung",
    "zusammenarbeit",
    "vertrieb",
    "stakeholder",
  ] as const;

  it("jedes Szenario hat eine gültige Kategorie, 1:1 aus conversationType", () => {
    for (const s of SIMULATION_SCENARIOS) {
      expect(VALID_CATEGORIES).toContain(s.category);
      // Bestandszuordnung (Blueprint §2.1): mitarbeitergespräch →
      // mitarbeiterfuehrung, kollegengespräch → zusammenarbeit.
      if (s.conversationType === "mitarbeitergespräch") {
        expect(s.category).toBe("mitarbeiterfuehrung");
      } else {
        expect(s.category).toBe("zusammenarbeit");
      }
    }
  });

  it("competencyFocus: 1–3 gültige C-Keys je Szenario (E3-Provisorium)", () => {
    for (const s of SIMULATION_SCENARIOS) {
      const focus = s.competencyFocus ?? [];
      expect(focus.length).toBeGreaterThanOrEqual(1);
      expect(focus.length).toBeLessThanOrEqual(3);
      for (const c of focus) {
        expect(c).toMatch(/^C(10|[1-9])$/);
      }
    }
  });

  it("jede Kategorie-Konstante hat ein i18n-Label in allen Dictionaries", () => {
    const dictDir = join(__dirname, "..", "..", "i18n", "dictionaries");
    const catKey: Record<(typeof VALID_CATEGORIES)[number], string> = {
      mitarbeiterfuehrung: "catMitarbeiterfuehrung",
      zusammenarbeit: "catZusammenarbeit",
      vertrieb: "catVertrieb",
      stakeholder: "catStakeholder",
    };
    const files = readdirSync(dictDir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(22);
    for (const f of files) {
      const dict = JSON.parse(readFileSync(join(dictDir, f), "utf8"));
      for (const cat of VALID_CATEGORIES) {
        const label = dict?.entry?.[catKey[cat]];
        expect(typeof label, `${f}: entry.${catKey[cat]}`).toBe("string");
        expect(String(label).length).toBeGreaterThan(0);
      }
    }
  });
});
