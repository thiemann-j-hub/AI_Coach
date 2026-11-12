import { describe, expect, it } from 'vitest';
import { rolleZustand, type RolleZustandLage } from './sprech-zustand';

const lage = (teil: Partial<RolleZustandLage>): RolleZustandLage => ({
  verbunden: true,
  verbindet: false,
  ton: false,
  denkt: false,
  mikroAn: true,
  ...teil,
});

describe('rolleZustand (Paket 4, S4)', () => {
  it('hört zu, wenn die Verbindung steht und das Mikrofon an ist', () => {
    expect(rolleZustand(lage({}))).toBe('hoert');
  });

  it('spricht, solange Ton der Rolle läuft — auch wenn die Person stumm geschaltet hat', () => {
    expect(rolleZustand(lage({ ton: true }))).toBe('spricht');
    expect(rolleZustand(lage({ ton: true, mikroAn: false }))).toBe('spricht');
  });

  it('spricht noch zu Ende, wenn die Verbindung schon zu ist (Verabschiedung)', () => {
    expect(rolleZustand(lage({ ton: true, verbunden: false }))).toBe('spricht');
  });

  it('denkt nach zwischen dem Ende der Eingabe und dem ersten Ton', () => {
    expect(rolleZustand(lage({ denkt: true }))).toBe('denkt');
    // Der erste Ton löst „denkt nach“ ab.
    expect(rolleZustand(lage({ denkt: true, ton: true }))).toBe('spricht');
  });

  it('denkt nach schon beim Verbinden, wenn die Rolle gleich eröffnet', () => {
    expect(rolleZustand(lage({ verbunden: false, verbindet: true, denkt: true }))).toBe('denkt');
  });

  it('verbindet, solange die Verbindung entsteht und keine Eröffnung ansteht', () => {
    expect(rolleZustand(lage({ verbunden: false, verbindet: true }))).toBe('verbindet');
  });

  it('Mikrofon aus: stumm geschaltet oder nicht verbunden', () => {
    expect(rolleZustand(lage({ mikroAn: false }))).toBe('mikroAus');
    expect(rolleZustand(lage({ verbunden: false }))).toBe('mikroAus');
    // Ein liegengebliebenes „denkt“ ohne Verbindung zählt nicht.
    expect(rolleZustand(lage({ verbunden: false, denkt: true }))).toBe('mikroAus');
  });
});
