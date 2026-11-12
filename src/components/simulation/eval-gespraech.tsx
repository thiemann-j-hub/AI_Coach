'use client';

/**
 * Paket 3, U17, S12, S13 und U18 (12.11.2026): Reiter „Gespräch“ der Rollenspiel-Auswertung.
 * Das ganze Gespräch zum Nachlesen, mit markierten Belegen und mit Aussagen, die den Fakten des Szenarios
 * widersprechen; darunter die Schlüsselmomente und „So hast Du kommuniziert“. Dieser letzte Abschnitt zeigt nur
 * noch Kennzahlen, die etwas sagen (Regel in delivery.ts, `auffaelligeKennzahlen`).
 */

import React, { useMemo, useState } from 'react';
import { Activity, CheckCircle2, ChevronDown, XCircle } from 'lucide-react';
import { auffaelligeKennzahlen, computeDelivery, type DeliveryReport } from '@/lib/simulation/delivery';
import type { ZugMarken } from '@/lib/simulation/zitat-stelle';
import { useTranslation } from '@/i18n/useTranslation';
import { GespraechVerlauf } from './gespraech-verlauf';
import { Kicker, cx, type SimEvalFeedback, type SimEvalTurn } from './eval-teile';

/** A2: Drei-Stufen-Skala eines Delivery-Werts — zeigt, WO auf der Skala der Lauf liegt. */
function DeliveryScale(props: { position: 0 | 1 | 2; tone: 'ok' | 'mid' | 'off' }) {
  const toneCls =
    props.tone === 'ok' ? 'bg-emerald-400' : props.tone === 'mid' ? 'bg-amber-400' : 'bg-rose-400';
  return (
    <div className="flex gap-1 w-24 shrink-0" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={cx('h-1.5 flex-1 rounded-full', i === props.position ? toneCls : 'bg-border')}
        />
      ))}
    </div>
  );
}

