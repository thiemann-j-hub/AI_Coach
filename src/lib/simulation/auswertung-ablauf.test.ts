import { describe, expect, it } from 'vitest';
import { abgleichStehtAus, checkinAntworten, reiterAusHash, seitenPhase, wartestand } from './auswertung-ablauf';

describe('seitenPhase', () => {
  it('fertig mit Auswertung → zeigen', () => {
    expect(seitenPhase({ status: 'finished', feedback: { summary: 'x' } })).toBe('ready');
  });
  it('Auftrag läuft → Warteansicht', () => {
    expect(seitenPhase({ status: 'finishing', feedback: null })).toBe('finishing');
  });
  it('offen mit Fehlschlag → Fehleransicht; offen ohne → zum Einstieg', () => {
    expect(seitenPhase({ status: 'active', finishError: { code: 'STALE', at: '2026-11-12T10:00:00Z' } })).toBe('failed');
    expect(seitenPhase({ status: 'active', finishError: null })).toBe('home');
    expect(seitenPhase({ status: 'active' })).toBe('home');
  });
  it('abgebrochen, fertig ohne Auswertung oder nichts → zum Einstieg', () => {
    expect(seitenPhase({ status: 'aborted' })).toBe('home');
    expect(seitenPhase({ status: 'finished', feedback: null })).toBe('home');
    expect(seitenPhase(null)).toBe('home');
  });
});

describe('wartestand', () => {
  const start = '2026-11-12T10:00:00.000Z';
  const t0 = Date.parse(start);

  it('nennt die Restzeit in Fünferschritten und füllt den Balken anteilig', () => {
    expect(wartestand({ startedAt: start, typicalMs: 20_000, now: t0 + 4_000 })).toEqual({ anteil: 0.2, restSekunden: 20 });
    expect(wartestand({ startedAt: start, typicalMs: 20_000, now: t0 + 5_000 })).toEqual({ anteil: 0.25, restSekunden: 15 });
    expect(wartestand({ startedAt: start, typicalMs: 20_000, now: t0 + 19_000 })?.restSekunden).toBe(5);
  });
  it('länger als üblich → „Gleich fertig“, der Balken wird nie voll', () => {
    expect(wartestand({ startedAt: start, typicalMs: 20_000, now: t0 + 20_000 })).toEqual({ anteil: 0.95, restSekunden: null });
    expect(wartestand({ startedAt: start, typicalMs: 20_000, now: t0 + 300_000 })).toEqual({ anteil: 0.95, restSekunden: null });
    expect(wartestand({ startedAt: start, typicalMs: 20_000, now: t0 + 19_900 })?.anteil).toBe(0.95);
  });
  it('eine Uhr vor dem Start zählt als Start', () => {
    expect(wartestand({ startedAt: start, typicalMs: 50_000, now: t0 - 3_000 })).toEqual({ anteil: 0, restSekunden: 50 });
  });
  it('ohne brauchbare Angaben keine Zahl', () => {
    expect(wartestand({ startedAt: null, typicalMs: 20_000, now: t0 })).toBeNull();
    expect(wartestand({ startedAt: 'kaputt', typicalMs: 20_000, now: t0 })).toBeNull();
    expect(wartestand({ startedAt: start, typicalMs: 0, now: t0 })).toBeNull();
    expect(wartestand({ startedAt: start, now: t0 })).toBeNull();
  });
});

describe('reiterAusHash', () => {
  it('liest den Reiter aus der Adresse', () => {
    expect(reiterAusHash('#gespraech')).toBe('gespraech');
    expect(reiterAusHash('#Weiter')).toBe('weiter');
    expect(reiterAusHash('faehigkeiten')).toBe('faehigkeiten');
  });
  it('Unbekanntes oder Leeres → null', () => {
    expect(reiterAusHash('#lernwuensche')).toBeNull();
    expect(reiterAusHash('')).toBeNull();
    expect(reiterAusHash(undefined)).toBeNull();
  });
});

describe('Check-in und Abgleich', () => {
  it('liefert die gegebenen Antworten in der Reihenfolge der Fragen', () => {
    expect(checkinAntworten({ gut: ' Nachgefragt ', anders: 'Früher zum Punkt', skipped: false })).toEqual(['Nachgefragt', 'Früher zum Punkt']);
    expect(checkinAntworten({ gut: null, anders: 'Früher zum Punkt' })).toEqual(['Früher zum Punkt']);
  });
  it('übersprungen, leer oder alter Lauf ohne Feld → keine Antworten', () => {
    expect(checkinAntworten({ gut: 'x', anders: null, skipped: true })).toEqual([]);
    expect(checkinAntworten({ gut: '  ', anders: '' })).toEqual([]);
    expect(checkinAntworten(null)).toEqual([]);
    expect(checkinAntworten(undefined)).toEqual([]);
  });
  it('Abgleich steht aus: Antworten da, Abgleich noch nicht', () => {
    expect(abgleichStehtAus({ gut: 'x', anders: null }, null)).toBe(true);
    expect(abgleichStehtAus({ gut: 'x', anders: null }, { agreement: 'partly', comment: 'c' })).toBe(false);
    expect(abgleichStehtAus({ gut: null, anders: null, skipped: true }, null)).toBe(false);
    expect(abgleichStehtAus(null, null)).toBe(false);
  });
});
