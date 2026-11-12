'use client';

/**
 * Paket 4, S1 und S2 (12.11.2026): Mikrofon-Check vor dem ersten Wort — eine eigene Ansicht, kein Dialog über dem Chat.
 *
 * Anlass: Das Sprachgespräch begann ohne Prüfung; ob das Mikrofon etwas aufnimmt, merkte die Person erst im Gespräch,
 * und ein verweigertes Mikrofon ergab nur einen roten Satz. Ablauf (WELLE3-SPRECHEN.md, Schritt 2):
 *   1. Aufklärung vor der ersten Mikrofon-Nutzung je Gerät (CP-3.4) steht davor.
 *   2. Freigabe anfragen, Pegel-Balken, „Ich höre Dich“ nach zwei Sekunden über der Schwelle, Gerätewahl ab zwei Mikrofonen.
 *   3. „Los geht's“ (wählbar, sobald ein Pegel da war; nach acht Sekunden ohne Pegel trotzdem, mit Hinweis) und
 *      „Lieber schreiben“. Verweigert: klarer Satz, wie man das Mikrofon freigibt.
 * Das Mikrofon wird am Tonweg des Gesprächs geöffnet (`vorbereiten()`); das Gespräch nutzt den geprüften Strom weiter.
 * Die Regeln für Pegel und Knopf stehen getestet in src/lib/simulation/mikro-pegel.ts.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Mic } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { listMicrophones, type LiveAudio } from '@/lib/live-audio';
import { micErrorKind } from '@/lib/simulation/live-failure';
import { balkenProzent, losErlaubt, ohnePegel, pegelSchritt, pegelStart, type PegelStand } from '@/lib/simulation/mikro-pegel';
import { mikroHinweisBestaetigen, mikroHinweisBestaetigt } from './mikro-hinweis';

type Phase = 'start' | 'anfrage' | 'pegel' | 'verweigert' | 'fehlt';

export function MikrofonCheck(props: {
  personaName: string;
  /** Im Klick: legt den Tonweg an oder setzt ihn fort (useLiveGespraech.vorbereiten). */
  vorbereiten(): LiveAudio | null;
  /** Die Ansicht folgt direkt auf einen Klick (Start, Wechsel zu Sprechen): Das Mikrofon wird gleich angefragt. */
  ausKlick: boolean;
  onLos(): void;
  onSchreiben(): void;
  /** Zählpunkt des Trichters (S24), je Ansicht höchstens einmal. */
  onZaehlpunkt(schritt: 'mikro_ok' | 'mikro_verweigert'): void;
}) {
  const { t } = useTranslation();
  const ts = t.simulation;
  const { vorbereiten, onZaehlpunkt } = props;

  const [bestaetigt] = useState(() => mikroHinweisBestaetigt());
  const [phase, setPhase] = useState<Phase>('start');
  const [prozent, setProzent] = useState(0);
  const [stand, setStand] = useState<PegelStand>(() => pegelStart());
  const standRef = useRef(stand);
  const [geraete, setGeraete] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [geraet, setGeraet] = useState('');
  const audioRef = useRef<LiveAudio | null>(null);
  const gezaehltRef = useRef(false);
  const anfrageRef = useRef(0);

  const oeffnen = useCallback(
    (deviceId?: string) => {
      const audio = vorbereiten();
      audioRef.current = audio;
      if (!audio) {
        setPhase('fehlt');
        return;
      }
      const lauf = ++anfrageRef.current;
      standRef.current = pegelStart();
      setStand(standRef.current);
      setProzent(0);
      setPhase('anfrage');
      audio
        .openMic(deviceId)
        .then(async () => {
          if (anfrageRef.current !== lauf) return;
          setPhase('pegel');
          if (!gezaehltRef.current) {
            gezaehltRef.current = true;
            onZaehlpunkt('mikro_ok');
          }
          // Namen der Mikrofone nennt der Browser erst nach der Freigabe.
          const liste = await listMicrophones();
          if (anfrageRef.current !== lauf) return;
          setGeraete(liste);
          setGeraet(audio.micDeviceId() ?? '');
        })
        .catch((e: unknown) => {
          if (anfrageRef.current !== lauf) return;
          setPhase(micErrorKind(e) === 'denied' ? 'verweigert' : 'fehlt');
          if (!gezaehltRef.current) {
            gezaehltRef.current = true;
            onZaehlpunkt('mikro_verweigert');
          }
        });
    },
    [vorbereiten, onZaehlpunkt]
  );

  // Kommt die Ansicht aus einem Klick und ist die Aufklärung bestätigt, wird das Mikrofon gleich angefragt.
  // Beim Verlassen zählt eine noch offene Anfrage nicht mehr (kein Zählpunkt, kein Zustand).
  useEffect(() => {
    if (props.ausKlick && bestaetigt) oeffnen();
    return () => {
      anfrageRef.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pegel zehnmal je Sekunde messen (reine Regeln: mikro-pegel.ts).
  useEffect(() => {
    if (phase !== 'pegel') return;
    let zuletzt = performance.now();
    const id = window.setInterval(() => {
      const jetzt = performance.now();
      const pegel = audioRef.current?.level() ?? 0;
      standRef.current = pegelSchritt(standRef.current, pegel, jetzt - zuletzt);
      zuletzt = jetzt;
      setStand(standRef.current);
      setProzent(balkenProzent(pegel));
    }, 100);
    return () => window.clearInterval(id);
  }, [phase]);

  const knopfNeben =
    'pn-none flex-1 rounded-xl border border-border px-4 py-3 text-sm font-semibold hover:bg-muted transition-colors';
  const knopfHaupt =
    'btn-gradient flex-1 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-neon disabled:opacity-50 flex items-center justify-center gap-2';

  return (
    <div className="flex h-full flex-col" data-testid="mikrofon-check">
      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-6">
        <div className="mx-auto flex min-h-full max-w-md flex-col gap-4">
          {phase === 'start' && (
            <>
              <p className="text-base leading-relaxed">{ts.wegSprechenNote.replace('{name}', props.personaName)}</p>
              {!bestaetigt && (
                <div className="pn-tile glass-panel rounded-2xl border border-border p-4 space-y-1.5">
                  <h2 className="text-sm font-semibold">{ts.micNoticeTitle}</h2>
                  <p className="text-sm leading-relaxed text-muted-foreground">{ts.micNoticeBody}</p>
                </div>
              )}
            </>
          )}

          {phase === 'anfrage' && (
            <p className="flex items-start gap-2 text-base leading-relaxed" role="status">
              <Loader2 className="mt-1 h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
              {ts.micCheckAllow}
            </p>
          )}

          {phase === 'pegel' && (
            <>
              <div>
                <h2 className="text-xl font-semibold leading-snug">{ts.micCheckSay}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{ts.micCheckExample}</p>
              </div>
              <div
                role="meter"
                aria-label={ts.micCheckDevice}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={prozent}
                className="h-3 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-emerald-500 transition-[width] duration-100 motion-reduce:transition-none"
                  style={{ width: `${prozent}%` }}
                />
              </div>
              <div className="min-h-[1.75rem]" role="status" aria-live="polite">
                {stand.gehoert ? (
                  <span className="pn-none inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                    <CheckCircle2 className="h-4 w-4" aria-hidden /> {ts.micCheckHeard}
                  </span>
                ) : ohnePegel(stand) ? (
                  <span className="text-sm text-amber-800 dark:text-amber-400">{ts.micCheckQuiet}</span>
                ) : null}
              </div>
              {geraete.length > 1 && (
                <label className="block space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{ts.micCheckDevice}</span>
                  <select
                    value={geraet}
                    onChange={(e) => oeffnen(e.target.value)}
                    className="pn-field w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    {geraete.map((g, i) => (
                      <option key={g.deviceId} value={g.deviceId}>
                        {g.label || `${ts.micCheckDevice} ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="mt-auto text-xs leading-relaxed text-muted-foreground">{ts.micCheckTip}</p>
            </>
          )}

          {(phase === 'verweigert' || phase === 'fehlt') && (
            <p className="text-base leading-relaxed" role="alert">
              {phase === 'verweigert' ? ts.micCheckDenied : ts.micUnavailable}
            </p>
          )}
        </div>
      </div>

      <div className="border-t border-border bg-card/60 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-md gap-2">
          <button type="button" onClick={props.onSchreiben} className={knopfNeben}>
            {ts.micCheckWrite}
          </button>
          {phase === 'start' && (
            <button
              type="button"
              onClick={() => {
                mikroHinweisBestaetigen();
                oeffnen();
              }}
              className={knopfHaupt}
            >
              <Mic className="h-4 w-4" aria-hidden /> {bestaetigt ? ts.micOn : ts.micNoticeAccept}
            </button>
          )}
          {phase === 'pegel' && (
            <button type="button" onClick={props.onLos} disabled={!losErlaubt(stand)} className={knopfHaupt}>
              {ts.micCheckGo}
            </button>
          )}
          {(phase === 'verweigert' || phase === 'fehlt') && (
            <button type="button" onClick={() => oeffnen()} className={knopfHaupt}>
              {ts.micCheckRetry}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
