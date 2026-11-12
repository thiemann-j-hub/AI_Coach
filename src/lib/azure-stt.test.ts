import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Paket 1, C26 (12.11.2026): Das Azure-Diktat erneuert sein Token alle acht Minuten und nennt beim Abbruch den Grund.
 * Das SDK ist durch eine Attrappe ersetzt (kein Mikrofon, kein Netz).
 */
interface FakeRecognizer {
  authorizationToken: string;
  canceled?: (s: unknown, e: { errorDetails?: string }) => void;
  sessionStopped?: () => void;
  startError?: (err: string) => void;
  closed: boolean;
}
const sdk = vi.hoisted(() => ({ last: null as FakeRecognizer | null }));

vi.mock('microsoft-cognitiveservices-speech-sdk', () => {
  class SpeechRecognizer {
    authorizationToken = 'erstes-token';
    canceled?: (s: unknown, e: { errorDetails?: string }) => void;
    sessionStopped?: () => void;
    startError?: (err: string) => void;
    closed = false;
    constructor() {
      sdk.last = this;
    }
    startContinuousRecognitionAsync(_ok?: () => void, err?: (e: string) => void) {
      this.startError = err;
    }
    stopContinuousRecognitionAsync(ok?: () => void) {
      ok?.();
    }
    close() {
      this.closed = true;
    }
  }
  return {
    AudioConfig: { fromDefaultMicrophoneInput: () => ({}) },
    ResultReason: { RecognizedSpeech: 3 },
    SpeechConfig: { fromAuthorizationToken: () => ({ speechRecognitionLanguage: '' }) },
    SpeechRecognizer,
  };
});

import { TOKEN_REFRESH_MS, startAzureDictation } from './azure-stt';

describe('startAzureDictation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sdk.last = null;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const start = (refreshToken?: () => Promise<string | null>) => {
    const onEnd = vi.fn();
    const d = startAzureDictation({ token: 'erstes-token', region: 'westeurope', lang: 'de-DE', onText: () => {}, refreshToken, onEnd });
    return { d, onEnd, rec: sdk.last! };
  };

  it('erneuert das Token alle acht Minuten, solange das Diktat läuft', async () => {
    expect(TOKEN_REFRESH_MS).toBe(8 * 60_000);
    let n = 0;
    const refreshToken = vi.fn(async () => `token-${++n}`);
    const { rec } = start(refreshToken);
    await vi.advanceTimersByTimeAsync(TOKEN_REFRESH_MS - 1);
    expect(refreshToken).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(rec.authorizationToken).toBe('token-1');
    await vi.advanceTimersByTimeAsync(TOKEN_REFRESH_MS);
    expect(rec.authorizationToken).toBe('token-2');
  });

  it('behält das alte Token, wenn kein neues kommt, und versucht es im nächsten Takt wieder', async () => {
    const refreshToken = vi
      .fn<() => Promise<string | null>>()
      .mockRejectedValueOnce(new Error('netz'))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('token-3');
    const { rec, onEnd } = start(refreshToken);
    await vi.advanceTimersByTimeAsync(TOKEN_REFRESH_MS);
    expect(rec.authorizationToken).toBe('erstes-token');
    await vi.advanceTimersByTimeAsync(TOKEN_REFRESH_MS);
    expect(rec.authorizationToken).toBe('erstes-token');
    await vi.advanceTimersByTimeAsync(TOKEN_REFRESH_MS);
    expect(rec.authorizationToken).toBe('token-3');
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('nach dem Stoppen wird kein Token mehr geholt', async () => {
    const refreshToken = vi.fn(async () => 'neu');
    const { d, onEnd } = start(refreshToken);
    d.stop();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith(undefined);
    await vi.advanceTimersByTimeAsync(3 * TOKEN_REFRESH_MS);
    expect(refreshToken).not.toHaveBeenCalled();
  });

  it('Abbruch nennt den Grund, schließt die Erkennung und beendet die Erneuerung', async () => {
    const refreshToken = vi.fn(async () => 'neu');
    const { rec, onEnd } = start(refreshToken);
    rec.canceled?.(null, { errorDetails: 'WebSocket upgrade failed: Authentication error (401).' });
    expect(onEnd).toHaveBeenCalledWith('WebSocket upgrade failed: Authentication error (401).');
    expect(rec.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(2 * TOKEN_REFRESH_MS);
    expect(refreshToken).not.toHaveBeenCalled();
    // Ein nachlaufendes „Sitzung beendet“ meldet nicht doppelt.
    rec.sessionStopped?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('Startfehler (z. B. verweigertes Mikrofon) kommt als Grund an', () => {
    const { rec, onEnd } = start();
    rec.startError?.('Error occurred during microphone initialization: NotAllowedError: Permission denied');
    expect(onEnd).toHaveBeenCalledWith('Error occurred during microphone initialization: NotAllowedError: Permission denied');
  });
});
