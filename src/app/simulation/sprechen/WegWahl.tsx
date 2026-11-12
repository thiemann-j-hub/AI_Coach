'use client';

/**
 * Paket 4, U1 und S1 (Owner-Entscheid 12.11.2026): die Wahl „Sprechen | Schreiben“ im Briefing, direkt über dem
 * Startknopf. Vorher gab es keine Wahl; das Sprachgespräch hing an einem Mikrofon-Symbol im Chat.
 * Die Vorwahl entscheidet src/lib/simulation/weg-wahl.ts.
 */
import React, { useId } from 'react';
import { Keyboard, Mic } from 'lucide-react';
import type { Weg } from '@/lib/simulation/weg-wahl';
import { cx } from './teile';

export function WegWahl(props: {
  weg: Weg;
  onChange(weg: Weg): void;
  texte: { titel: string; sprechen: string; schreiben: string; hinweis: string };
  /** Auf dem Porträt (dunkler Grund, weiße Schrift) statt auf einer Fläche der Seite. */
  aufBild?: boolean;
  disabled?: boolean;
}) {
  const { weg, texte, aufBild } = props;
  // Die Wahl steht zweimal im Briefing (am Rechner am Porträt, am Handy in der Leiste unten): eigene Kennung je Stelle.
  const titelId = useId();
  const knopf = (w: Weg, label: string, Icon: typeof Mic) => {
    const an = weg === w;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={an}
        disabled={props.disabled}
        onClick={() => props.onChange(w)}
        className={cx(
          'pn-none flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-60',
          an
            ? aufBild
              ? 'bg-white text-slate-900 shadow'
              : 'bg-card text-primary shadow'
            : aufBild
              ? 'text-white/80 hover:text-white'
              : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <Icon className="h-4 w-4" aria-hidden /> {label}
      </button>
    );
  };
  return (
    <div className="space-y-1.5 text-left" data-testid="weg-wahl">
      <div
        className={cx('text-[10px] font-semibold uppercase tracking-wide', aufBild ? 'text-white/80' : 'text-muted-foreground')}
        id={titelId}
      >
        {texte.titel}
      </div>
      <div
        role="radiogroup"
        aria-labelledby={titelId}
        className={cx('pn-none flex gap-1 rounded-xl p-1', aufBild ? 'bg-black/45 backdrop-blur' : 'bg-muted')}
      >
        {knopf('sprechen', texte.sprechen, Mic)}
        {knopf('schreiben', texte.schreiben, Keyboard)}
      </div>
      <p className={cx('text-[11px] leading-snug', aufBild ? 'text-white/80' : 'text-muted-foreground')}>{texte.hinweis}</p>
    </div>
  );
}
