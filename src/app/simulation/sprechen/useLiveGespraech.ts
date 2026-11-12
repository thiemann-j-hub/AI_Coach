'use client';

/**
 * Sprachgespräch mit der Rolle (Sprachmodus Live, N4-231): Karte holen, Verbindung öffnen, Mikrofon streamen,
 * Ton der Rolle abspielen, einmal still neu verbinden, Zustände für die Sprechansicht.
 *
 * Paket 4, C25 (12.11.2026): aus SimulationClient herausgelöst. Verhalten aus Paket 1 unverändert:
 *   - C11: Die Sperre gegen den Doppelklick gilt ab dem Klick; läuft ein Aufbau, eine Verbindung oder ein
 *     Neuversuch, gibt es keine zweite.
 *   - C12: `stop()` und der Abbau der Seite beenden alles (Verbindung, Mikrofon, Ton, Neuverbinden-Timer).
 *   - C10: Je Grund ein Satz oder ein Banner (src/lib/simulation/live-failure.ts); neu verbunden wird nur beim
 *     Abriss ohne Grund, einmal und nur, solange das Gespräch gewollt ist.
 * Neu in Paket 4 (WELLE3-SPRECHEN.md):
 *   - C30: Der Tonweg entsteht im Klick (`vorbereiten()`), nicht mehr nach dem Abruf der Karte.
 *   - S2: Der Mikrofon-Check öffnet das Mikrofon an genau diesem Tonweg; das Gespräch nutzt den Strom weiter.
 *     Auch beim Neuverbinden bleibt das Mikrofon offen.
 *   - S1: `start({ eroeffnung: true })` bittet die Rolle, hörbar zu eröffnen (einmal je Lauf).
 *   - S4: `spricht` und `denkt` für den Zustand am Porträt. S6: stumm ohne Auflegen. C13: Pause.
 *   - S31: Nach einer Unterbrechung erfährt das Relais, wie viel der Antwort zu hören war.
 *   - C15: `reconnecting` / `reconnected` des Relais zeigen den Hinweis; das Mikrofon bleibt an.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '@/lib/api-client';
import { createLiveAudio, liveAudioSupported, type LiveAudio } from '@/lib/live-audio';
import { openLiveConnection, type LiveConnection, type LiveTurn } from '@/lib/live-client';
import type { ApiFailureBody } from '@/lib/simulation/api-failure';
import { decideLiveEnd, type LiveEndCause, type VoiceMessage } from '@/lib/simulation/live-failure';

/** Statuszeile im Sprachgespräch: Stille-Vorwarnung, Verbindung kurz weg, wieder da. */
export type LiveHinweis = { kind: 'idle' | 'reconnecting' | 'reconnected'; seconds?: number } | null;

export interface LiveGespraechOptions {
  /** Der Lauf des Gesprächs. Direkt nach dem Start kennt ihn erst `start({ simId })`. */
  simId: string | null;
  /** Ein Zug ist gespeichert (eigener Beitrag, Antwort der Rolle oder beides). */
  onTurn(turn: LiveTurn): void;
  /** Die Rolle hat das Gespräch beendet (Grund in der Autorensprache, Art). */
  onEnded(p: { grund: string; ergebnis: string }): void;
  /** Die Verbindung endete mit „Zeit um“ oder „Rolle hat beendet“: Banner statt Satz. */
  onBanner(art: 'timeUp' | 'ended'): void;
  /** Das Relais ist bereit; `pausedMs` und `pauseSince` sind die Pausen des Laufs, wie der Server sie kennt. */
  onReady?(p: { pausedMs?: number; pauseSince?: string | null }): void;
  /** Ein Satz für die Person; null räumt eine ältere Meldung weg. */
  onError(text: string | null): void;
  /** Das Unternehmen verlangt die Einwilligung „Sprachaufnahme“ (W5-4). */
  onConsent(url: string): void;
  /** Fehlerantwort der Karten-Route mit eigenem Satz oder Banner (Lauf zu, Limit). */
  onApiFailure(res: Response, body: ApiFailureBody | null): void;
  /** Sprechen geht für diesen Lauf gerade nicht (Schalter aus, nicht eingerichtet, Netz). */
  onUnavailable(): void;
  voiceText(m: VoiceMessage): string;
  texte: { genericError: string; voiceLost: string };
}

