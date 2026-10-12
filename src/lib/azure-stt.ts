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

export function startAzureDictation(args: {
  token: string;
  region: string;
  /** BCP-47, z. B. de-DE */
  lang: string;
  onText: (text: string) => void;
  /** Erkennung wurde beendet (Fehler oder Stop). */
  onEnd: (error?: string) => void;
}): AzureDictation {
  const cfg = SpeechConfig.fromAuthorizationToken(args.token, args.region);
  cfg.speechRecognitionLanguage = args.lang;
  const audio = AudioConfig.fromDefaultMicrophoneInput();
  const rec = new SpeechRecognizer(cfg, audio);
  let stopped = false;
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
    args.onEnd(e?.errorDetails || 'canceled');
  };
  rec.sessionStopped = () => {
    if (stopped) return;
    stopped = true;
    try {
      rec.close();
    } catch {
      /* schon zu */
    }
    args.onEnd();
  };
  rec.startContinuousRecognitionAsync(undefined, (err) => {
    if (stopped) return;
    stopped = true;
    args.onEnd(String(err));
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
          args.onEnd();
        },
        () => args.onEnd()
      );
    },
  };
}
