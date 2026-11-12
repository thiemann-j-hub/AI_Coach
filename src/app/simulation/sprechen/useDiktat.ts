'use client';

/**
 * Diktat: Gesprochenes wird als Text an ein Eingabefeld ANGEHÄNGT (Chat und Check-in). Es startet nie das
 * Sprachgespräch mit der Rolle.
 *
 * Paket 4, C25 (12.11.2026): aus SimulationClient herausgelöst, Verhalten aus Paket 1 unverändert:
 *   - C11: Die Sperre gegen den Doppelklick gilt ab dem Klick.
 *   - C12: Wer während des Starts ausschaltet oder die Seite verlässt, öffnet kein Mikrofon mehr; der Abbau stoppt alles.
 *   - C10, C26: Geht das Mikrofon aus, steht der Grund da (src/lib/simulation/live-failure.ts).
 * EU-Hosting Weg B (11.10.2026): Azure Speech in Westeuropa (Token von /api/speech-token).
 * Paket 6, C31 und C33 (12.11.2026): Die Erkennung des Browsers (Chrome: Google) und ihr Rückweg SPEECH_INPUT=browser
 * sind entfernt.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '@/lib/api-client';
import type { ApiFailureBody } from '@/lib/simulation/api-failure';
import { dictationEndMessage, type VoiceMessage } from '@/lib/simulation/live-failure';

export interface DiktatOptions {
  /** BCP-47, z. B. de-DE: die gewählte Gesprächssprache. */
  lang: string;
  /** Erkannter Text (ein Satz oder Satzteil). */
  onText(text: string): void;
  /** Ein Satz für die Person: warum das Mikrofon aus ist oder der Dienst nicht erreichbar. */
  onError(text: string): void;
  /** Das Unternehmen verlangt die Einwilligung „Sprachaufnahme“ (W5-4): Adresse der Einwilligungs-Seite. */
  onConsent(url: string): void;
  /** Fehlerantwort mit eigenem Satz (Limit erreicht, Paket 1 C5). */
  onApiFailure(res: Response, body: ApiFailureBody | null): void;
  voiceText(m: VoiceMessage): string;
  texte: { unavailable: string; genericError: string };
}

export interface Diktat {
  /** Der Browser kann überhaupt diktieren. */
  supported: boolean;
  aktiv: boolean;
  /** Der Start läuft (Knopf gesperrt). */
  startet: boolean;
  start(): void;
  stop(): void;
}

export function useDiktat(options: DiktatOptions): Diktat {
  const opts = useRef(options);
  opts.current = options;

  const [aktiv, setAktiv] = useState(false);
  const [startet, setStartet] = useState(false);
  const startetRef = useRef(false);
  // Gewollt-an-Merker: Wer während des Starts ausschaltet, öffnet kein Mikrofon mehr; bricht das Diktat ab, ohne
  // dass die Person es ausgeschaltet hat, steht der Grund da.
  const wantRef = useRef(false);
  const recognitionRef = useRef<{ stop(): void } | null>(null);

  const supported = typeof window !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  const stop = useCallback(() => {
    wantRef.current = false;
    try {
      recognitionRef.current?.stop();
    } catch {
      /* schon gestoppt */
    }
    recognitionRef.current = null;
    setAktiv(false);
  }, []);

  /**
   * Azure-Diktat (EU): Token holen, SDK laden, erkennen. Bei jedem Fehler (502/503/429/Netz): „nicht erreichbar“,
   * Mikro aus, Tippen geht weiter. Einen Notnagel über die Erkennung des Browsers gibt es nicht (01.11.2026,
   * Bewertung Teil 1, Owner-Ja: Chrome schickte die Aufnahme an Google, das deckt die Einwilligung nicht).
   */
  const startAzure = useCallback(async (): Promise<void> => {
    const o = opts.current;
    const aus = () => {
      setAktiv(false);
      wantRef.current = false;
    };
    const ausfall = () => {
      o.onError(o.texte.unavailable);
      aus();
    };
    try {
      const res = await authFetch('/api/speech-token');
      // Paket 1, C1 (12.11.2026): den Körper genau einmal lesen.
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; token?: string; region?: string; code?: string; url?: string; error?: string };
      if (res.status === 403) {
        // Stufe C / W5-4 (20.10.2026): Einwilligung „Sprachaufnahme“ fehlt → Hinweis.
        if (j.code === 'EINWILLIGUNG') {
          o.onConsent(j.url || '/einwilligung?typ=sprachaufnahme');
          return aus();
        }
        // A4 (31.10.2026): KI für das Unternehmen aus → Meldung des Servers.
        if (j.code === 'KI_AUS') {
          o.onError(j.error || o.texte.genericError);
          return aus();
        }
      }
      if (!res.ok) {
        // Paket 1, C5: Limit erreicht → der Warte-Satz statt „nicht erreichbar“.
        if (res.status === 429) {
          o.onApiFailure(res, j);
          return aus();
        }
        return ausfall();
      }
      if (!j.ok || !j.token || !j.region) return ausfall();
      const { startAzureDictation } = await import('@/lib/azure-stt');
      // Paket 1, C12: inzwischen ausgeschaltet oder die Seite verlassen → kein Mikrofon mehr öffnen.
      if (!wantRef.current) return;
      const d = startAzureDictation({
        token: j.token,
        region: j.region,
        lang: o.lang,
        onText: (text) => opts.current.onText(text),
        // Paket 1, C26: Das Token gilt rund zehn Minuten — die laufende Erkennung holt rechtzeitig ein frisches.
        refreshToken: async () => {
          const r = await authFetch('/api/speech-token');
          const x = (await r.json().catch(() => null)) as { ok?: boolean; token?: string } | null;
          return r.ok && x?.ok && x.token ? x.token : null;
        },
        onEnd: (error) => {
          if (recognitionRef.current === d) recognitionRef.current = null;
          // Paket 1, C26: Bricht das Diktat ab, steht der Grund da (nicht, wenn die Person selbst ausschaltet).
          const grund = dictationEndMessage(error, !wantRef.current);
          if (grund) opts.current.onError(opts.current.voiceText(grund));
          setAktiv(false);
          wantRef.current = false;
        },
      });
      recognitionRef.current = d;
      setAktiv(true);
    } catch {
      ausfall();
    }
  }, []);

  const start = useCallback(() => {
    // Paket 1, C11 (12.11.2026): Läuft schon ein Start oder das Diktat, tut ein zweiter Klick nichts.
    if (!supported || recognitionRef.current || startetRef.current) return;
    wantRef.current = true;
    startetRef.current = true;
    setStartet(true);
    void startAzure().finally(() => {
      startetRef.current = false;
      setStartet(false);
    });
  }, [supported, startAzure]);

  // Paket 1, C12 (12.11.2026): Beim Abbau der Seite das Mikrofon freigeben.
  useEffect(() => stop, [stop]);

  return { supported, aktiv, startet, start, stop };
}
