import { describe, expect, it } from 'vitest';
import { buildScenarioGeneratorPrompt, parseDraftJson } from './scenario-generator';

describe('scenario-generator (B3b, pure Teile)', () => {
  const base = { brief: 'HR-Leiterin zögert beim Kauf.', id: 'ws-hr-pitch' };

  it('verankert Ziel-Id, Autorenregeln und Stil-Vorlagen im Meta-Prompt', () => {
    const p = buildScenarioGeneratorPrompt(base);
    expect(p).toContain('exakt "ws-hr-pitch"');
    expect(p).toContain('GENAU 3 Ziele');
    expect(p).toContain('Schreibe den Einwand, NIE die erwartete Antwort');
    // Stil-Vorlagen sind eingebettet (DNA sichtbar — Betreiber-Werkzeug, kein Client).
    expect(p).toContain('sim-coaching-morgan');
    expect(p).toContain('hiddenDrivers');
  });

  it('reicht Kunden-Material und Retry-Fehlerliste durch', () => {
    const p = buildScenarioGeneratorPrompt({
      ...base,
      sourceDocument: 'Preisliste: Paket L 12.000 €/Jahr',
      previousIssues: '- goals: Array must contain exactly 3 element(s)',
    });
    expect(p).toContain('Preisliste: Paket L');
    expect(p).toContain('SCHEITERTE AN DIESEN SCHEMA-FEHLERN');
    expect(p).toContain('exactly 3');
  });

  it('parseDraftJson toleriert Markdown-Zäune', () => {
    expect(parseDraftJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseDraftJson('{"a":1}')).toEqual({ a: 1 });
    expect(() => parseDraftJson('kein json')).toThrow();
  });
});
