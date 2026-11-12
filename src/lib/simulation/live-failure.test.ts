import { describe, expect, it } from 'vitest';
import { decideLiveEnd, dictationEndMessage, micErrorKind } from './live-failure';

/**
 * Paket 1, C10/C26 (12.11.2026): Geht das Mikrofon aus, steht immer ein Satz da, warum.
 * Gründe wie in src/lib/server/live/live-session.ts (LiveByeReason, LiveErrorCode) und live-accept.ts (4401, 1011).
 */
describe('micErrorKind', () => {
  it('verweigert: Browser-Freigabe fehlt', () => {
    expect(micErrorKind({ name: 'NotAllowedError', message: 'Permission denied' })).toBe('denied');
    expect(micErrorKind({ name: 'SecurityError' })).toBe('denied');
    expect(micErrorKind('not-allowed')).toBe('denied');
  });
  it('nicht startbar: kein Gerät, belegt, Unbekanntes', () => {
    expect(micErrorKind({ name: 'NotFoundError', message: 'Requested device not found' })).toBe('unavailable');
    expect(micErrorKind({ name: 'NotReadableError' })).toBe('unavailable');
    expect(micErrorKind(undefined)).toBe('unavailable');
  });
});

describe('decideLiveEnd', () => {
  it('verweigertes Mikrofon ist kein Abriss: Satz zum Freigeben, kein Neuverbinden', () => {
    expect(decideLiveEnd({ art: 'mic', error: { name: 'NotAllowedError' } }, false)).toEqual({
      message: { type: 'text', key: 'micDenied' },
      banner: null,
      reconnect: false,
    });
    expect(decideLiveEnd({ art: 'mic', error: { name: 'NotFoundError' } }, false)).toEqual({
      message: { type: 'text', key: 'micUnavailable' },
      banner: null,
      reconnect: false,
    });
  });

  it('jeder Abschied des Servers hat seinen Satz oder sein Banner', () => {
    const bye = (reason: string) => decideLiveEnd({ art: 'bye', reason }, false);
    expect(bye('budget')).toEqual({ message: { type: 'ai', aiCode: 'daily_limit' }, banner: null, reconnect: false });
    expect(bye('turn_limit')).toEqual({ message: { type: 'text', key: 'turnLimit' }, banner: null, reconnect: false });
    expect(bye('idle')).toEqual({ message: { type: 'text', key: 'micIdleOff' }, banner: null, reconnect: false });
    expect(bye('upstream')).toEqual({ message: { type: 'ai', aiCode: 'ai_unavailable' }, banner: null, reconnect: false });
    // 30-Minuten-Grenze: der Server verabschiedet sich mit „ended“, ohne dass die Person abgeschaltet hat.
    expect(bye('ended')).toEqual({ message: { type: 'text', key: 'liveMaxTime' }, banner: null, reconnect: false });
    expect(bye('time_up')).toEqual({ message: null, banner: 'timeUp', reconnect: false });
    expect(bye('ended_by_persona')).toEqual({ message: null, banner: 'ended', reconnect: false });
    expect(bye('ki_aus').message).toEqual({ type: 'text', key: 'genericError' });
    // Paket 2: anderes Fenster hat übernommen, Lauf nicht mehr aktiv.
    expect(bye('replaced')).toEqual({ message: { type: 'text', key: 'liveReplaced' }, banner: null, reconnect: false });
    expect(bye('not_active')).toEqual({ message: { type: 'text', key: 'liveEnded' }, banner: null, reconnect: false });
    expect(bye('etwas_neues').message).toEqual({ type: 'text', key: 'voiceLost' });
  });

  it('kein Abschied des Servers löst ein Neuverbinden aus', () => {
    for (const reason of ['time_up', 'ended_by_persona', 'turn_limit', 'budget', 'idle', 'upstream', 'ended', 'ki_aus', 'replaced', 'not_active', 'etwas_neues']) {
      expect(decideLiveEnd({ art: 'bye', reason }, false).reconnect).toBe(false);
    }
  });

  it('jeder Fehlercode des Servers hat seinen Satz oder sein Banner, ohne Neuverbinden', () => {
    const err = (code: string, message?: string) => decideLiveEnd({ art: 'error', code, message }, false);
    expect(err('KI_AUS', 'Dein Unternehmen hat die KI ausgeschaltet.')).toEqual({
      message: { type: 'server', text: 'Dein Unternehmen hat die KI ausgeschaltet.' },
      banner: null,
      reconnect: false,
    });
    expect(err('KI_AUS').message).toEqual({ type: 'text', key: 'genericError' });
    expect(err('UPSTREAM').message).toEqual({ type: 'ai', aiCode: 'ai_unavailable' });
    expect(err('TIME_UP')).toEqual({ message: null, banner: 'timeUp', reconnect: false });
    expect(err('ENDED')).toEqual({ message: null, banner: 'ended', reconnect: false });
    expect(err('TURN_LIMIT').message).toEqual({ type: 'text', key: 'turnLimit' });
    expect(err('UNKNOWN_SCENARIO').message).toEqual({ type: 'text', key: 'scenarioGone' });
    expect(err('NOT_FOUND').message).toEqual({ type: 'text', key: 'genericError' });
    expect(err('ALREADY_FINISHED').message).toEqual({ type: 'text', key: 'liveEnded' });
    for (const code of ['KI_AUS', 'UPSTREAM', 'TIME_UP', 'ENDED', 'TURN_LIMIT', 'UNKNOWN_SCENARIO', 'NOT_FOUND', 'ALREADY_FINISHED']) {
      expect(err(code).reconnect).toBe(false);
    }
  });

  it('Abriss ohne Grund (Netz, Karte abgelaufen 4401): einmal neu verbinden, danach der Satz', () => {
    expect(decideLiveEnd({ art: 'close', wsCode: 1006 }, false)).toEqual({ message: null, banner: null, reconnect: true });
    expect(decideLiveEnd({ art: 'close', wsCode: 4401 }, false)).toEqual({ message: null, banner: null, reconnect: true });
    expect(decideLiveEnd({ art: 'close', wsCode: 4401 }, true)).toEqual({
      message: { type: 'text', key: 'voiceLost' },
      banner: null,
      reconnect: false,
    });
    expect(decideLiveEnd({ art: 'close' }, true).message).toEqual({ type: 'text', key: 'voiceLost' });
  });
});

describe('dictationEndMessage', () => {
  it('selbst gestoppt: kein Satz', () => {
    expect(dictationEndMessage(undefined, true)).toBeNull();
    expect(dictationEndMessage('canceled', true)).toBeNull();
  });
  it('Azure-Diktat: verweigertes Mikrofon, fehlendes Mikrofon, Abbruch der Verbindung', () => {
    expect(dictationEndMessage('Error occurred during microphone initialization: NotAllowedError: Permission denied', false)).toEqual({
      type: 'text',
      key: 'micDenied',
    });
    expect(dictationEndMessage('Error occurred during microphone initialization: NotFoundError: Requested device not found', false)).toEqual({
      type: 'text',
      key: 'micUnavailable',
    });
    expect(dictationEndMessage('WebSocket upgrade failed: Authentication error (401).', false)).toEqual({ type: 'text', key: 'voiceLost' });
    // Ende ohne Fehlertext, obwohl das Mikrofon an bleiben sollte: nicht still ausgehen.
    expect(dictationEndMessage(undefined, false)).toEqual({ type: 'text', key: 'voiceLost' });
  });
});
