import { describe, expect, it } from "vitest";
import {
  PAUSE_MAX_GESAMT_MS,
  PAUSE_MAX_JE_PAUSE_MS,
  gespraechsZeitMs,
  laufendePauseMs,
  pauseLaeuft,
  pauseRestMs,
  pauseSetzen,
  pausenMs,
  type ZeitLauf,
} from "./zeit";

/** Paket 4, C13 (12.11.2026): die eine Uhr des Gesprächs, mit Coach-Pausen. */
const T0 = Date.UTC(2026, 10, 12, 9, 0, 0);
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const lauf = (over: Partial<ZeitLauf> = {}): ZeitLauf => ({ createdAt: iso(T0), ...over });

describe("gespraechsZeitMs", () => {
  it("ohne Pause: Zeit seit dem Start (wie bisher)", () => {
    expect(gespraechsZeitMs(lauf(), T0 + 7 * MIN)).toBe(7 * MIN);
    expect(gespraechsZeitMs(lauf({ pausedMs: null, pauseSince: null }), T0 + 7 * MIN)).toBe(7 * MIN);
  });

  it("zieht abgeschlossene Pausen ab", () => {
    expect(gespraechsZeitMs(lauf({ pausedMs: 2 * MIN }), T0 + 7 * MIN)).toBe(5 * MIN);
  });

  it("offene Pause: die Uhr steht", () => {
    const l = lauf({ pauseSince: iso(T0 + 4 * MIN) });
    expect(gespraechsZeitMs(l, T0 + 4 * MIN)).toBe(4 * MIN);
    expect(gespraechsZeitMs(l, T0 + 6 * MIN)).toBe(4 * MIN);
    expect(gespraechsZeitMs(l, T0 + 9 * MIN)).toBe(4 * MIN);
  });

  it("Deckel je Pause: nach fünf Minuten läuft die Uhr von selbst weiter", () => {
    const l = lauf({ pauseSince: iso(T0 + 4 * MIN) });
    expect(laufendePauseMs(l, T0 + 30 * MIN)).toBe(PAUSE_MAX_JE_PAUSE_MS);
    // 4 Minuten Gespräch, 5 Minuten Pause (gedeckelt), danach 21 Minuten weiter.
    expect(gespraechsZeitMs(l, T0 + 30 * MIN)).toBe(25 * MIN);
  });

  it("Deckel gesamt: höchstens 15 Minuten Pause je Lauf", () => {
    // 13 Minuten sind verbraucht: die laufende Pause hält nur noch 2 Minuten an.
    const l = lauf({ pausedMs: 13 * MIN, pauseSince: iso(T0 + 20 * MIN) });
    expect(laufendePauseMs(l, T0 + 21 * MIN)).toBe(1 * MIN);
    expect(laufendePauseMs(l, T0 + 24 * MIN)).toBe(2 * MIN);
    expect(pausenMs(l, T0 + 40 * MIN)).toBe(PAUSE_MAX_GESAMT_MS);
    // Ein zu großer gespeicherter Wert zählt nie mehr als der Gesamtdeckel.
    expect(gespraechsZeitMs(lauf({ pausedMs: 60 * MIN }), T0 + 40 * MIN)).toBe(25 * MIN);
  });

  it("nie negativ, unlesbare Werte zählen nicht", () => {
    expect(gespraechsZeitMs(lauf(), T0 - 5_000)).toBe(0);
    expect(gespraechsZeitMs({ createdAt: "kaputt" }, T0)).toBe(0);
    expect(gespraechsZeitMs(lauf({ pausedMs: -5, pauseSince: "kaputt" }), T0 + MIN)).toBe(MIN);
    // Eine Pause „in der Zukunft“ (Uhren weichen ab) zieht nichts ab.
    expect(gespraechsZeitMs(lauf({ pauseSince: iso(T0 + 3 * MIN) }), T0 + 2 * MIN)).toBe(2 * MIN);
  });
});

