import { describe, expect, it } from 'vitest';
import {
  findeZitatStelle,
  markiereZuege,
  textMitSpruengen,
  textStuecke,
  trenneSprecher,
  vergleichsform,
  zitateImText,
} from './zitat-stelle';

const turns = [
  { role: 'persona', text: 'Ich schaffe das schon, ich brauche nur etwas mehr Zeit.' },
  { role: 'user', text: 'Du hast doch sicher zu viel auf dem Tisch, oder?\nWas genau hält Dich davon ab, den Monatsbericht abzugeben?' },
  { role: 'persona', text: 'Ehrlich? Ich habe Sorge, dass er dann nicht stimmt.' },
  { role: 'user', text: 'Verstehe. Laut Plan ist der Bericht seit drei Wochen überfällig – was bräuchtest Du, um sicher zu sein?' },
  { role: 'persona', text: 'Na ja, es ist viel. Aber es ist meins.' },
];
const stelle = (zitat: string, opts?: Parameters<typeof findeZitatStelle>[2]) => {
  const s = findeZitatStelle(zitat, turns, opts);
  return s ? { turn: s.turn, text: turns[s.turn].text.slice(s.start, s.end) } : null;
};

describe('vergleichsform', () => {
  it('lässt Anführungszeichen weg, fasst Leerraum zusammen und merkt sich die Stelle im Original', () => {
    const { norm, map } = vergleichsform('  „Hallo“   Welt\n… Ende ');
    expect(norm).toBe('hallo welt ... ende');
    expect(map[0]).toBe(3); // „H“ steht im Original an Stelle 3
    expect(map.length).toBe(norm.length);
  });
});

describe('trenneSprecher', () => {
  it('erkennt „Teilnehmer:in:“ und den Namen der Rolle', () => {
    expect(trenneSprecher('Teilnehmer:in: „Was hält Dich ab?“')).toEqual({ sprecher: 'Teilnehmer:in', text: '„Was hält Dich ab?“' });
    expect(trenneSprecher('Alex Morgan:»Na ja«')).toEqual({ sprecher: 'Alex Morgan', text: '»Na ja«' });
    expect(trenneSprecher('Was hält Dich ab?').sprecher).toBeNull();
  });
});

describe('findeZitatStelle', () => {
  it('findet ein Zitat mit Sprecher davor und anderen Anführungszeichen', () => {
    expect(stelle('Teilnehmer:in: "Du hast doch sicher zu viel auf dem Tisch, oder?"')).toEqual({
      turn: 1,
      text: 'Du hast doch sicher zu viel auf dem Tisch, oder?',
    });
  });

  it('ist tolerant bei Leerraum, Zeilenumbruch, Groß- und Kleinschreibung', () => {
    expect(stelle('du hast doch  sicher zu viel auf dem tisch, oder? Was genau hält dich davon ab')?.turn).toBe(1);
  });

  it('nimmt ein Satzzeichen am Ende nicht krumm', () => {
    expect(stelle('Teilnehmer:in: „Verstehe. Laut Plan ist der Bericht seit drei Wochen überfällig.“')).toEqual({
      turn: 3,
      text: 'Verstehe. Laut Plan ist der Bericht seit drei Wochen überfällig',
    });
  });

  it('findet ein Zitat mit Auslassung und markiert vom ersten bis zum letzten Bruchstück', () => {
    expect(stelle('Teilnehmer:in: „Laut Plan ist der Bericht … um sicher zu sein?“')).toEqual({
      turn: 3,
      text: 'Laut Plan ist der Bericht seit drei Wochen überfällig – was bräuchtest Du, um sicher zu sein',
    });
  });

  it('ordnet nach dem Sprecher: der Name der Rolle führt zu ihrem Zug', () => {
    const doppelt = [
      { role: 'user', text: 'Es ist viel.' },
      { role: 'persona', text: 'Es ist viel. Aber es ist meins.' },
    ];
    expect(findeZitatStelle('Alex Morgan: „Es ist viel.“', doppelt, { personaName: 'Alex Morgan' })?.turn).toBe(1);
    expect(findeZitatStelle('Teilnehmer:in: „Es ist viel.“', doppelt, { personaName: 'Alex Morgan' })?.turn).toBe(0);
    expect(findeZitatStelle('Es ist viel.', doppelt, { bevorzugt: 'persona' })?.turn).toBe(1);
  });

  it('behält den Doppelpunkt, wenn er zum Satz gehört', () => {
    const t = [{ role: 'user', text: 'Mein Vorschlag: Wir treffen uns am Freitag.' }];
    const s = findeZitatStelle('Mein Vorschlag: Wir treffen uns am Freitag.', t);
    expect(s && t[0].text.slice(s.start, s.end)).toBe('Mein Vorschlag: Wir treffen uns am Freitag.');
  });

  it('trifft nicht mitten im Wort', () => {
    expect(findeZitatStelle('ein', [{ role: 'user', text: 'Das ist meins.' }])).toBeNull();
  });

  it('kein Treffer, leeres Zitat oder kein Gespräch → null', () => {
    expect(stelle('Teilnehmer:in: „Das habe ich nie gesagt.“')).toBeNull();
    expect(stelle('   ')).toBeNull();
    expect(findeZitatStelle('Hallo', null)).toBeNull();
    expect(findeZitatStelle('Hallo', [])).toBeNull();
  });
});

