import { describe, it, expect } from 'vitest';
import { detectSpeakers, cleanTeamsTranscript } from './transcript-utils';

/**
 * Regressions-Suite zum Live-Testfund 2026-07-17: mehrwortige Sprechernamen
 * ("Anna Müller:") wurden im manuellen Format nie erkannt → Rollen-Dropdown
 * blieb leer → „Analyse starten" war ohne Erklärung tot.
 */
describe('detectSpeakers', () => {
  it('erkennt Ein-Wort-Kürzel (FK:/MA:)', () => {
    const t = 'FK: Guten Morgen.\nMA: Hallo, danke.';
    expect(detectSpeakers(t).sort()).toEqual(['FK', 'MA']);
  });

  it('erkennt mehrwortige Namen im manuellen Format (Live-Testfund)', () => {
    const t = [
      'Anna Müller: Guten Morgen Herr Schmidt.',
      'Thomas Schmidt: Danke, gerne.',
      'Anna Müller: Wie erleben Sie die Arbeitsbelastung?',
    ].join('\n');
    expect(detectSpeakers(t).sort()).toEqual(['Anna Müller', 'Thomas Schmidt']);
  });

  it('erkennt Namen mit Titel/Bindestrich', () => {
    const t = 'Dr. Anna Müller-Schmidt: Willkommen zum Gespräch.\nJan: Danke.';
    expect(detectSpeakers(t)).toContain('Dr. Anna Müller-Schmidt');
  });

  it('erkennt das Teams-Timestamp-Format', () => {
    const t = '00:00:05 Anna Müller: Hallo zusammen.\n00:00:09 Thomas Schmidt: Hallo.';
    expect(detectSpeakers(t).sort()).toEqual(['Anna Müller', 'Thomas Schmidt']);
  });

  it('ignoriert Metadaten-Zeilen (Datum/Dauer)', () => {
    const t = 'Datum: 17.07.2026\nDauer: 30 Minuten\nFK: Los geht es.';
    expect(detectSpeakers(t)).toEqual(['FK']);
  });

  it('matcht keine Fließtext-Phrasen mit kleingeschriebenem Folgewort', () => {
    const t = 'wichtig zu beachten: die Deadline.\nFK: Verstanden.';
    expect(detectSpeakers(t)).toEqual(['FK']);
  });
});

describe('cleanTeamsTranscript', () => {
  it('behält mehrwortige Sprecherzeilen (zerstört manuelle Transkripte nicht)', () => {
    const t = [
      'Seite 1 von 2',
      'Anna Müller: Guten Morgen.',
      'Thomas Schmidt: Hallo.',
    ].join('\n');
    const out = cleanTeamsTranscript(t);
    expect(out).toContain('Anna Müller: Guten Morgen.');
    expect(out).toContain('Thomas Schmidt: Hallo.');
    expect(out).not.toContain('Seite 1 von 2');
  });
});