export interface LiveGespraech {
  state: 'off' | 'connecting' | 'on';
  /** Start oder Neuversuch läuft: Der Mikrofon-Knopf ist gesperrt. */
  busy: boolean;
  /** Mitlaufende Mitschrift des laufenden Zugs. */
  you: string;
  persona: string;
  hinweis: LiveHinweis;
  /** Mikrofon stumm geschaltet (die Verbindung bleibt). */
  stumm: boolean;
  /** Ton der Rolle aus. */
  tonAus: boolean;
  /** Ton der Rolle läuft gerade. */
  spricht: boolean;
  /** Die Antwort entsteht, oder die Rolle eröffnet gleich. */
  denkt: boolean;
  /** Im Klick aufrufen (C30): legt den Tonweg an oder setzt ihn fort. null, wenn der Browser keinen Live-Ton kann. */
  vorbereiten(): LiveAudio | null;
  /** `simId`: nur direkt nach dem Start nötig, solange die Seite den neuen Lauf noch nicht gezeichnet hat. */
  start(o?: { eroeffnung?: boolean; simId?: string }): Promise<void>;
  stop(): void;
  setStumm(on: boolean): void;
  setTonAus(on: boolean): void;
  /** Coach-Pause: Relais und Mikrofon halten an, die Antwort der Rolle bleibt stehen. */
  pause(on: boolean): void;
}