describe('zitateImText', () => {
  it('findet wörtliche Rede im Fließtext', () => {
    const text = 'In dem Moment hast Du „Dann gib einfach den Bericht ab.“ gesagt. Besser: »Welche zwei Aufgaben könntest Du abgeben?«';
    const z = zitateImText(text);
    expect(z.map((x) => x.text)).toEqual(['Dann gib einfach den Bericht ab.', 'Welche zwei Aufgaben könntest Du abgeben?']);
    expect(text.slice(z[0].start, z[0].end)).toBe('„Dann gib einfach den Bericht ab.“');
  });

  it('ohne Anführungszeichen keine Treffer', () => {
    expect(zitateImText('Frag zuerst nach.')).toEqual([]);
  });
});

describe('textMitSpruengen', () => {
  it('macht nur die wörtliche Rede aus dem Gespräch zum Sprungziel', () => {
    const hebel =
      'In dem Moment, als Alex zögerte, hast Du „Du hast doch sicher zu viel auf dem Tisch, oder?“ gesagt. Ein wirksamerer Weg wäre: „Welche zwei Aufgaben könntest Du abgeben?“';
    const st = textMitSpruengen(hebel, turns, 'Alex Morgan');
    expect(st.map((s) => s.text).join('')).toBe(hebel);
    expect(st.filter((s) => s.turn != null)).toEqual([{ text: '„Du hast doch sicher zu viel auf dem Tisch, oder?“', turn: 1 }]);
  });

  it('ohne Treffer oder ohne Gespräch bleibt der Text ein Stück', () => {
    expect(textMitSpruengen('Frag zuerst „Was brauchst Du genau?“', turns)).toEqual([{ text: 'Frag zuerst „Was brauchst Du genau?“', turn: null }]);
    expect(textMitSpruengen('Frag zuerst nach.', null)).toEqual([{ text: 'Frag zuerst nach.', turn: null }]);
    expect(textMitSpruengen('', turns)).toEqual([]);
  });
});

describe('markiereZuege und textStuecke', () => {
  const marken = markiereZuege(
    turns,
    [
      { zitat: 'Teilnehmer:in: „Du hast doch sicher zu viel auf dem Tisch, oder?“', art: 'beleg', hinweis: 'Nachfragen' },
      { zitat: 'Teilnehmer:in: „Was genau hält Dich davon ab“', art: 'beleg', hinweis: 'Nachfragen' },
      { zitat: 'seit drei Wochen', art: 'sachlich', hinweis: 'Im Briefing stehen zwei Wochen.' },
      { zitat: 'Teilnehmer:in: „Laut Plan ist der Bericht seit drei Wochen überfällig“', art: 'beleg', hinweis: 'Konkret bleiben' },
      { zitat: 'Das steht nirgends.', art: 'beleg', hinweis: 'Ohne Treffer' },
    ],
    'Alex Morgan'
  );

  it('liefert je Zug Bereiche und jede Zeile nur einmal', () => {
    expect(marken).toHaveLength(turns.length);
    expect(marken[1].bereiche).toHaveLength(2);
    expect(marken[1].hinweise).toEqual([{ art: 'beleg', text: 'Nachfragen' }]);
    expect(marken[3].hinweise).toEqual([
      { art: 'sachlich', text: 'Im Briefing stehen zwei Wochen.' },
      { art: 'beleg', text: 'Konkret bleiben' },
    ]);
    expect(marken[0].bereiche).toEqual([]);
  });

  it('zerlegt den Text; bei Überlappung gewinnt „sachlich“, und nichts geht verloren', () => {
    const st = textStuecke(turns[3].text, marken[3].bereiche);
    expect(st.map((s) => s.text).join('')).toBe(turns[3].text);
    expect(st.map((s) => [s.art, s.text])).toEqual([
      [null, 'Verstehe. '],
      ['beleg', 'Laut Plan ist der Bericht '],
      ['sachlich', 'seit drei Wochen'],
      ['beleg', ' überfällig'],
      [null, ' – was bräuchtest Du, um sicher zu sein?'],
    ]);
  });

  it('ohne Bereiche bleibt der Text ein Stück', () => {
    expect(textStuecke('Hallo', [])).toEqual([{ text: 'Hallo', art: null }]);
    expect(textStuecke('', [])).toEqual([]);
  });
});
