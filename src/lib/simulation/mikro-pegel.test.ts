import { describe, expect, it } from 'vitest';
import {
  PEGEL_SCHWELLE,
  balkenProzent,
  losErlaubt,
  ohnePegel,
  pegelAusBytes,
  pegelSchritt,
  pegelStart,
  type PegelStand,
} from './mikro-pegel';

const LAUT = PEGEL_SCHWELLE * 4;
const LEISE = PEGEL_SCHWELLE / 4;

/** `ms` Millisekunden lang denselben Pegel, in Schritten von 100 ms (so misst der Mikrofon-Check). */
function laufe(s: PegelStand, pegel: number, ms: number): PegelStand {
  let stand = s;
  for (let t = 0; t < ms; t += 100) stand = pegelSchritt(stand, pegel, 100);
  return stand;
}

describe('pegelSchritt (Paket 4, S2)', () => {
  it('beginnt ohne Pegel: nichts gehört, „Los geht\'s“ noch nicht wählbar', () => {
    const s = pegelStart();
    expect(s.gehoert).toBe(false);
    expect(losErlaubt(s)).toBe(false);
    expect(ohnePegel(s)).toBe(false);
  });

  it('macht „Los geht\'s“ wählbar, sobald ein Pegel da war', () => {
    const s = pegelSchritt(pegelStart(), LAUT, 100);
    expect(s.pegelDa).toBe(true);
    expect(losErlaubt(s)).toBe(true);
    expect(s.gehoert).toBe(false);
  });

  it('sagt „Ich höre Dich“ nach zwei Sekunden über der Schwelle', () => {
    expect(laufe(pegelStart(), LAUT, 1900).gehoert).toBe(false);
    expect(laufe(pegelStart(), LAUT, 2000).gehoert).toBe(true);
  });

  it('kurze Sprechpausen unterbrechen die Zählung nicht', () => {
    let s = laufe(pegelStart(), LAUT, 1200);
    s = laufe(s, LEISE, 600);
    s = laufe(s, LAUT, 800);
    expect(s.gehoert).toBe(true);
  });

  it('eine lange Stille setzt die Zählung zurück (einzelne Geräusche sind kein Sprechen)', () => {
    let s = laufe(pegelStart(), LAUT, 1500);
    s = laufe(s, LEISE, 1500);
    expect(s.ueberMs).toBe(0);
    s = laufe(s, LAUT, 1500);
    expect(s.gehoert).toBe(false);
    // „Ein Pegel war da“ bleibt: Der Knopf wird nicht wieder gesperrt.
    expect(losErlaubt(s)).toBe(true);
  });

  it('„Ich höre Dich“ bleibt stehen, auch wenn es danach still ist', () => {
    let s = laufe(pegelStart(), LAUT, 2000);
    s = laufe(s, 0, 5000);
    expect(s.gehoert).toBe(true);
  });

  it('nach acht Sekunden ohne Pegel ist „Los geht\'s“ trotzdem wählbar, mit Hinweis', () => {
    const vorher = laufe(pegelStart(), 0, 7900);
    expect(losErlaubt(vorher)).toBe(false);
    expect(ohnePegel(vorher)).toBe(false);
    const danach = laufe(pegelStart(), LEISE, 8000);
    expect(losErlaubt(danach)).toBe(true);
    expect(ohnePegel(danach)).toBe(true);
    expect(danach.gehoert).toBe(false);
  });

  it('kein Hinweis „Ich höre noch nichts“, wenn ein Pegel da war', () => {
    let s = pegelSchritt(pegelStart(), LAUT, 100);
    s = laufe(s, 0, 9000);
    expect(ohnePegel(s)).toBe(false);
  });

  it('verträgt unbrauchbare Messwerte', () => {
    const s = pegelSchritt(pegelSchritt(pegelStart(), Number.NaN, 100), LAUT, Number.NaN);
    expect(s.laeuftMs).toBe(100);
    expect(s.gehoert).toBe(false);
  });
});

describe('pegelAusBytes', () => {
  it('Ruhe (alle Bytes 128) ergibt 0', () => {
    expect(pegelAusBytes(new Uint8Array(256).fill(128))).toBe(0);
  });

  it('Vollausschlag ergibt rund 1', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 2 ? 255 : 0;
    expect(pegelAusBytes(bytes)).toBeGreaterThan(0.99);
  });

  it('ein leiser Ton liegt unter, ein Sprechpegel über der Schwelle', () => {
    const ton = (ausschlag: number) => Uint8Array.from({ length: 512 }, (_, i) => 128 + Math.round(Math.sin(i / 4) * ausschlag));
    expect(pegelAusBytes(ton(1))).toBeLessThan(PEGEL_SCHWELLE);
    expect(pegelAusBytes(ton(12))).toBeGreaterThan(PEGEL_SCHWELLE);
  });

  it('leere Messung ergibt 0', () => {
    expect(pegelAusBytes([])).toBe(0);
  });
});

describe('balkenProzent', () => {
  it('bleibt zwischen 0 und 100', () => {
    expect(balkenProzent(0)).toBe(0);
    expect(balkenProzent(-1)).toBe(0);
    expect(balkenProzent(Number.NaN)).toBe(0);
    expect(balkenProzent(5)).toBe(100);
  });

  it('füllt den Balken bei normalem Sprechen sichtbar', () => {
    expect(balkenProzent(0.06)).toBeGreaterThan(40);
    expect(balkenProzent(0.06)).toBeLessThan(100);
    expect(balkenProzent(0.2)).toBeGreaterThan(balkenProzent(0.06));
  });
});
