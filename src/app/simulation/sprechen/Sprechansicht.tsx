'use client';

/**
 * Paket 4, U2, S4 und S5 (12.11.2026): die Sprechansicht — zuerst fürs Handy (Hochformat, 390 px) gebaut.
 *
 * Anlass: Das Sprachgespräch lief im Chatfenster mit einem 16-Pixel-Porträt; das Gegenüber hatte keine Präsenz.
 * Maßstab des Owners: Die Person sieht das Gegenüber und das Gespräch, mehr nicht.
 *   - großes Porträt (dasselbe Bild wie im Briefing) mit dem Zustand als Text UND Form (Ring),
 *   - darunter Name mit dem Kennzeichen „KI-Rolle“ und die Rollenzeile,
 *   - unten drei Knöpfe in Daumenhöhe: Coach-Pause, Mikrofon an/aus (groß, mittig), Beenden,
 *   - Banner (Stille-Warnung, Verbindung, Zeit um, Rolle hat beendet) über den Knöpfen, nie über dem Porträt,
 *   - die Mitschrift ist eingeklappt und per Tipp da; am Rechner (ab 1024 px) klappt sie neben der Spalte auf.
 * Der Zustand kommt als reine Entscheidung aus src/lib/simulation/sprech-zustand.ts. Die Bewegung des Rings
 * respektiert `prefers-reduced-motion` (motion-safe); die Form unterscheidet die Zustände auch ohne Bewegung.
 */
import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Flag, Loader2, Mic, MicOff, Pause } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { withBasePath } from '@/lib/base-path';
import type { RolleZustand } from '@/lib/simulation/sprech-zustand';
import { GespraechsBlasen, KiKennzeichen, cx, initialen, type BlasenZug } from './teile';

/** Ring um das Porträt: je Zustand eine eigene Form (durchgezogen, gestrichelt, kräftig), nicht nur eine Farbe. */
const RING: Record<RolleZustand, string> = {
  hoert: 'border-4 border-emerald-500',
  denkt: 'border-4 border-dashed border-primary/70 motion-safe:animate-[spin_8s_linear_infinite]',
  spricht: 'border-[6px] border-primary',
  mikroAus: 'border-2 border-border',
  verbindet: 'border-2 border-dashed border-muted-foreground/50',
};

const PLAKETTE: Record<RolleZustand, string> = {
  hoert: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
  denkt: 'bg-primary/10 text-primary',
  spricht: 'bg-primary text-primary-foreground',
  mikroAus: 'bg-muted text-muted-foreground',
  verbindet: 'bg-muted text-muted-foreground',
};

