import { describe, expect, it } from 'vitest';
import { uhrStand } from './gespraechs-uhr';

const START = '2026-11-12T10:00:00.000Z';
const t0 = Date.parse(START);
const MIN = 60_000;
const LIMIT = 15 * MIN;

describe('uhrStand (Paket 4, C13/U5)', () => {
  it('zeigt die Restzeit ab dem Start', () => {
    const u = uhrStand({ createdAt: START }, LIMIT, t0 + 3 * MIN + 18_000);
    expect(u).toMatchObject({ text: '11:42', restMin: 12, warn: false, um: false, angehalten: false });
  });

  it('keine Uhr ohne Startzeit', () => {
    expect(uhrStand(null, LIMIT, t0)).toBeNull();
    expect(uhrStand({ createdAt: 'kaputt' }, LIMIT, t0)).toBeNull();
  });

  it('zieht abgeschlossene Pausen ab', () => {
    const u = uhrStand({ createdAt: START, pausedMs: 2 * MIN }, LIMIT, t0 + 5 * MIN);
    expect(u?.text).toBe('12:00');
  });

  it('steht in der laufenden Pause und heißt „angehalten“', () => {
    const lauf = { createdAt: START, pausedMs: 0, pauseSince: new Date(t0 + 4 * MIN).toISOString() };
    const anfang = uhrStand(lauf, LIMIT, t0 + 4 * MIN + 1000);
    const spaeter = uhrStand(lauf, LIMIT, t0 + 6 * MIN);
    expect(anfang?.text).toBe('11:00');
    expect(spaeter?.text).toBe('11:00');
    expect(spaeter?.angehalten).toBe(true);
  });

  it('läuft nach dem Deckel einer Pause (fünf Minuten) von selbst weiter', () => {
    const lauf = { createdAt: START, pauseSince: new Date(t0 + 1 * MIN).toISOString() };
    const u = uhrStand(lauf, LIMIT, t0 + 8 * MIN);
    // 8 Minuten vergangen, davon 5 Minuten Pause (Deckel): 3 Minuten Gesprächszeit.
    expect(u?.text).toBe('12:00');
    expect(u?.angehalten).toBe(false);
  });

  it('wird ab 80 % gelb und endet bei 0:00', () => {
    expect(uhrStand({ createdAt: START }, LIMIT, t0 + 12 * MIN)?.warn).toBe(true);
    expect(uhrStand({ createdAt: START }, LIMIT, t0 + 11 * MIN)?.warn).toBe(false);
    const ende = uhrStand({ createdAt: START }, LIMIT, t0 + 20 * MIN);
    expect(ende).toMatchObject({ text: '0:00', restMs: 0, restMin: 0, um: true, angehalten: false });
  });

  it('eine Pause schiebt die Warnung nach hinten', () => {
    const u = uhrStand({ createdAt: START, pausedMs: 3 * MIN }, LIMIT, t0 + 13 * MIN);
    expect(u?.warn).toBe(false);
  });
});
