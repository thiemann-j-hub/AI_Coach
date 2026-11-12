'use client';

/**
 * Diktat: Gesprochenes wird als Text an ein Eingabefeld ANGEHÄNGT (Chat und Check-in). Es startet nie das
 * Sprachgespräch mit der Rolle.
 *
 * Paket 4, C25 (12.11.2026): aus SimulationClient herausgelöst, Verhalten aus Paket 1 unverändert:
 *   - C11: Die Sperre gegen den Doppelklick gilt ab dem Klick.
 *   - C12: Wer während des Starts ausschaltet oder die Seite verlässt, öffnet kein Mikrofon mehr; der Abbau stoppt alles.
 *   - C10, C26: Geht das Mikrofon aus, steht der Grund da (src/lib/simulation/live-failure.ts).
 * EU-Hosting Weg B (11.10.2026): zuerst Azure Speech in Westeuropa (Token von /api/speech-token); die Erkennung
 * des Browsers (Chrome: Google) nur, wenn der Server sie ausdrücklich wählt (Rückweg SPEECH_INPUT=browser).
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
  // Gewollt-an-Merker: Browser beenden die Erkennung nach Stille von selbst. Solange die Person das Diktat nicht
  // ausgeschaltet hat, startet die Browser-Erkennung neu.
  const wantRef = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  const browserSupported =
    typeof window !== 'undefined' &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const supported = typeof window !== 'undefined' && (browserSupported || Boolean(navigator.mediaDevices?.getUserMedia));

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
   * Azure-Diktat (EU): Token holen, SDK laden, erkennen. false NUR, wenn der Server die Browser-Erkennung ausdrücklich
   * wählt (mode "browser"). 01.11.2026 (Bewertung Teil 1, Owner-Ja): Bei jedem anderen Fehler (502/503/429/Netz) kein
   * Browser-Notnagel — Chrome schickte die Aufnahme an Google, das deckt die Einwilligung nicht; stattdessen
   * „nicht erreichbar“, Mikro aus, Tippen geht weiter.
   */
  const startAzure = useCallback(async (): Promise<boolean> => {
    const o = opts.current;
    const aus = () => {
      setAktiv(false);
      wantRef.current = false;
      return true;
    };
    const ausfall = () => {
      o.onError(o.texte.unavailable);
      return aus();
    };
    try {
      const res = await authFetch('/api/speech-token');
      // Paket 1, C1 (12.11.2026): den Körper genau einmal lesen.
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; token?: string; region?: string; code?: string; url?: string; error?: string; mode?: string };
      if (res.status === 403) {
        // Stufe C / W5-4 (20.10.2026): Einwilligung „Sprachaufnahme“ fehlt → Hinweis statt Browser-Notnagel.
        if (j.code === 'EINWILLIGUNG') {
          o.onConsent(j.url || '/einwilligung?typ=sprachaufnahme');
          return aus();
        }
        // A4 (31.10.2026): KI für das Unternehmen aus → Meldung des Servers statt Browser-Notnagel.
        if (j.code === 'KI_AUS') {
          o.onError(j.error || o.texte.genericError);
          return aus();
        }
      }
      if (!res.ok) {
        if (j.mode === 'browser') return false;
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
      if (!wantRef.current) return true;
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
      return true;
    } catch {
      return ausfall();
    }
  }, []);

  /** Browser-Spracherkennung (Chrome: Google) — nur, wenn der Server sie ausdrücklich wählt. */
  const startBrowser = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new Ctor();
    rec.lang = opts.current.lang;
    rec.continuous = true;
    rec.interimResults = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let text = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) text += e.results[i][0].transcript;
      }
      if (text.trim()) opts.current.onText(text.trim());
    };
    rec.onend = () => {
      // Stille-Timeout des Browsers: neu starten, solange das Diktat gewollt an ist.
      if (wantRef.current) {
        try {
          rec.start();
          return;
        } catch {
          /* Neustart nicht möglich → sauber aus */
        }
      }
      if (recognitionRef.current === rec) recognitionRef.current = null;
      setAktiv(false);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onerror = (e: any) => {
      // Paket 1, C10 (12.11.2026): Auch hier steht der Grund da, wenn das Mikrofon ausgeht.
      const grund = dictationEndMessage(typeof e?.error === 'string' ? e.error : undefined, !wantRef.current);
      if (grund) opts.current.onError(opts.current.voiceText(grund));
      wantRef.current = false;
      if (recognitionRef.current === rec) recognitionRef.current = null;
      setAktiv(false);
    };
    recognitionRef.current = rec;
    setAktiv(true);
    rec.start();
  }, []);

  const start = useCallback(() => {
    // Paket 1, C11 (12.11.2026): Läuft schon ein Start oder das Diktat, tut ein zweiter Klick nichts.
    if (!supported || recognitionRef.current || startetRef.current) return;
    wantRef.current = true;
    startetRef.current = true;
    setStartet(true);
    void (async () => {
      try {
        if (await startAzure()) return;
        if (!wantRef.current) return;
        if (!browserSupported) {
          wantRef.current = false;
          setAktiv(false);
          opts.current.onError(opts.current.texte.unavailable);
          return;
        }
        startBrowser();
      } finally {
        startetRef.current = false;
        setStartet(false);
      }
    })();
  }, [supported, browserSupported, startAzure, startBrowser]);

  // Paket 1, C12 (12.11.2026): Beim Abbau der Seite das Mikrofon freigeben.
  useEffect(() => stop, [stop]);

  return { supported, aktiv, startet, start, stop };
}