export function Sprechansicht(props: {
  name: string;
  rolle: string;
  /** Kennung des Porträts (public/personas/<kennung>.jpg). */
  portrait: string;
  zustand: RolleZustand;
  turns: BlasenZug[];
  /** Mitlaufende Mitschrift des laufenden Zugs. */
  laufendDu: string;
  laufendRolle: string;
  /** Banner über den Knöpfen: Stille-Warnung, Verbindung, Zeit um, Rolle hat beendet, Meldungen. */
  banner?: React.ReactNode;
  /** Coach-Pause; fehlt in der Prüfung. */
  pause?: { onClick(): void; disabled: boolean; zaehler: string } | null;
  mikro: { an: boolean; disabled: boolean; onClick(): void };
  beenden: { label: string; onClick(): void; disabled: boolean; title?: string };
}) {
  const { t } = useTranslation();
  const ts = t.simulation;
  const { zustand, pause, mikro, beenden } = props;
  const [mitschrift, setMitschrift] = useState(false);
  const [bildFehlt, setBildFehlt] = useState(false);

  const zustandText =
    zustand === 'hoert'
      ? ts.stateListening
      : zustand === 'denkt'
        ? ts.stateThinking
        : zustand === 'spricht'
          ? ts.stateSpeaking
          : zustand === 'verbindet'
            ? ts.liveConnecting
            : ts.stateMicOff;

  const knopfSeite =
    'pn-none flex min-h-[3rem] items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-sm font-semibold transition-colors disabled:opacity-50';

  return (
    <div
      className={cx(
        'grid h-full min-h-0 grid-cols-1',
        mitschrift
          ? 'grid-rows-[minmax(0,1fr)_minmax(0,45%)_auto] lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] lg:grid-rows-[minmax(0,1fr)_auto]'
          : 'grid-rows-[minmax(0,1fr)_auto]'
      )}
      data-testid="sprechansicht"
    >
      {/* ── Bühne: Porträt, Name, Zustand ── */}
      <section className="col-start-1 row-start-1 flex min-h-0 flex-col items-center gap-3 overflow-y-auto px-4 pb-3 pt-6 text-center">
        <div className={cx('relative my-auto shrink-0', mitschrift ? 'h-24 w-24 lg:h-64 lg:w-64' : 'h-48 w-48 sm:h-64 sm:w-64')}>
          {/* Der Ring liegt auf einer eigenen Ebene: Es bewegt sich nur der Ring, nie das Bild. */}
          {zustand === 'spricht' && (
            <span className="absolute -inset-4 rounded-full bg-primary/20 motion-safe:animate-pulse" aria-hidden />
          )}
          <span className={cx('absolute -inset-2 rounded-full', RING[zustand])} aria-hidden />
          <span className="absolute inset-0 grid place-items-center overflow-hidden rounded-full bg-gradient-to-br from-primary to-accent text-5xl font-bold text-white">
            {bildFehlt ? (
              <span aria-hidden>{initialen(props.name)}</span>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={withBasePath(`/personas/${props.portrait}.jpg`)}
                alt=""
                className="h-full w-full object-cover"
                onError={() => setBildFehlt(true)}
              />
            )}
          </span>
        </div>
        <div className="min-w-0 max-w-full">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <h2 className="break-words text-xl font-bold leading-tight">{props.name}</h2>
            <KiKennzeichen text={ts.aiRoleBadge} title={ts.aiStartNotice} />
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{props.rolle}</p>
        </div>
        <div
          className={cx('pn-none inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold', PLAKETTE[zustand])}
          data-testid="rolle-zustand"
          data-zustand={zustand}
        >
          {zustand === 'verbindet' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          {zustandText}
        </div>
        <button
          type="button"
          onClick={() => setMitschrift((v) => !v)}
          aria-expanded={mitschrift}
          className="pn-none mt-auto inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
        >
          {mitschrift ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronUp className="h-4 w-4" aria-hidden />}
          {mitschrift ? ts.transcriptHide : ts.transcriptShow}
        </button>
      </section>

      {/* ── Mitschrift: dieselben Blasen wie im Chat. Handy: unter der Bühne. Rechner: neben der Spalte. ── */}
      {mitschrift && (
        <aside
          className="col-start-1 row-start-2 flex min-h-0 flex-col border-t border-border bg-muted/20 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:border-l lg:border-t-0"
          aria-label={ts.transcriptTitle}
        >
          <div className="hidden px-4 pt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground lg:block">
            {ts.transcriptTitle}
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto custom-scrollbar px-4 py-3">
            <GespraechsBlasen
              turns={props.turns}
              personaName={props.name}
              portrait={props.portrait}
              laufendDu={props.laufendDu}
              laufendRolle={props.laufendRolle}
            />
          </div>
        </aside>
      )}

      {/* ── Leiste in Daumenhöhe: Banner darüber, dann Coach-Pause, Mikrofon, Beenden ── */}
      <div
        className={cx(
          'col-start-1 border-t border-border bg-card/60 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
          mitschrift ? 'row-start-3 lg:row-start-2' : 'row-start-2'
        )}
      >
        {props.banner && <div className="mx-auto mb-3 max-w-md space-y-2">{props.banner}</div>}
        <div className="mx-auto grid max-w-md grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
          {pause ? (
            <button
              type="button"
              onClick={pause.onClick}
              disabled={pause.disabled}
              className={cx(knopfSeite, 'border-accent/40 text-accent hover:bg-accent/10')}
            >
              <Pause className="hidden h-4 w-4 shrink-0 min-[430px]:block" aria-hidden />
              <span className="min-w-0 break-words">{ts.timeoutCta}</span>
              <span className="text-[10px] tabular-nums" title={ts.timeoutCounterLegend}>
                {pause.zaehler}
              </span>
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={mikro.onClick}
            disabled={mikro.disabled}
            aria-pressed={mikro.an}
            aria-label={mikro.an ? ts.micOff : ts.micOn}
            title={mikro.an ? ts.micOff : ts.micOn}
            className={cx(
              'pn-none grid h-16 w-16 place-items-center rounded-full border transition-colors disabled:opacity-50',
              mikro.an ? 'btn-gradient border-transparent text-white shadow-neon' : 'border-border bg-card text-muted-foreground hover:text-foreground'
            )}
          >
            {mikro.an ? <Mic className="h-7 w-7" aria-hidden /> : <MicOff className="h-7 w-7" aria-hidden />}
          </button>
          <button
            type="button"
            onClick={beenden.onClick}
            disabled={beenden.disabled}
            title={beenden.title}
            className={cx(knopfSeite, 'border-primary/40 text-primary hover:bg-primary/10')}
          >
            <Flag className="h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0 break-words">{beenden.label}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