export function EvalGespraech(props: {
  feedback: SimEvalFeedback;
  turns: SimEvalTurn[] | null;
  personaName: string | null;
  /** A2: Gesprächssprache — wählt das Weichmacher-Lexikon. */
  convoLocale: string | null;
  /** Markierte Belege und sachlich nicht gedeckte Aussagen je Zug. */
  marken: ZugMarken[] | null;
  /** Zug, zu dem ein Klick auf ein Zitat rollt. */
  sprung: { turn: number; n: number } | null;
  /** Der Reiter ist gerade zu sehen. */
  sichtbar: boolean;
}) {
  const { t } = useTranslation();
  const ts = t.simulation;
  const { feedback } = props;
  // A2: Delivery deterministisch aus den Turns — pure, kostenlos, auch für Alt-Läufe.
  const delivery: DeliveryReport | null = useMemo(
    () => (props.turns && props.turns.length ? computeDelivery(props.turns, props.convoLocale) : null),
    [props.turns, props.convoLocale]
  );
  // U18: nur Kennzahlen, die etwas sagen; ohne eine solche entfällt der Abschnitt.
  const zeigt = useMemo(() => auffaelligeKennzahlen(delivery), [delivery]);
  const [softenersOpen, setSoftenersOpen] = useState(false);

  return (
    <>
      {props.turns && props.turns.length > 0 && (
        <section className="space-y-3">
          <Kicker>{ts.evalTranscriptTitle}</Kicker>
          <GespraechVerlauf
            turns={props.turns}
            personaName={props.personaName}
            marken={props.marken}
            sprung={props.sprung}
            sichtbar={props.sichtbar}
          />
        </section>
      )}

      {feedback.checkpoints.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {ts.checkpointsTitle}
          </h2>
          <div className="space-y-2">
            {feedback.checkpoints.map((c) => (
              <div key={c.id} className="pn-tile glass-panel rounded-xl border border-border p-3 flex gap-3">
                {c.hit ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-800 dark:text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="h-5 w-5 text-rose-800 dark:text-rose-400 shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {c.hit ? ts.hit : ts.missed}
                  </div>
                  <p className="text-sm leading-relaxed">{c.comment}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* A2: Delivery-Panel — WIE kommuniziert wurde. Deterministisch, ohne
          Score-Einfluss (Sparring-Beschluss); Weichmacher-Treffer sind auf
          Klick im Kontext einsehbar (Beleg-Philosophie). */}
      {delivery && zeigt.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <Activity className="h-4 w-4" /> {ts.deliveryTitle}
          </h2>
          <div className="pn-tile glass-panel rounded-xl border border-border p-4 space-y-3">
            <p className="text-xs text-muted-foreground">{ts.deliveryHint}</p>

            {zeigt.includes('talk') && (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{ts.dlvTalkRatio}</div>
                  <div className="text-xs text-muted-foreground">
                    {delivery.talkRatioPct} % ·{' '}
                    {delivery.talkBand === 'listening'
                      ? ts.dlvTalkListening
                      : delivery.talkBand === 'balanced'
                        ? ts.dlvTalkBalanced
                        : ts.dlvTalkTalking}
                  </div>
                </div>
                <DeliveryScale
                  position={delivery.talkBand === 'listening' ? 0 : delivery.talkBand === 'balanced' ? 1 : 2}
                  tone={delivery.talkBand === 'balanced' ? 'ok' : 'mid'}
                />
              </div>
            )}
            {zeigt.includes('sentence') && (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{ts.dlvSentenceLength}</div>
                  <div className="text-xs text-muted-foreground">
                    {delivery.medianSentenceWords} {ts.dlvWordsUnit} ·{' '}
                    {delivery.sentenceBand === 'short'
                      ? ts.dlvSentenceShort
                      : delivery.sentenceBand === 'normal'
                        ? ts.dlvSentenceNormal
                        : ts.dlvSentenceLong}
                  </div>
                </div>
                <DeliveryScale
                  position={delivery.sentenceBand === 'short' ? 0 : delivery.sentenceBand === 'normal' ? 1 : 2}
                  tone={delivery.sentenceBand === 'normal' ? 'ok' : 'mid'}
                />
              </div>
            )}
            {zeigt.includes('opener') && (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{ts.dlvOpeners}</div>
                  <div className="text-xs text-muted-foreground">
                    {delivery.openerRepetitionPct} % ·{' '}
                    {delivery.openerBand === 'varied'
                      ? ts.dlvOpenersVaried
                      : delivery.openerBand === 'some'
                        ? ts.dlvOpenersSome
                        : ts.dlvOpenersRepetitive}
                  </div>
                </div>
                <DeliveryScale
                  position={delivery.openerBand === 'varied' ? 0 : delivery.openerBand === 'some' ? 1 : 2}
                  tone={
                    delivery.openerBand === 'varied' ? 'ok' : delivery.openerBand === 'some' ? 'mid' : 'off'
                  }
                />
              </div>
            )}
            {zeigt.includes('softener') && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{ts.dlvSofteners}</div>
                    <div className="text-xs text-muted-foreground">
                      {delivery.softenersPer100} {ts.dlvPer100} ·{' '}
                      {delivery.softenerBand === 'normal'
                        ? ts.dlvSoftenersNormal
                        : delivery.softenerBand === 'elevated'
                          ? ts.dlvSoftenersElevated
                          : ts.dlvSoftenersMany}
                    </div>
                  </div>
                  <DeliveryScale
                    position={
                      delivery.softenerBand === 'normal' ? 0 : delivery.softenerBand === 'elevated' ? 1 : 2
                    }
                    tone={
                      delivery.softenerBand === 'normal'
                        ? 'ok'
                        : delivery.softenerBand === 'elevated'
                          ? 'mid'
                          : 'off'
                    }
                  />
                </div>
                {delivery.softenerMatches.length > 0 && (
                  <div>
                    <button
                      onClick={() => setSoftenersOpen((v) => !v)}
                      className="text-[11px] font-semibold uppercase tracking-wide text-primary flex items-center gap-1"
                    >
                      <ChevronDown
                        className={cx('h-3.5 w-3.5 transition-transform', softenersOpen && 'rotate-180')}
                      />
                      {softenersOpen ? ts.dlvHideMatches : ts.dlvShowMatches} (
                      {delivery.softenerMatches.length})
                    </button>
                    {softenersOpen && (
                      <div className="space-y-1.5 mt-2">
                        {delivery.softenerMatches.slice(0, 12).map((m, idx) => (
                          <blockquote
                            key={idx}
                            className="text-xs italic border-l-2 border-primary/40 pl-2.5 py-0.5 text-muted-foreground leading-relaxed"
                          >
                            <span className="not-italic font-semibold">{m.phrase}</span> — {m.context}
                          </blockquote>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}
