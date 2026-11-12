import { describe, expect, it } from 'vitest';
import {
  CHECKIN_AUTO_WEITER_MS,
  CHECKIN_MAX_CHARS,
  checkinAutoWeiterIn,
  checkinSchritt,
  checkinStart,
} from './checkin-ablauf';

/** Paket 3, S8 (12.11.2026): zwei Fragen nacheinander, kein Nachhaken, Überspringen jederzeit, 20-Sekunden-Regel. */
describe('checkinSchritt', () => {
  it('beginnt mit der Frage „gut gelungen“ und geht mit „Weiter“ zur Frage „anders machen“', () => {
    const start = checkinStart();
    expect(start).toEqual({ frage: 'gut', gut: null, anders: null });
    expect(checkinSchritt(start, { art: 'weiter', text: '  Ich habe ruhig nachgefragt.  ' })).toEqual({
      fertig: false,
      stand: { frage: 'anders', gut: 'Ich habe ruhig nachgefragt.', anders: null },
    });
  });

  it('nach der zweiten Frage ist der Check-in fertig: beide Antworten gehen an den Server', () => {
    const nachEins = checkinSchritt(checkinStart(), { art: 'weiter', text: 'Ruhig geblieben' });
    if (nachEins.fertig) throw new Error('erwartet: zweite Frage');
    expect(checkinSchritt(nachEins.stand, { art: 'weiter', text: 'Früher das Ziel nennen' })).toEqual({
      fertig: true,
      body: { gut: 'Ruhig geblieben', anders: 'Früher das Ziel nennen' },
    });
  });

  it('kein Nachhaken: ein leeres Feld geht ohne Antwort weiter (auch nach der Frist)', () => {
    const nachEins = checkinSchritt(checkinStart(), { art: 'weiter', text: '   ' });
    expect(nachEins).toEqual({ fertig: false, stand: { frage: 'anders', gut: null, anders: null } });
    if (nachEins.fertig) throw new Error('erwartet: zweite Frage');
    // Nur die zweite Frage beantwortet.
    expect(checkinSchritt(nachEins.stand, { art: 'weiter', text: 'Mehr fragen' })).toEqual({
      fertig: true,
      body: { anders: 'Mehr fragen' },
    });
    // Beide Felder leer geblieben: gilt als übersprungen.
    expect(checkinSchritt(nachEins.stand, { art: 'weiter', text: '' })).toEqual({ fertig: true, body: { skipped: true } });
  });

  it('„Überspringen“ beendet sofort: bei Frage 1 ohne Antwort, bei Frage 2 mit der schon gegebenen', () => {
    expect(checkinSchritt(checkinStart(), { art: 'ueberspringen' })).toEqual({ fertig: true, body: { skipped: true } });
    const nachEins = checkinSchritt(checkinStart(), { art: 'weiter', text: 'Gut zugehört' });
    if (nachEins.fertig) throw new Error('erwartet: zweite Frage');
    expect(checkinSchritt(nachEins.stand, { art: 'ueberspringen' })).toEqual({ fertig: true, body: { gut: 'Gut zugehört' } });
  });

  it('kürzt je Antwort auf die Obergrenze des Servers', () => {
    const lang = 'a'.repeat(CHECKIN_MAX_CHARS + 50);
    const folge = checkinSchritt(checkinStart(), { art: 'weiter', text: lang });
    if (folge.fertig) throw new Error('erwartet: zweite Frage');
    expect(folge.stand.gut).toHaveLength(CHECKIN_MAX_CHARS);
  });
});

describe('checkinAutoWeiterIn (20-Sekunden-Regel)', () => {
  const basis = { text: '', diktatLaeuft: false, letzteEingabeMs: 1_000_000 };

  it('leeres Feld: nach 20 Sekunden ohne Eingabe geht es weiter', () => {
    expect(CHECKIN_AUTO_WEITER_MS).toBe(20_000);
    expect(checkinAutoWeiterIn({ ...basis, jetztMs: 1_000_000 })).toBe(20_000);
    expect(checkinAutoWeiterIn({ ...basis, jetztMs: 1_012_500 })).toBe(7_500);
    expect(checkinAutoWeiterIn({ ...basis, jetztMs: 1_020_000 })).toBe(0);
    expect(checkinAutoWeiterIn({ ...basis, jetztMs: 1_090_000 })).toBe(0);
  });

  it('die Uhr beginnt bei jeder Eingabe neu', () => {
    // 15 s nach der ersten Anzeige getippt und wieder gelöscht: wieder volle 20 s.
    expect(checkinAutoWeiterIn({ ...basis, letzteEingabeMs: 1_015_000, jetztMs: 1_015_000 })).toBe(20_000);
  });

  it('steht Text im Feld, geht es nie von selbst weiter (Leerzeichen zählen nicht als Text)', () => {
    expect(checkinAutoWeiterIn({ ...basis, text: 'Ich habe', jetztMs: 1_500_000 })).toBeNull();
    expect(checkinAutoWeiterIn({ ...basis, text: '   ', jetztMs: 1_005_000 })).toBe(15_000);
  });

  it('läuft das Diktat, steht die Uhr: der gesprochene Satz kommt erst nach dem Sprechen im Feld an', () => {
    expect(checkinAutoWeiterIn({ ...basis, diktatLaeuft: true, jetztMs: 1_500_000 })).toBeNull();
  });
});
