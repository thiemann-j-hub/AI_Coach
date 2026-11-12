'use client';

/**
 * Paket 3, U17 und S12 (12.11.2026): das eigene Gespräch zum Nachlesen.
 * Anlass: Die Züge wurden geladen, standen aber nirgends. Jetzt stehen sie in der Warteansicht (Lesestoff, solange
 * die Auswertung entsteht) und im Reiter „Gespräch“, dort mit markierten Belegen und mit Aussagen, die den Fakten
 * des Szenarios widersprechen (S13). Ein Klick auf ein Zitat rollt hierher (`sprung`).
 */

import React, { useEffect, useRef } from 'react';
import { textStuecke, type ZugMarken } from '@/lib/simulation/zitat-stelle';
import { useTranslation } from '@/i18n/useTranslation';
import { cx, type SimEvalTurn } from './eval-teile';

export function GespraechVerlauf(props: {
  turns: SimEvalTurn[];
  personaName: string | null;
  /** Markierte Bereiche und Zeilen je Zug (nur im Reiter „Gespräch“). */
  marken?: ZugMarken[] | null;
  /** Zug, zu dem gerollt wird. `n` zählt hoch, damit derselbe Zug ein zweites Mal anrollt. */
  sprung?: { turn: number; n: number } | null;
  /** Nur rollen, wenn der Verlauf gerade zu sehen ist (der Reiter ist sonst ausgeblendet). */
  sichtbar?: boolean;
}) {
  const { t } = useTranslation();
  const ts = t.simulation;
  const ref = useRef<HTMLOListElement>(null);
  const { sprung, sichtbar } = props;

  useEffect(() => {
    if (!sprung || sichtbar === false) return;
    const el = ref.current?.querySelector<HTMLElement>(`[data-zug="${sprung.turn}"]`);
    if (!el) return;
    const ruhig = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: ruhig ? 'auto' : 'smooth' });
    // Vorleseprogramm und Tastatur landen an der Stelle.
    el.focus({ preventScroll: true });
  }, [sprung, sichtbar]);

  return (
    <ol ref={ref} className="space-y-3" data-testid="gespraech-verlauf">
      {props.turns.map((turn, i) => {
        const mine = turn.role === 'user';
        const m = props.marken?.[i];
        return (
          <li
            key={i}
            data-zug={i}
            tabIndex={-1}
            className={cx('flex flex-col outline-none', mine ? 'items-end' : 'items-start')}
          >
            {(mine || props.personaName) && <span className="sr-only">{mine ? ts.speakerYou : props.personaName}: </span>}
            <div
              className={cx(
                'pn-none max-w-[88%] rounded-2xl border px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words',
                mine ? 'rounded-br-sm border-primary/25 bg-primary/10' : 'glass-panel rounded-bl-sm border-border',
                sprung?.turn === i && 'ring-2 ring-primary/60'
              )}
            >
              {m && m.bereiche.length > 0
                ? textStuecke(turn.text, m.bereiche).map((s, k) =>
                    s.art === null ? (
                      <React.Fragment key={k}>{s.text}</React.Fragment>
                    ) : (
                      <mark
                        key={k}
                        className={cx(
                          'rounded-sm px-0.5 text-inherit',
                          s.art === 'sachlich'
                            ? 'bg-rose-500/20 underline decoration-rose-500 decoration-wavy underline-offset-2'
                            : 'bg-amber-400/30'
                        )}
                      >
                        {s.text}
                      </mark>
                    )
                  )
                : turn.text}
            </div>
            {m?.hinweise.map((h, k) => (
              <span
                key={k}
                className={cx(
                  'mt-1 max-w-[88%] px-1 text-[11px] leading-snug',
                  h.art === 'sachlich' ? 'text-rose-800 dark:text-rose-400' : 'text-muted-foreground'
                )}
              >
                {h.art === 'sachlich' ? `${ts.factCheckTitle}: ${h.text}` : ts.evidenceFor.replace('{name}', h.text)}
              </span>
            ))}
          </li>
        );
      })}
    </ol>
  );
}