describe("pauseLaeuft und pauseRestMs", () => {
  it("läuft bis zum Deckel, danach nicht mehr (auch wenn pauseSince noch steht)", () => {
    const l = lauf({ pauseSince: iso(T0 + MIN) });
    expect(pauseLaeuft(l, T0 + 2 * MIN)).toBe(true);
    expect(pauseRestMs(l, T0 + 2 * MIN)).toBe(4 * MIN);
    expect(pauseLaeuft(l, T0 + 6 * MIN)).toBe(false);
    expect(pauseRestMs(l, T0 + 6 * MIN)).toBe(0);
    expect(pauseLaeuft(lauf(), T0 + MIN)).toBe(false);
  });

  it("ist der Gesamtdeckel verbraucht, läuft keine Pause mehr", () => {
    const l = lauf({ pausedMs: PAUSE_MAX_GESAMT_MS, pauseSince: iso(T0 + 30 * MIN) });
    expect(pauseLaeuft(l, T0 + 30 * MIN + 1_000)).toBe(false);
    expect(laufendePauseMs(l, T0 + 31 * MIN)).toBe(0);
  });
});

describe("pauseSetzen", () => {
  it("an und aus: die Dauer landet auf pausedMs, pauseSince ist wieder leer", () => {
    const l = lauf();
    expect(pauseSetzen(l, true, T0 + 3 * MIN)).toBe(true);
    expect(l.pauseSince).toBe(iso(T0 + 3 * MIN));
    expect(pauseSetzen(l, false, T0 + 4.5 * MIN)).toBe(true);
    expect(l).toMatchObject({ pausedMs: 1.5 * MIN, pauseSince: null });
    expect(gespraechsZeitMs(l, T0 + 10 * MIN)).toBe(8.5 * MIN);
  });

  it("doppelt an oder doppelt aus ändert nichts (Route und Relais melden beide)", () => {
    const l = lauf();
    pauseSetzen(l, true, T0 + MIN);
    expect(pauseSetzen(l, true, T0 + 2 * MIN)).toBe(false);
    expect(l.pauseSince).toBe(iso(T0 + MIN));
    pauseSetzen(l, false, T0 + 3 * MIN);
    expect(pauseSetzen(l, false, T0 + 4 * MIN)).toBe(false);
    expect(l.pausedMs).toBe(2 * MIN);
  });

  it("aus nach dem Deckel: verbucht werden höchstens fünf Minuten", () => {
    const l = lauf({ pauseSince: iso(T0 + MIN) });
    pauseSetzen(l, false, T0 + 40 * MIN);
    expect(l).toMatchObject({ pausedMs: PAUSE_MAX_JE_PAUSE_MS, pauseSince: null });
  });

  it("an bei abgelaufener alter Pause: die alte wird verbucht, die neue beginnt", () => {
    const l = lauf({ pauseSince: iso(T0 + MIN) });
    expect(pauseSetzen(l, true, T0 + 20 * MIN)).toBe(true);
    expect(l).toMatchObject({ pausedMs: PAUSE_MAX_JE_PAUSE_MS, pauseSince: iso(T0 + 20 * MIN) });
  });

  it("Gesamtdeckel erreicht: keine neue Pause, die Uhr läuft weiter", () => {
    const l = lauf({ pausedMs: PAUSE_MAX_GESAMT_MS });
    expect(pauseSetzen(l, true, T0 + 30 * MIN)).toBe(false);
    expect(l.pauseSince ?? null).toBeNull();
    // Die dritte Pause schöpft den Rest aus und wird dort gedeckelt.
    const m = lauf({ pausedMs: 12 * MIN });
    pauseSetzen(m, true, T0 + 30 * MIN);
    pauseSetzen(m, false, T0 + 34 * MIN);
    expect(m.pausedMs).toBe(PAUSE_MAX_GESAMT_MS);
  });
});
