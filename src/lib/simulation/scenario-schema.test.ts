import { describe, expect, it } from 'vitest';
import { validateScenario } from './scenario-schema';
import { SIMULATION_SCENARIOS, publicScenario } from './scenarios';
import type { SimulationScenario } from './types';

/** Minimal-gültiges Kundenszenario als Bauvorlage für die Fälle. */
function baseScenario(): Record<string, unknown> {
  return {
    id: 'ws-test-lieferant',
    title: 'Hart verhandeln — Preisgespräch mit Toni Faber',
    teaser: 'Dein Schlüssellieferant will 12 % Preiserhöhung durchsetzen.',
    conversationType: 'Preisverhandlung',
    difficulty: 2,
    durationMin: 15,
    locale: 'de',
    category: 'vertrieb',
    competencyFocus: ['C2'],
    persona: { name: 'Toni Faber', role: 'Key-Account-Manager' },
    candidateBriefing: {
      yourRole: 'Du bist Einkaufsleitung bei NorthBay Foods.',
      relationship: 'Ihr arbeitet seit Jahren verlässlich zusammen.',
      incidents: ['Ankündigung einer Preiserhöhung von 12 % zum Quartal.'],
      goals: [
        'Die Geschäftsbeziehung erhalten.',
        'Die Verhandlung strukturiert führen.',
        'Eine Erhöhung unter 5 % oder Gegenleistungen vereinbaren.',
      ],
      timeboxMin: 15,
    },
    personaDna: {
      name: 'Toni Faber',
      role: 'Key-Account-Manager',
      background: 'Seit acht Jahren im Vertrieb des Lieferanten, kennt die Branche.',
      selfImage: 'Sieht sich als fairer, aber harter Verhandler.',
      publicBehavior: ['Freundlich im Ton', 'Bleibt bei Zahlen vage'],
      hiddenDrivers: ['Eigene Marge steht intern unter Druck'],
      positions: ['12 % sind nicht verhandelbar'],
      interests: ['Will den Kunden langfristig halten'],
      objectionPlaybook: [
        { trigger: 'nach Rabatt gefragt wird', objection: 'Unsere Rohstoffkosten sind explodiert.' },
        { trigger: 'mit Wettbewerb gedroht wird', objection: 'Ein Wechsel kostet Sie mehr als 12 %.' },
      ],
      concessionConditions: ['Gegenüber bietet Mehrjahresvertrag oder größere Abnahmemengen an'],
      escalationTriggers: ['Drohungen ohne Substanz'],
      personality: { tone: 'verbindlich, zahlenfest', quirks: ['Nutzt gern Vergleiche'] },
      knowledgeBounds: ['Kennt die internen Kalkulationen des Kunden nicht'],
      facts: ['Aktuelles Volumen: 1,2 Mio. € pro Jahr'],
      openingLine: 'Schön, dass wir sprechen — Sie haben meine Ankündigung ja gesehen.',
    },
    assessment: {
      competencies: [
        { key: 'S1', label: 'Gesprächsstruktur', weight: 2, rubric: 'Agenda und Ziel früh benannt?' },
        { key: 'S3', label: 'Interessen erkunden' },
        { key: 'S5', label: 'Verbindliche Vereinbarungen', weight: 3 },
      ],
      checkpoints: [
        { id: 'ws-test-agenda', description: 'Agenda zu Beginn vereinbart' },
        { id: 'ws-test-interessen', description: 'Interesse hinter den 12 % erfragt' },
        { id: 'ws-test-abschluss', description: 'Konkreter nächster Schritt vereinbart' },
      ],
      checkPassThreshold: 0.75,
    },
  };
}

describe('scenario-schema (B3a)', () => {
  it('akzeptiert ein vollständiges Kundenszenario', () => {
    const s = validateScenario(baseScenario());
    expect(s.id).toBe('ws-test-lieferant');
    expect(s.assessment.competencies[0].weight).toBe(2);
  });

  it('erzwingt das ws--Präfix (keine Kollision mit sim-…)', () => {
    const bad = { ...baseScenario(), id: 'sim-coaching-morgan' };
    expect(() => validateScenario(bad)).toThrow(/ws-<kebab-case>/);
  });

  it('erzwingt GENAU 3 Ziele (AC-Muster)', () => {
    const bad = baseScenario() as { candidateBriefing: { goals: string[] } };
    bad.candidateBriefing.goals = ['nur eines'];
    expect(() => validateScenario(bad)).toThrow(/goals/);
  });

  it('lehnt Situations-Marker im Background ab (Synthesia-Autorenregel)', () => {
    const bad = baseScenario() as { personaDna: { background: string } };
    bad.personaDna.background = 'Er hat heute Morgen die Preiserhöhung angekündigt.';
    expect(() => validateScenario(bad)).toThrow(/Situations-Marker/);
  });

  it('verlangt Auslöser zu jedem Einwand', () => {
    const bad = baseScenario() as {
      personaDna: { objectionPlaybook: Array<Record<string, string>> };
    };
    bad.personaDna.objectionPlaybook = [{ objection: 'Zu teuer.' } as Record<string, string>];
    expect(() => validateScenario(bad)).toThrow(/trigger|objectionPlaybook/);
  });

  it('verlangt Namensgleichheit persona ↔ DNA', () => {
    const bad = baseScenario() as { persona: { name: string; role: string } };
    bad.persona = { name: 'Anders Name', role: 'Key-Account-Manager' };
    expect(() => validateScenario(bad)).toThrow(/übereinstimmen/);
  });

  it('lehnt doppelte Anker-Keys ab', () => {
    const bad = baseScenario() as {
      assessment: { competencies: Array<{ key: string; label: string }> };
    };
    bad.assessment.competencies = [
      { key: 'S1', label: 'A' },
      { key: 'S1', label: 'B' },
    ];
    expect(() => validateScenario(bad)).toThrow(/eindeutig/);
  });

  it('Anti-Leak: publicScenario eines Kundenszenarios enthält keine DNA', () => {
    const s = validateScenario(baseScenario());
    const pub = publicScenario(s as SimulationScenario);
    const json = JSON.stringify(pub);
    expect(json).not.toContain('hiddenDrivers');
    expect(json).not.toContain('Marge steht intern');
    expect(json).not.toContain('objection');
    expect(json).not.toContain('openingLine');
  });

  it('alle 8 eingebauten Szenarien passieren die Kernschemata (ohne id-Regel)', () => {
    // Eingebaute ids nutzen das sim--Präfix — geprüft wird hier der Rest des
    // Vertrags: Briefing, DNA, Assessment (Regressionsschutz für Autoren).
    for (const s of SIMULATION_SCENARIOS) {
      const candidate = { ...s, id: `ws-${s.id}` };
      expect(() => validateScenario(candidate), s.id).not.toThrow();
    }
  });
});
