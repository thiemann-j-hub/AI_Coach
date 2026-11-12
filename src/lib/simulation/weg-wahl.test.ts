import { describe, expect, it } from 'vitest';
import { gemerkterWeg, mikrofonVorhanden, wegBeimFortsetzen, wegVorwahl, type WegLage } from './weg-wahl';

const lage = (teil: Partial<WegLage>): WegLage => ({
  liveAvailable: true,
  liveTon: true,
  mikrofon: true,
  gemerkt: null,
  ...teil,
});

describe('wegVorwahl (Paket 4, U1/S1)', () => {
  it('wählt Sprechen vor, wenn Szenario, Browser und Mikrofon mitspielen', () => {
    expect(wegVorwahl(lage({}))).toEqual({ wahl: true, weg: 'sprechen' });
  });

  it('unbekanntes Mikrofon gilt als vorhanden', () => {
    expect(wegVorwahl(lage({ mikrofon: null }))).toEqual({ wahl: true, weg: 'sprechen' });
  });

  it('ohne Mikrofon ist Schreiben vorgewählt, die Wahl bleibt', () => {
    expect(wegVorwahl(lage({ mikrofon: false }))).toEqual({ wahl: true, weg: 'schreiben' });
    // Auch wenn zuletzt Sprechen gewählt war: ohne Mikrofon kein Sprechen als Vorwahl.
    expect(wegVorwahl(lage({ mikrofon: false, gemerkt: 'sprechen' }))).toEqual({ wahl: true, weg: 'schreiben' });
  });

  it('keine Wahl, wenn das Szenario das Sprachgespräch nicht erlaubt oder der Browser keinen Live-Ton kann', () => {
    expect(wegVorwahl(lage({ liveAvailable: false }))).toEqual({ wahl: false, weg: 'schreiben' });
    expect(wegVorwahl(lage({ liveTon: false }))).toEqual({ wahl: false, weg: 'schreiben' });
    expect(wegVorwahl(lage({ liveAvailable: false, gemerkt: 'sprechen' }))).toEqual({ wahl: false, weg: 'schreiben' });
  });

  it('die letzte eigene Wahl gewinnt', () => {
    expect(wegVorwahl(lage({ gemerkt: 'schreiben' }))).toEqual({ wahl: true, weg: 'schreiben' });
    expect(wegVorwahl(lage({ gemerkt: 'sprechen' }))).toEqual({ wahl: true, weg: 'sprechen' });
  });
});

describe('wegBeimFortsetzen', () => {
  it('Sprechen nur nach eigener Wahl auf diesem Gerät', () => {
    expect(wegBeimFortsetzen(lage({ gemerkt: 'sprechen' }))).toBe('sprechen');
    expect(wegBeimFortsetzen(lage({ gemerkt: null }))).toBe('schreiben');
    expect(wegBeimFortsetzen(lage({ gemerkt: 'schreiben' }))).toBe('schreiben');
  });

  it('nie Sprechen, wo es nicht geht', () => {
    expect(wegBeimFortsetzen(lage({ gemerkt: 'sprechen', liveAvailable: false }))).toBe('schreiben');
    expect(wegBeimFortsetzen(lage({ gemerkt: 'sprechen', liveTon: false }))).toBe('schreiben');
    expect(wegBeimFortsetzen(lage({ gemerkt: 'sprechen', mikrofon: false }))).toBe('schreiben');
  });
});

describe('gemerkterWeg', () => {
  it('kennt nur die zwei Wege', () => {
    expect(gemerkterWeg('sprechen')).toBe('sprechen');
    expect(gemerkterWeg('schreiben')).toBe('schreiben');
    expect(gemerkterWeg('1')).toBeNull();
    expect(gemerkterWeg(null)).toBeNull();
    expect(gemerkterWeg(undefined)).toBeNull();
  });
});

describe('mikrofonVorhanden', () => {
  it('erkennt ein Mikrofon in der Geräteliste', () => {
    expect(mikrofonVorhanden([{ kind: 'videoinput' }, { kind: 'audioinput' }])).toBe(true);
  });

  it('meldet fehlend, wenn die Liste Geräte nennt, aber kein Mikrofon', () => {
    expect(mikrofonVorhanden([{ kind: 'audiooutput' }, { kind: 'videoinput' }])).toBe(false);
  });

  it('leere oder fehlende Liste ist unbekannt', () => {
    expect(mikrofonVorhanden([])).toBeNull();
    expect(mikrofonVorhanden(null)).toBeNull();
    expect(mikrofonVorhanden(undefined)).toBeNull();
  });
});
