import { beforeEach, describe, expect, it, vi } from 'vitest';

// Das Modell ist eine Attrappe: kein echter KI-Aufruf.
const modell = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('@/ai/genkit', () => ({ ai: { generate: (...a: unknown[]) => modell.generate(...a) } }));

import { SIMULATION_SCENARIOS, getScenario } from '@/lib/simulation/scenarios';
import type { SimulationScenario } from '@/lib/simulation/types';
import {
  buildScenarioGeneratorPrompt,
  fertigerEntwurf,
  generateScenarioDraft,
  parseDraftJson,
  regelVerstoesse,
  textSprache,
  wunschDauer,
  zielSprache,
} from './scenario-generator';

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
    expect(p).toContain('SCHEITERTE AN DIESEN FEHLERN');
    expect(p).toContain('exactly 3');
  });

  it('parseDraftJson toleriert Markdown-Zäune', () => {
    expect(parseDraftJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseDraftJson('{"a":1}')).toEqual({ a: 1 });
    expect(() => parseDraftJson('kein json')).toThrow();
  });
});

// Paket 5, S15/C39 (12.11.2026): Der Generator liefert in der Sprache des Auftrags, immer mit echten Einwänden,
// nie länger als gewünscht, und unter der vergebenen Id.
describe('scenario-generator: Sprache, Einwände, Dauer, Id (S15, C39)', () => {
  const DEUTSCH = 'Eine Teamleiterin muss ihrem besten Mitarbeiter sagen, dass er die Beförderung nicht bekommt, und will ihn trotzdem halten.';
  const ENGLISCH = 'A team lead has to tell her best engineer that he will not get the promotion, and she wants to keep him on the team.';
  const alsEntwurf = (id: string, basis = 'sim-coaching-morgan'): SimulationScenario => ({ ...getScenario(basis)!, id });
  const auftrag = { brief: DEUTSCH, id: 'ws-befoerderung-abc123' };

  beforeEach(() => modell.generate.mockReset());

  it('erkennt Deutsch und Englisch; zu wenig oder gemischter Text bleibt ohne Urteil', () => {
    expect(textSprache(DEUTSCH)).toBe('de');
    expect(textSprache(ENGLISCH)).toBe('en');
    expect(textSprache('Preisgespräch Lieferant')).toBeNull();
    expect(textSprache('Der Leiter und das Team sind nicht bereit: the lead and the team are not ready')).toBeNull();
  });

  it('die Sprache des Auftrags entscheidet; unklar gilt die gewünschte, sonst Deutsch; Überarbeiten bleibt in der Sprache des Entwurfs', () => {
    expect(zielSprache({ brief: DEUTSCH, locale: 'en' })).toBe('de');
    expect(zielSprache({ brief: ENGLISCH, locale: 'de' })).toBe('en');
    expect(zielSprache({ brief: 'Preisgespräch Lieferant', locale: 'en' })).toBe('en');
    expect(zielSprache({ brief: 'Preisgespräch Lieferant' })).toBe('de');
    expect(zielSprache({ brief: ENGLISCH, previousDraft: alsEntwurf('ws-x-abc') })).toBe('de');
  });

  it('der Prompt verlangt die Sprache des Auftrags, mindestens drei Einwände in den Worten der Rolle und die Dauer', () => {
    const de = buildScenarioGeneratorPrompt(auftrag);
    expect(de).toContain('SPRACHE: Schreibe ALLE Inhalte auf Deutsch');
    expect(de).toContain('locale "de"');
    expect(de).toContain('objectionPlaybook: 3–6 Einträge');
    expect(de).toContain('in IHREN Worten (wörtliche Rede in Ich-Form');
    expect(de).toContain('durationMin 15 (nie länger), checkDurationMin 10');
    const en = buildScenarioGeneratorPrompt({ ...auftrag, brief: ENGLISCH, locale: 'de' });
    expect(en).toContain('SPRACHE: Schreibe ALLE Inhalte auf Englisch');
    expect(en).toContain('locale "en"');
  });

  it('Überarbeiten: Kategorie, Stufe und Dauer des bisherigen Entwurfs gelten weiter', () => {
    const alt: SimulationScenario = { ...alsEntwurf('ws-alt-abc123'), category: 'vertrieb', difficulty: 3, durationMin: 12, checkDurationMin: 9 };
    const p = buildScenarioGeneratorPrompt({ brief: 'Titel — Teaser', id: alt.id, previousDraft: alt, reviseNote: 'Die Rolle soll härter verhandeln.' });
    expect(p).toContain('category "vertrieb"; difficulty 3; durationMin 12 (nie länger), checkDurationMin 9');
    expect(wunschDauer({ previousDraft: alt, reviseNote: 'Die Rolle soll härter verhandeln.' })).toEqual({ dauer: 12, pruefung: 9, max: 12 });
    // Nennt der Änderungswunsch selbst eine Dauer, gilt nur noch der Rahmen des Schemas.
    expect(wunschDauer({ previousDraft: alt, reviseNote: 'Bitte 20 Minuten Gespräch.' }).max).toBeNull();
    expect(wunschDauer({})).toEqual({ dauer: 15, pruefung: 10, max: 15 });
    expect(wunschDauer({ privat: true })).toEqual({ dauer: 10, pruefung: 8, max: 10 });
  });

  it('Firma der Rolle: nur aus Auftrag oder Material; privat nie', () => {
    expect(buildScenarioGeneratorPrompt(auftrag)).toContain('13. persona.firma: die Firma, bei der die ROLLE arbeitet (höchstens 80 Zeichen), NUR wenn BRIEF oder MATERIAL sie nennen');
    const privat = buildScenarioGeneratorPrompt({ ...auftrag, privat: true });
    expect(privat).toContain('13. persona.firma: weglassen');
    expect(privat).toContain('14. PRIVATES SZENARIO');
    expect(privat).toContain('durationMin 10 (nie länger), checkDurationMin 8');
  });

  it('alle eingebauten Szenarien bestehen die Regeln (der Wächter schlägt bei guten Szenarien nicht an)', () => {
    for (const s of SIMULATION_SCENARIOS) {
      expect(regelVerstoesse(s, { locale: s.locale, maxDauerMin: s.durationMin }), s.id).toEqual([]);
    }
  });

  it('meldet falsche Sprache, zu wenige oder beschriebene Einwände und zu lange Gespräche', () => {
    const gut = alsEntwurf('ws-gut-abc123');
    const englisch = regelVerstoesse(alsEntwurf('ws-en-abc123', 'sim-appraisal-stone'), { locale: 'de', maxDauerMin: 60 });
    expect(englisch.join('\n')).toContain('candidateBriefing.goals: muss auf Deutsch geschrieben sein');
    expect(englisch.join('\n')).toContain('personaDna.objectionPlaybook/openingLine: muss auf Deutsch geschrieben sein');

    const zwei = { ...gut, personaDna: { ...gut.personaDna, objectionPlaybook: gut.personaDna.objectionPlaybook.slice(0, 2) } };
    expect(regelVerstoesse(zwei, { locale: 'de', maxDauerMin: 15 })).toEqual(['personaDna.objectionPlaybook: mindestens 3 Einwände der Rolle, es sind 2']);

    const vonAussen = { ...gut, personaDna: { ...gut.personaDna, objectionPlaybook: [...gut.personaDna.objectionPlaybook.slice(0, 2), { trigger: 'Delegation', objection: 'Sie wendet ein, dass die Juniors noch nicht so weit sind.' }] } };
    expect(regelVerstoesse(vonAussen, { locale: 'de', maxDauerMin: 15 })[0]).toContain('objectionPlaybook.2.objection: schreibe den Einwand als wörtliche Rede der Rolle');
    // Höfliche Anrede in wörtlicher Rede ist kein Verstoß.
    const siezt = { ...gut, personaDna: { ...gut.personaDna, objectionPlaybook: [...gut.personaDna.objectionPlaybook.slice(0, 2), { trigger: 'Delegation', objection: 'Sie sagen das so leicht, aber wer fängt die Fehler auf?' }] } };
    expect(regelVerstoesse(siezt, { locale: 'de', maxDauerMin: 15 })).toEqual([]);

    expect(regelVerstoesse({ ...gut, durationMin: 30 }, { locale: 'de', maxDauerMin: 15 })).toEqual(['durationMin: 30 ist länger als gewünscht (höchstens 15)']);
    expect(regelVerstoesse({ ...gut, durationMin: 30, checkDurationMin: 20 }, { locale: 'de', maxDauerMin: null })).toEqual([]);
    expect(regelVerstoesse({ ...gut, durationMin: 10, checkDurationMin: 12 }, { locale: 'de', maxDauerMin: 15 })).toEqual(['checkDurationMin: 12 darf nicht länger sein als durationMin (10)']);
  });

  it('Id und Sprache kommen vom Auftrag, nie aus der Modellantwort (C39)', () => {
    const vomModell = { ...alsEntwurf('ws-vom-modell-geaendert'), locale: 'en' };
    const s = fertigerEntwurf(vomModell, auftrag);
    expect(s.id).toBe('ws-befoerderung-abc123');
    expect(s.locale).toBe('de');
    // Auch eine unbrauchbare Id der Modellantwort kostet keinen zweiten Versuch mehr.
    expect(fertigerEntwurf({ ...vomModell, id: 'Kein Muster' }, auftrag).id).toBe('ws-befoerderung-abc123');
    expect(() => fertigerEntwurf('kein Objekt', auftrag)).toThrow(/Szenario ungültig/);
  });

  it('die Firma bleibt nur, wenn Auftrag, Material oder der bisherige Entwurf sie nennen', () => {
    const mit = (firma: string) => ({ ...alsEntwurf('ws-x-abc123'), persona: { ...getScenario('sim-coaching-morgan')!.persona, firma } });
    expect(fertigerEntwurf(mit('Musterwerk GmbH'), { ...auftrag, brief: `${DEUTSCH} Sie arbeitet bei der Musterwerk GmbH.` }).persona.firma).toBe('Musterwerk GmbH');
    expect(fertigerEntwurf(mit('Musterwerk GmbH'), { ...auftrag, sourceDocument: 'Preisliste der Musterwerk GmbH' }).persona.firma).toBe('Musterwerk GmbH');
    // Erfunden oder aus den Vorlagen übernommen: fällt weg.
    expect('firma' in fertigerEntwurf(mit('NorthBay Foods'), auftrag).persona).toBe(false);
    expect('firma' in fertigerEntwurf(mit(''), auftrag).persona).toBe(false);
    // Privat: nie eine Firma, auch wenn der Auftrag eine nennt.
    const kurz = { ...mit('Musterwerk GmbH'), durationMin: 10, checkDurationMin: 8 };
    expect('firma' in fertigerEntwurf(kurz, { ...auftrag, id: 'ws-mein-abcd1234', brief: `${DEUTSCH} Musterwerk GmbH`, privat: true }).persona).toBe(false);
    // Überarbeiten: die Firma des bisherigen Entwurfs bleibt.
    const alt = mit('Musterwerk GmbH');
    expect(fertigerEntwurf(alt, { brief: 'Titel — Teaser', id: alt.id, previousDraft: alt, reviseNote: 'Härter verhandeln.' }).persona.firma).toBe('Musterwerk GmbH');
  });

  it('bei einem Verstoß genau ein zweiter Versuch mit dem Befund; scheitert auch der, ein sauberer Fehler', async () => {
    const gut = alsEntwurf('ws-egal');
    const zwei = { ...gut, personaDna: { ...gut.personaDna, objectionPlaybook: gut.personaDna.objectionPlaybook.slice(0, 2) } };
    modell.generate.mockResolvedValueOnce({ text: JSON.stringify(zwei) }).mockResolvedValueOnce({ text: JSON.stringify(gut) });
    const s = await generateScenarioDraft(auftrag);
    expect(s.id).toBe('ws-befoerderung-abc123');
    expect(modell.generate).toHaveBeenCalledTimes(2);
    const zweiterPrompt = (modell.generate.mock.calls[1][0] as { prompt: string }).prompt;
    expect(zweiterPrompt).toContain('SCHEITERTE AN DIESEN FEHLERN');
    expect(zweiterPrompt).toContain('mindestens 3 Einwände der Rolle, es sind 2');

    modell.generate.mockReset();
    modell.generate.mockResolvedValue({ text: JSON.stringify({ ...gut, durationMin: 30 }) });
    await expect(generateScenarioDraft(auftrag)).rejects.toThrow(/auch im 2\. Versuch ungültig[\s\S]*länger als gewünscht/);
    expect(modell.generate).toHaveBeenCalledTimes(2);
  });

  it('ein guter erster Entwurf braucht keinen zweiten Aufruf', async () => {
    modell.generate.mockResolvedValue({ text: JSON.stringify(alsEntwurf('ws-egal')) });
    await generateScenarioDraft(auftrag);
    expect(modell.generate).toHaveBeenCalledTimes(1);
  });
});
