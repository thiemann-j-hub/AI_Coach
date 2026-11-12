'use client';

/**
 * Spracheingabe über Azure Speech (West-Europa) im Browser — EU-Hosting Weg B (11.10.2026).
 * Wird erst geladen, wenn das Mikro eingeschaltet wird (dynamischer Import, das SDK ist groß).
 * Das Token kommt von /api/speech-token; der Schlüssel bleibt auf dem Server.
 */
import {
  AudioConfig,
  ResultReason,
  SpeechConfig,
  SpeechRecognizer,
  type SpeechRecognitionEventArgs,
} from 'microsoft-cognitiveservices-speech-sdk';

export interface AzureDictation {
  stop: () => void;
}

/**
 * Paket 1, C26 (12.11.2026): Das Token gilt rund zehn Minuten (/api/speech-token). Ohne Erneuerung brach das Diktat
 * danach still ab, sobald das SDK neu verbinden musste. Alle acht Minuten holt die laufende Erkennung ein frisches.
 */
export const TOKEN_REFRESH_MS = 8 * 60_000;

export function startAzureDictation(args: {
  token: string;
  region: string;
  /** BCP-47, z. B. de-DE */
  lang: string;
  onText: (text: string) => void;
  /** Frisches Token für die laufende Erkennung; null = gerade keines (nächster Versuch im nächsten Takt). */
  refreshToken?: () => Promise<string | null>;
  /** Erkennung wurde beendet (Fehler oder Stop). `error` nennt den Grund eines Abbruchs. */
  onEnd: (error?: string) => void;
}): AzureDictation {
  const cfg = SpeechConfig.fromAuthorizationToken(args.token, args.region);
  cfg.speechRecognitionLanguage = args.lang;
  const audio = AudioConfig.fromDefaultMicrophoneInput();
  const rec = new SpeechRecognizer(cfg, audio);
  let stopped = false;
  const refresh = args.refreshToken;
  const refreshTimer = refresh
    ? setInterval(() => {
        void refresh()
          .catch(() => null)
          .then((token) => {
            if (token && !stopped) rec.authorizationToken = token;
          });
      }, TOKEN_REFRESH_MS)
    : null;
  const end = (error?: string) => {
    if (refreshTimer) clearInterval(refreshTimer);
    args.onEnd(error);
  };
  rec.recognized = (_s: unknown, e: SpeechRecognitionEventArgs) => {
    if (e.result?.reason === ResultReason.RecognizedSpeech && e.result.text?.trim()) {
      args.onText(e.result.text.trim());
    }
  };
  rec.canceled = (_s: unknown, e: { errorDetails?: string }) => {
    if (stopped) return;
    stopped = true;
    try {
      rec.close();
    } catch {
      /* schon zu */
    }
    end(e?.errorDetails || 'canceled');
  };
  rec.sessionStopped = () => {
    if (stopped) return;
    stopped = true;
    try {
      rec.close();
    } catch {
      /* schon zu */
    }
    end();
  };
  rec.startContinuousRecognitionAsync(undefined, (err) => {
    if (stopped) return;
    stopped = true;
    end(String(err));
  });
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      rec.stopContinuousRecognitionAsync(
        () => {
          try {
            rec.close();
          } catch {
            /* schon zu */
          }
          end();
        },
        () => end()
      );
    },
  };
}
