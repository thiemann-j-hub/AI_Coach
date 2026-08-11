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

/**
 * Faktenblatt-Visualisierung (Owner-Vorgabe 04.08.: »ansprechend
 * visualisieren — beschriftete Grafik«). Autoren-strukturiert, damit der
 * Client beschriftete Mini-Grafiken statt Monospace-Zeilen rendert.
 */
export type FactVisual =
  | {
      kind: "trend";
      title: string;
      /** Einheiten-Suffix an den Wertlabels, z. B. "%". */
      unit?: string;
      note?: string;
      points: Array<{ label: string; value: number; approx?: boolean }>;
    }
  | {
      kind: "bars";
      title: string;
      /** Skala, z. B. 1–4 (min default 0). */
      min?: number;
      max: number;
      unit?: string;
      note?: string;
      items: Array<{ label: string; value: number }>;
    }
  | {
      kind: "kpis";
      title: string;
      note?: string;
      items: Array<{ label: string; value: string; sub?: string }>;
    };

/** Sichtbarer Teil — entspricht der AC-Teilnehmerinstruktion. */
export interface CandidateBriefing {
  yourRole: string;
  relationship: string;
  incidents: string[];
  /** Optionales Faktenblatt (Kennzahlen etc.), zeilenweise. */
  factSheet?: string[];
  /** Beschriftete Grafiken zum Faktenblatt — ersetzen die Zeilenliste im UI. */
  factVisuals?: FactVisual[];
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

/**
 * Wirkungsrichtung des Szenarios (COACH-UX-BLUEPRINT §2.1, Owner 11.08.).
 * Vier feste Kategorien; die Einstiegs-Filterzeile blendet leere aus —
 * `vertrieb`/`stakeholder` warten auf Content, sind aber ab Tag 1 im Vertrag.
 */
export type ScenarioCategory =
  | "mitarbeiterfuehrung"
  | "zusammenarbeit"
  | "vertrieb"
  | "stakeholder";

export const SCENARIO_CATEGORIES: ScenarioCategory[] = [
  "mitarbeiterfuehrung",
  "zusammenarbeit",
  "vertrieb",
  "stakeholder",
];

/** Plattform-Kompetenz-Keys (C1–C10) — nur Sortier-Metadatum, kein Prompt-Einfluss. */
export type CompetencyKey =
  | "C1" | "C2" | "C3" | "C4" | "C5"
  | "C6" | "C7" | "C8" | "C9" | "C10";

export interface SimulationScenario {
  id: string;
  title: string;
  teaser: string;
  conversationType: string;
  difficulty: SimulationDifficulty;
  durationMin: number;
  /** V1: Szenario-Inhalte bewusst Deutsch (Materialtreue); UI-Chrome ist ×7 lokalisiert. */
  locale: "de" | "en";
  /** Wirkungsrichtung fürs Einstiegs-Raster (Blueprint §2.1). */
  category: ScenarioCategory;
  /**
   * Welche C-Kompetenzen dieses Szenario primär trainiert (1–3 Einträge).
   * PROVISORISCH aus goals/checkpoints abgeleitet (Blueprint §2.2, E3):
   * falsche Werte verschlechtern nur die Empfehlungs-Sortierung, nie Daten.
   */
  competencyFocus?: CompetencyKey[];
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
  category: ScenarioCategory;
  competencyFocus?: CompetencyKey[];
  persona: { name: string; role: string };
  candidateBriefing: CandidateBriefing;
  competencies: SimRubricCompetency[];
}

export interface SimulationTurn {
  role: "user" | "persona";
  text: string;
  ts: string;
}
