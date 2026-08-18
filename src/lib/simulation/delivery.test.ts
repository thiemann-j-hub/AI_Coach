import { describe, expect, it } from 'vitest';
import {
  computeDelivery,
  splitSentences,
  MIN_WORDS_FOR_DELIVERY,
} from './delivery';

const userTurn = (text: string) => ({ role: 'user', text });
const personaTurn = (text: string) => ({ role: 'persona', text });

/** Baut genug Material, dass die Bänder greifen (>=30 Wörter, >=3 Sätze). */
const richUser = [
  userTurn(
    'Ich möchte heute mit dir über die Zusammenarbeit sprechen. Mir ist aufgefallen, dass wir Termine unterschiedlich verstehen. Wie siehst du das aus deiner Sicht?'
  ),
  userTurn(
    'Danke für deine Offenheit. Ich schlage vor, dass wir feste Übergabepunkte vereinbaren. Was bräuchtest du dafür von mir?'
  ),
];

describe('splitSentences', () => {
  it('trennt an Satzenden, aber nicht an Abkürzungen', () => {
    const s = splitSentences('Wir brauchen z. B. klare Regeln. Was meinst du? Gut!');
    expect(s).toEqual(['Wir brauchen z. B. klare Regeln.', 'Was meinst du?', 'Gut!']);
  });

  it('lässt leere Segmente weg', () => {
    expect(splitSentences('  ')).toEqual([]);
  });
});

describe('computeDelivery', () => {
  it('bleibt bei zu wenig Material ehrlich auf null', () => {
    const r = computeDelivery([userTurn('Hallo.'), personaTurn('Guten Tag.')], 'de');
    expect(r.userWords).toBeLessThan(MIN_WORDS_FOR_DELIVERY);
    expect(r.talkRatioPct).toBeNull();
    expect(r.talkBand).toBeNull();
    expect(r.softenerBand).toBeNull();
    expect(r.softenerMatches).toEqual([]);
  });

  it('berechnet Redeanteil aus Wortanteilen (Coach-Notizen zählen nicht mit)', () => {
    const r = computeDelivery(
      [...richUser, personaTurn('Verstehe.'), { role: 'coach', text: 'ignorier mich' }],
      'de'
    );
    expect(r.talkRatioPct).not.toBeNull();
    // Nutzer redet hier fast allein → Band "talking".
    expect(r.talkBand).toBe('talking');
    expect(r.personaWords).toBe(1);
  });

  it('findet Weichmacher mit Kontext und zählt Mehrwort-Wendungen einfach', () => {
    const r = computeDelivery(
      [
        ...richUser,
        userTurn('Ich würde sagen, das ist vielleicht irgendwie ein guter Anfang für uns beide.'),
      ],
      'de'
    );
    const phrases = r.softenerMatches.map((m) => m.phrase);
    expect(phrases).toContain('ich würde sagen');
    expect(phrases).toContain('vielleicht');
    expect(phrases).toContain('irgendwie');
    // Kontext macht den Treffer nachvollziehbar (Beleg-Philosophie).
    expect(r.softenerMatches[0].context.length).toBeGreaterThan(0);
    // "würde sagen" steckt in "ich würde sagen" — keine Doppelzählung desselben Vorkommens.
    const saidMatches = phrases.filter((p) => p.includes('sagen'));
    expect(saidMatches).toHaveLength(1);
  });

  it('trifft Weichmacher nur an Wortgrenzen', () => {
    const r = computeDelivery(
      [...richUser, userTurn('Die Haltestelle liegt am Weg — wir halten uns an den Plan, ganz konkret und verbindlich.')],
      'de'
    );
    // "halt" darf nicht in "Haltestelle"/"halten" gezählt werden.
    expect(r.softenerMatches.map((m) => m.phrase)).not.toContain('halt');
  });

  it('erkennt wiederholte Satzanfänge', () => {
    const r = computeDelivery(
      [
        userTurn('Ich denke, das passt für uns beide gut. Ich denke, wir schaffen diese Umstellung zusammen. Ich denke, du siehst die Lage ganz ähnlich. Wir starten dann am Montag morgen gemeinsam durch.'),
      ],
      'de'
    );
    expect(r.openerRepetitionPct).not.toBeNull();
    expect(r.openerRepetitionPct!).toBeGreaterThanOrEqual(50);
    expect(r.openerBand).not.toBe('varied');
  });

  it('nutzt das englische Lexikon bei convoLocale en', () => {
    const r = computeDelivery(
      [
        userTurn('I guess we should maybe talk about the schedule for the coming weeks today. I want us to find a workable solution together as a team. What do you actually need from me right now to make this happen?'),
      ],
      'en'
    );
    const phrases = r.softenerMatches.map((m) => m.phrase);
    expect(phrases).toContain('i guess');
    expect(phrases).toContain('maybe');
  });

  it('liefert eine Median-Satzlänge mit Band', () => {
    const r = computeDelivery(richUser, 'de');
    expect(r.medianSentenceWords).not.toBeNull();
    expect(['short', 'normal', 'long']).toContain(r.sentenceBand);
  });
});
