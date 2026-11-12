import { describe, expect, it } from 'vitest';
import { faehigkeit } from './faehigkeiten';
import { messlatte } from './messlatte';

describe('messlatte (S11)', () => {
  const ursache = faehigkeit('ursache')!;

  it('zeigt die erreichte und die nächste Stufe aus der Bibliothek', () => {
    const m = messlatte('ursache', 2, 'de');
    expect(m).toEqual({ stufe: 2, deine: ursache.stufen[1].de, naechste: ursache.stufen[2].de });
  });

  it('auf der höchsten Stufe gibt es keine nächste', () => {
    const m = messlatte('ursache', 4, 'de');
    expect(m?.deine).toBe(ursache.stufen[3].de);
    expect(m?.naechste).toBeNull();
  });

  it('nimmt die Gesprächssprache (auch „en-GB“) und rundet krumme Werte in die Skala', () => {
    expect(messlatte('ursache', 3, 'en-GB')?.deine).toBe(ursache.stufen[2].en);
    expect(messlatte('ursache', 0, 'de')?.stufe).toBe(1);
    expect(messlatte('ursache', 9, 'de')?.stufe).toBe(4);
    expect(messlatte('ursache', 2.6, 'de')?.stufe).toBe(3);
  });

  it('entfällt still: freie Fähigkeit, nicht beobachtbar, Sprache ohne Stufentexte', () => {
    expect(messlatte('eigener-anker', 3, 'de')).toBeNull();
    expect(messlatte('ursache', null, 'de')).toBeNull();
    expect(messlatte('ursache', Number.NaN, 'de')).toBeNull();
    expect(messlatte('ursache', 3, 'fr')).toBeNull();
    expect(messlatte('ursache', 3, null)).toBeNull();
    expect(messlatte(null, 3, 'de')).toBeNull();
  });
});
