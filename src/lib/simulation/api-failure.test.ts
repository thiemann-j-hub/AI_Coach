import { describe, expect, it } from 'vitest';
import { DEFAULT_WAIT_SECONDS, decideApiFailure } from './api-failure';

/**
 * Paket 1, C1/C5 (12.11.2026): Jede Fehlerantwort der Rollenspiel-Routen führt zu ihrem eigenen Satz.
 * Die Körper unten sind die Formen, die die Routen wirklich schicken (entitlement.ts, request-id.ts,
 * rate-limit.ts, cost-cap.ts, turn/route.ts).
 */
describe('decideApiFailure', () => {
  it('KI überlastet: eigener Zweig mit Fehler-Nummer, auch bei Status 429, 503 und 504', () => {
    expect(decideApiFailure(429, { ok: false, code: 'AI_ERROR', aiCode: 'throttled', requestId: 'abc23456' })).toEqual({ kind: 'ai' });
    expect(decideApiFailure(503, { code: 'AI_ERROR', aiCode: 'ai_unavailable' })).toEqual({ kind: 'ai' });
    expect(decideApiFailure(504, { code: 'AI_ERROR', aiCode: 'timeout' })).toEqual({ kind: 'ai' });
    expect(decideApiFailure(500, { aiCode: 'ai_general' })).toEqual({ kind: 'ai' });
  });

  it('KI vom Unternehmen ausgeschaltet: Meldung des Servers (der Client schaltet das Mikrofon aus)', () => {
    expect(decideApiFailure(403, { code: 'KI_AUS', error: 'Dein Unternehmen hat die KI-Funktionen ausgeschaltet.' })).toEqual({
      kind: 'kiAus',
      text: 'Dein Unternehmen hat die KI-Funktionen ausgeschaltet.',
    });
    expect(decideApiFailure(403, { code: 'KI_AUS' })).toEqual({ kind: 'kiAus', text: null });
  });

  it('leeres Guthaben: Admin bekommt den Kauf-Link, Mitglied nicht', () => {
    expect(decideApiFailure(402, { code: 'INSUFFICIENT_CREDITS', canTopUp: true, topUpUrl: 'https://hub.example/credits' })).toEqual({
      kind: 'credits',
      text: 'paywall',
      topUpUrl: 'https://hub.example/credits',
    });
    expect(decideApiFailure(402, { code: 'INSUFFICIENT_CREDITS', canTopUp: false, topUpUrl: 'https://hub.example/credits' })).toEqual({
      kind: 'credits',
      text: 'member',
      topUpUrl: null,
    });
  });

  it('leeres Guthaben vor dem Start: anderer Satz als nach dem Rollenspiel', () => {
    expect(decideApiFailure(402, { code: 'INSUFFICIENT_CREDITS', preflight: true, canTopUp: true, topUpUrl: '/x' })).toEqual({
      kind: 'credits',
      text: 'preflightPaywall',
      topUpUrl: '/x',
    });
    // Status 402 genügt auch ohne lesbaren Körper.
    expect(decideApiFailure(402, null)).toEqual({ kind: 'credits', text: 'paywall', topUpUrl: null });
  });

  it('„Zeit um“ und „Rolle hat beendet“ sind keine Fehler, sondern Banner und Karte', () => {
    expect(decideApiFailure(409, { ok: false, code: 'TIME_UP' })).toEqual({ kind: 'timeUp' });
    expect(decideApiFailure(409, { code: 'ENDED', ende: { grund: 'Einigung', ergebnis: 'ziel', at: '2026-11-12T10:00:00.000Z' } })).toEqual({
      kind: 'ended',
      ende: { grund: 'Einigung', ergebnis: 'ziel', at: '2026-11-12T10:00:00.000Z' },
    });
    expect(decideApiFailure(409, { code: 'ENDED' })).toEqual({ kind: 'ended', ende: { grund: '', ergebnis: 'verabschiedung' } });
  });

  it('Szenario fehlt: 410 im Gespräch, 404 beim Start', () => {
    expect(decideApiFailure(410, { code: 'UNKNOWN_SCENARIO' })).toEqual({ kind: 'text', key: 'scenarioGone' });
    expect(decideApiFailure(404, { code: 'UNKNOWN_SCENARIO' })).toEqual({ kind: 'text', key: 'scenarioGone' });
    expect(decideApiFailure(410, null)).toEqual({ kind: 'text', key: 'scenarioGone' });
  });

  it('429 RATE_LIMITED: Warte-Satz mit den Sekunden des Servers, nicht dessen englischer Text', () => {
    expect(
      decideApiFailure(429, { ok: false, error: 'Too many requests. Please try again later.', code: 'RATE_LIMITED', retryAfterSeconds: 42 })
    ).toEqual({ kind: 'wait', seconds: 42 });
    // Sekunden nur in der Kopfzeile (z. B. vom Proxy), sonst der Standardwert.
    expect(decideApiFailure(429, null, '17')).toEqual({ kind: 'wait', seconds: 17 });
    expect(decideApiFailure(429, { code: 'RATE_LIMITED' })).toEqual({ kind: 'wait', seconds: DEFAULT_WAIT_SECONDS });
    expect(decideApiFailure(429, { code: 'RATE_LIMITED', retryAfterSeconds: 0.2 })).toEqual({ kind: 'wait', seconds: 1 });
  });

  it('429 mit eigenem Satz des Servers (Tagesgrenze der Starts): der Satz kommt an', () => {
    const satz = 'Heute sind 6 Rollenspiele möglich — morgen geht es weiter. Wenn Du heute mehr brauchst, sag Deinem Admin Bescheid.';
    expect(decideApiFailure(429, { ok: false, error: satz, code: 'QUOTA_EXCEEDED', limit: 6, used: 6 })).toEqual({ kind: 'server', text: satz });
  });

  it('übrige Codes behalten ihren Satz', () => {
    expect(decideApiFailure(401, { code: 'CENTRAL_REAUTH', error: 'Bitte neu anmelden.' })).toEqual({ kind: 'text', key: 'reauth' });
    expect(decideApiFailure(503, { code: 'CENTRAL_UNAVAILABLE' })).toEqual({ kind: 'text', key: 'unavailable' });
    expect(decideApiFailure(503, { code: 'SIMULATION_DISABLED' })).toEqual({ kind: 'text', key: 'unavailable' });
    expect(decideApiFailure(400, { code: 'NOT_ENOUGH_TURNS', minUserTurns: 3 })).toEqual({ kind: 'text', key: 'notEnoughTurns' });
    expect(decideApiFailure(409, { code: 'TURN_LIMIT' })).toEqual({ kind: 'text', key: 'turnLimit' });
    expect(decideApiFailure(409, { code: 'TIMEOUT_LIMIT', max: 3 })).toEqual({ kind: 'text', key: 'timeoutLimit' });
  });

  it('Unbekanntes bleibt die allgemeine Meldung — auch wenn `error` kein Text ist (Eingabeprüfung)', () => {
    expect(decideApiFailure(500, { code: 'INTERNAL_ERROR', error: 'Internal server error' })).toEqual({ kind: 'text', key: 'genericError' });
    expect(decideApiFailure(400, { error: { formErrors: [], fieldErrors: {} } })).toEqual({ kind: 'text', key: 'genericError' });
    expect(decideApiFailure(500, null)).toEqual({ kind: 'text', key: 'genericError' });
  });

  it('Paket 3: Lauf inzwischen beendet → zur Auswertungsseite statt roter Meldung', () => {
    // turn/route.ts, timeout/route.ts und live/ticket/route.ts antworten so, wenn der Lauf nicht mehr `active` ist.
    expect(decideApiFailure(409, { ok: false, code: 'ALREADY_FINISHED' })).toEqual({ kind: 'evaluation' });
  });

  it('Paket 3: Auswerten an einem abgebrochenen Lauf → eigener Satz', () => {
    expect(decideApiFailure(409, { ok: false, code: 'ABORTED' })).toEqual({ kind: 'text', key: 'runAborted' });
  });
});
