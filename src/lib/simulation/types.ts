/**
 * Gesprächssimulation — Typen (SIM-1).
 *
 * Rollen-DNA-Schema, destilliert aus AC-Rollenübungen
 * (pulsenorth-ops/COACH-SIMULATION-BLUEPRINT.md §2). Zwei-Briefing-Architektur:
 * `candidateBriefing` ist client-sichtbar, `personaDna` verlässt NIE den Server
 * (Anti-Leak) — API-Antworten gehen ausschließlich über `PublicSimulationScenario`.
 */

export type SimulationDifficulty = 1 | 2 | 3;

/**
 * Gesprächssprache einer Simulation (Synthesia-Muster, Owner-Vorgabe 04.08.):
 * Der Übende wählt im Briefing, in welcher Sprache die Persona spricht —
 * unabhängig von der Autorensprache des Szenarios (locale bleibt de/en).
 */
export type SimConversationLocale = "de" | "en" | "es" | "fr";

export interface SimObjection {
  /** Situation, in der der Einwand typischerweise fällt. */
  trigger: string;
  /** Der Einwand in Rollensprache. */
  objection: string;
}

export interface SimCheckpoint {
  id: string;
  /** Prüfbarer Moment fürs Feedback ("Hat der Übende Interesse X aufgedeckt?"). */
  description: string;
}

export interface SimRubricCompetency {
  key: string;
  label: string;
}

/** Sichtbarer Teil — entspricht der AC-Teilnehmerinstruktion. */
export interface CandidateBriefing {
  yourRole: string;
  relationship: string;
  incidents: string[];
  /** Optionales Faktenblatt (Kennzahlen etc.), zeilenweise. */
  factSheet?: string[];
  /** Genau 3 Ziele: Beziehung + Struktur + EIN konkretes Anliegen (AC-Muster). */
  goals: string[];
  timeboxMin: number;
  /**
   * Debrief 2.0 (D3, Kontext-Treppe): »So gelingt es« — 3–4 Autoren-Hinweise
   * zur Gesprächsführung. Bewusst öffentlich (Synthesia-Muster »So gehen Sie
   * vor«): Transparenz über die Erwartung ist Teil der Didaktik. KEINE
   * DNA-Interna (hiddenDrivers/concessionConditions bleiben geheim).
   */
  approachHints?: string[];
  /** Ein Satz »Was dich erwartet« — stimmt aufs Gegenüber ein, ohne zu spoilern. */
  expectation?: string;
}

/** Verdeckter Teil — nur System-Prompt, nie im Client. */
export interface PersonaDna {
  name: string;
  role: string;
  background: string;
  selfImage: string;
  publicBehavior: string[];
  /** Wird NIE direkt ausgesprochen, schimmert nur durch. */
  hiddenDrivers: string[];
  /** Was die Rolle FORDERT/ablehnt. */
  positions: string[];
  /** Was sie WIRKLICH braucht. */
  interests: string[];
  objectionPlaybook: SimObjection[];
  /** Wendepunkte: NUR dann wird die Rolle kooperativer. */
  concessionConditions: string[];
  escalationTriggers: string[];
  personality: { tone: string; quirks: string[] };
  /** Anti-Halluzination: was die Rolle weiß/nicht weiß. */
  knowledgeBounds: string[];
  /** Harte Faktenanker — konsistent halten, nie neu erfinden. */
  facts: string[];
  /** Erster Satz der Rolle beim Gesprächseinstieg. */
  openingLine: string;
}

export interface SimulationAssessment {
  competencies: SimRubricCompetency[];
  checkpoints: SimCheckpoint[];
  /**
   * Bestehensgrenze 0–1 für den deterministischen Gesamtscore (Debrief 2.0);
   * ohne Angabe gilt DEFAULT_PASS_THRESHOLD (0.6) aus debrief.ts.
   */
  passThreshold?: number;
}

export interface SimulationScenario {
  id: string;
  title: string;
  teaser: string;
  conversationType: string;
  difficulty: SimulationDifficulty;
  durationMin: number;
  /** V1: Szenario-Inhalte bewusst Deutsch (Materialtreue); UI-Chrome ist ×7 lokalisiert. */
  locale: "de" | "en";
  /** Öffentliche Persona-Angaben (Name/Rolle stehen auch im Briefing). */
  persona: { name: string; role: string };
  candidateBriefing: CandidateBriefing;
  personaDna: PersonaDna;
  assessment: SimulationAssessment;
}

/** Projektion ohne personaDna — das Einzige, was API-Routen ausliefern dürfen. */
export interface PublicSimulationScenario {
  id: string;
  title: string;
  teaser: string;
  conversationType: string;
  difficulty: SimulationDifficulty;
  durationMin: number;
  locale: "de" | "en";
  persona: { name: string; role: string };
  candidateBriefing: CandidateBriefing;
  competencies: SimRubricCompetency[];
}

export interface SimulationTurn {
  role: "user" | "persona";
  text: string;
  ts: string;
}