export function useLiveGespraech(options: LiveGespraechOptions): LiveGespraech {
  const opts = useRef(options);
  opts.current = options;

  const connRef = useRef<LiveConnection | null>(null);
  const audioRef = useRef<LiveAudio | null>(null);
  /** Das Gespräch ist gewollt: Nur dann wird nach einem Abriss neu verbunden. */
  const wantRef = useRef(false);
  /** Der Lauf dieser Sprechsitzung (bleibt für das Neuverbinden stehen). */
  const laufRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const retryRef = useRef(0);
  // Paket 1, C12: Der Neuverbinden-Timer wird gemerkt, damit `stop()` und der Abbau ihn löschen.
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hinweisTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stummRef = useRef(false);
  const tonAusRef = useRef(false);
  const pausiertRef = useRef(false);
  /** Lauf, in dem die Rolle schon hörbar eröffnet hat: Die Eröffnung wird je Lauf nur einmal erbeten. */
  const eroeffnetRef = useRef<string | null>(null);

  const [state, setState] = useState<'off' | 'connecting' | 'on'>('off');
  const [busy, setBusy] = useState(false);
  const [you, setYou] = useState('');
  const [persona, setPersona] = useState('');
  const [hinweis, setHinweis] = useState<LiveHinweis>(null);
  const [stumm, setStummState] = useState(false);
  const [tonAus, setTonAusState] = useState(false);
  const [spricht, setSpricht] = useState(false);
  const [denkt, setDenkt] = useState(false);

  const vorbereiten = useCallback((): LiveAudio | null => {
    if (!liveAudioSupported()) return null;
    let a = audioRef.current;
    if (!a) {
      try {
        a = createLiveAudio();
      } catch {
        // Der Browser legt keinen Tonweg an (zu viele offene, gesperrt): Sprechen geht dann nicht.
        return null;
      }
      a.onSpeaking((laeuft) => {
        setSpricht(laeuft);
        if (laeuft) setDenkt(false);
      });
      a.setMicMuted(stummRef.current);
      a.setOutputMuted(tonAusRef.current);
      audioRef.current = a;
    }
    a.unlock();
    return a;
  }, []);

  const zeigeWiederDa = useCallback(() => {
    setHinweis({ kind: 'reconnected' });
    if (hinweisTimerRef.current) clearTimeout(hinweisTimerRef.current);
    hinweisTimerRef.current = setTimeout(() => {
      hinweisTimerRef.current = null;
      setHinweis((n) => (n?.kind === 'reconnected' ? null : n));
    }, 3000);
  }, []);

  /**
   * Karte holen und verbinden. false = Sprechen geht für diesen Lauf nicht (404 LIVE_OFF, 503, Netz).
   * true = die Verbindung baut sich auf — oder der Grund steht schon da (Einwilligung fehlt, KI aus, Lauf zu, Limit).
   */
  const verbindenRef = useRef<(eroeffnung: boolean) => Promise<boolean>>(async () => false);
  verbindenRef.current = async (eroeffnung: boolean): Promise<boolean> => {
    const simId = laufRef.current;
    if (!simId || !liveAudioSupported()) return false;
    // Paket 1, C11 (12.11.2026): Die Sperre gilt ab dem Klick, nicht erst nach dem Abruf der Karte.
    if (connRef.current || startingRef.current) return true;
    startingRef.current = true;
    setBusy(true);
    setState('connecting');
    const aus = () => {
      wantRef.current = false;
      const a = audioRef.current;
      audioRef.current = null;
      a?.close();
      setState('off');
      setDenkt(false);
    };
    let karte: { ticket: string; path: string } | null = null;
    try {
      const res = await authFetch('/api/simulation/live/ticket', {
        method: 'POST',
        body: JSON.stringify({ simId }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; ticket?: string; path?: string; code?: string; url?: string; error?: string };
      if (res.status === 403 && j.code === 'EINWILLIGUNG') {
        aus();
        opts.current.onConsent(j.url || '/einwilligung?typ=sprachaufnahme');
        return true;
      }
      // A4 (31.10.2026): KI für das Unternehmen aus → Meldung des Servers.
      if (res.status === 403 && j.code === 'KI_AUS') {
        aus();
        opts.current.onError(j.error || opts.current.texte.genericError);
        return true;
      }
      // Paket 1, C10: Der Lauf ist zu (Zeit um, Zuggrenze, Szenario fehlt) oder ein Limit greift → der passende
      // Satz oder das Banner.
      if (res.status === 409 || res.status === 410 || res.status === 429) {
        aus();
        opts.current.onApiFailure(res, j);
        return true;
      }
      if (!res.ok || !j.ok || !j.ticket || !j.path) {
        aus();
        return false;
      }
      karte = { ticket: j.ticket, path: j.path };
    } catch {
      aus();
      return false;
    } finally {
      // Ab hier läuft alles ohne Warten, bis `connRef.current` gesetzt ist — die Sperre geht nahtlos über.
      startingRef.current = false;
      setBusy(retryTimerRef.current != null);
    }
    // Paket 1, C12: inzwischen ausgeschaltet oder die Seite verlassen → keine Verbindung mehr öffnen.
    if (!wantRef.current) {
      setState('off');
      return true;
    }
    // Ohne Klick entstanden (still neu verbinden nach `finish`): reicht überall außer auf iOS.
    const audio = audioRef.current ?? vorbereiten();
    if (!audio) {
      aus();
      return false;
    }
    setYou('');
    setPersona('');
    opts.current.onError(null);
    // Paket 1, C10: der erste Grund, den diese Verbindung für ihr Ende nennt (Mikrofon, Fehler, Abschied).
    let cause: LiveEndCause | null = null;
    const conn = openLiveConnection(
      karte.path,
      karte.ticket,
      {
        onReady: (p) => {
          opts.current.onReady?.(p);
          // S1: Eröffnet die Rolle gleich, steht „denkt nach“ bis zum ersten Ton; sonst hört sie zu.
          if (p.eroeffnung) eroeffnetRef.current = simId;
          setDenkt(p.eroeffnung);
          if (pausiertRef.current) conn.pause();
          void audio
            .startMic((pcm) => conn.sendAudio(pcm))
            .then(() => {
              if (connRef.current !== conn) {
                // Paket 1, C11: verwaiste Verbindung schließen. Ihr Tonweg wird nur geschlossen, wenn ihn keine
                // neuere Verbindung nutzt.
                if (audioRef.current !== audio) audio.close();
                conn.close();
                return;
              }
              setState('on');
              if (retryRef.current > 0) {
                // Wieder da nach einem Abriss: kurz melden, dann Zähler zurück.
                zeigeWiederDa();
                retryRef.current = 0;
              }
            })
            .catch((e: unknown) => {
              // Paket 1, C10: Ein verweigertes oder nicht startbares Mikrofon ist kein Abriss. Verbindung zu,
              // der Satz folgt in onClose, es wird nicht neu verbunden.
              if (!cause) cause = { art: 'mic', error: e };
              conn.end();
            });
        },
        onYou: (text) => {
          setYou(text);
          // Kommt nach `thinking` noch Mitschrift, spricht die Person weiter: zurück von „denkt nach“ auf „hört zu“.
          setDenkt(false);
          setHinweis((n) => (n?.kind === 'idle' ? null : n));
        },
        // S31: Nach einer Unterbrechung trägt `persona` den gekürzten (auch leeren) Text. Die laufende Blase wird
        // ersetzt, nie angehängt.
        onPersona: (text) => setPersona(text),
        onThinking: () => setDenkt(true),
        // C15: Das Relais verbindet sich neu zur KI. Das Mikrofon bleibt an, nur der Hinweis erscheint.
        onReconnecting: () => setHinweis({ kind: 'reconnecting' }),
        onReconnected: zeigeWiederDa,
        onEnded: (p) => opts.current.onEnded(p),
        onIdleWarn: (seconds) => setHinweis({ kind: 'idle', seconds }),
        onInterrupted: () => {
          // S31: sofort still, und dem Relais sagen, wie viel der Antwort wirklich zu hören war.
          conn.heard(audio.interrupt());
          setDenkt(false);
        },
        onAudio: (pcm) => audio.play(pcm),
        onTurn: (turn) => {
          audio.answerDone();
          setYou('');
          setPersona('');
          setDenkt(false);
          opts.current.onTurn(turn);
        },
        // Paket 1, C10: Fehler und Abschied merken; was daraus folgt, entscheidet onClose für alle Gründe an einer Stelle.
        onError: (code, message) => {
          if (!cause) cause = { art: 'error', code, message };
        },
        onBye: (reason) => {
          if (!cause) cause = { art: 'bye', reason };
        },
        onClose: (wsCode) => {
          if (connRef.current !== conn) {
            // Schon über `stop()` abgeräumt oder verwaist (Paket 1, C11).
            if (audioRef.current !== audio) audio.close();
            return;
          }
          connRef.current = null;
          setState('off');
          setYou('');
          setPersona('');
          setDenkt(false);
          // Paket 1, C10: je Grund ein Satz oder ein Banner. Neu verbunden wird nur beim Abriss ohne Grund
          // (Netz, Schlaf), einmal und nur, solange das Gespräch gewollt ist.
          const d = decideLiveEnd(cause ?? { art: 'close', wsCode }, retryRef.current >= 1);
          if (d.banner) opts.current.onBanner(d.banner);
          if (d.reconnect && wantRef.current) {
            // Das Mikrofon bleibt offen; es geht nur nichts hinaus, bis die neue Verbindung steht.
            audio.stopSending();
            retryRef.current += 1;
            setHinweis({ kind: 'reconnecting' });
            setBusy(true);
            // Paket 1, C12: Timer merken (`stop()` löscht ihn) und vor dem Neustart prüfen, ob das Gespräch noch gewollt ist.
            retryTimerRef.current = setTimeout(() => {
              retryTimerRef.current = null;
              if (!wantRef.current) {
                setHinweis(null);
                setBusy(false);
                return;
              }
              void verbindenRef.current(false).then((ok) => {
                if (connRef.current) return; // die neue Verbindung baut sich auf
                setHinweis(null);
                if (!ok) opts.current.onError(opts.current.texte.voiceLost);
              });
            }, 1000);
            return;
          }
          wantRef.current = false;
          setHinweis(null);
          // Die letzte Antwort (z. B. die Verabschiedung) spielt noch zu Ende; das Mikrofon ist sofort frei.
          if (audioRef.current === audio) audioRef.current = null;
          audio.finish();
          if (d.message) opts.current.onError(opts.current.voiceText(d.message));
        },
      },
      { eroeffnung }
    );
    connRef.current = conn;
    return true;
  };

  const setStumm = useCallback((on: boolean) => {
    stummRef.current = on;
    audioRef.current?.setMicMuted(on);
    setStummState(on);
  }, []);

  const setTonAus = useCallback((on: boolean) => {
    tonAusRef.current = on;
    audioRef.current?.setOutputMuted(on);
    setTonAusState(on);
  }, []);

  const start = useCallback(
    async (o?: { eroeffnung?: boolean; simId?: string }) => {
      // Paket 1, C11: Läuft schon ein Start, eine Verbindung oder ein Neuversuch, tut ein zweiter Klick nichts.
      if (connRef.current || startingRef.current || retryTimerRef.current) return;
      const simId = o?.simId ?? opts.current.simId;
      laufRef.current = simId;
      wantRef.current = true;
      retryRef.current = 0;
      // Wer neu verbindet, will sprechen: Ein altes „stumm“ gilt nicht weiter.
      setStumm(false);
      const eroeffnung = o?.eroeffnung === true && simId != null && eroeffnetRef.current !== simId;
      if (eroeffnung) setDenkt(true);
      const ok = await verbindenRef.current(eroeffnung);
      if (!ok) opts.current.onUnavailable();
    },
    [setStumm]
  );

  const stop = useCallback(() => {
    wantRef.current = false;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (hinweisTimerRef.current) {
      clearTimeout(hinweisTimerRef.current);
      hinweisTimerRef.current = null;
    }
    const c = connRef.current;
    connRef.current = null;
    if (c) {
      try {
        c.end();
      } catch {
        /* schon zu */
      }
    }
    const a = audioRef.current;
    audioRef.current = null;
    a?.close();
    pausiertRef.current = false;
    setState('off');
    setBusy(startingRef.current);
    setYou('');
    setPersona('');
    setHinweis(null);
    setDenkt(false);
    setSpricht(false);
  }, []);

  const pause = useCallback((on: boolean) => {
    pausiertRef.current = on;
    if (on) connRef.current?.pause();
    else connRef.current?.resume();
    audioRef.current?.setPaused(on);
  }, []);

  // Paket 1, C12 (12.11.2026): Beim Abbau der Seite alles freigeben.
  useEffect(() => stop, [stop]);

  return { state, busy, you, persona, hinweis, stumm, tonAus, spricht, denkt, vorbereiten, start, stop, setStumm, setTonAus, pause };
}
