'use client';

import React from 'react';
import { TrendingUp, TrendingDown, Minus, ArrowUpRight, LineChart } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { BASE_PATH } from '@/lib/base-path';

/**
 * Delta-Card (P0-1, „die App, die die zweite Messung verkauft"): zeigt die
 * Entwicklung seit der letzten Messung. Erscheint NUR ab der zweiten Messung
 * (previousComparison kommt sonst als null vom Server).
 *
 * SKALEN-SSOT: Werte/Deltas kommen fertig vom Server (computeMeasurementDelta
 * ueber radar-contract, 1–4). Diese Komponente RECHNET NICHT — sie rendert.
 * NULL-DISZIPLIN: nicht vergleichbare Kompetenzen werden als Zaehler benannt,
 * nie als 0 oder Pseudo-Delta gezeigt.
 */

export interface PreviousComparison {
  prev: {
    runId: string;
    createdAt: string;
    conversationType: string | null;
    conversationSubType: string | null;
  };
  current: Record<string, number | null>;
  previous: Record<string, number | null>;
  deltas: Record<string, number | null>;
  comparableCount: number;
  notComparableCount: number;
}

const KEYS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10'] as const;

function fmtSigned(n: number): string {
  const s = n > 0 ? '+' : '';
  return `${s}${n.toLocaleString('de-DE', { maximumFractionDigits: 1 })}`;
}

export function DeltaCard({
  comparison,
  bcp47,
}: {
  comparison: PreviousComparison;
  bcp47: string;
}) {
  const { t } = useTranslation();
  const { deltas, current, previous, prev, notComparableCount } = comparison;

  const prevDate = (() => {
    try {
      return new Date(prev.createdAt).toLocaleDateString(bcp47, {
        day: '2-digit', month: '2-digit', year: 'numeric',
      });
    } catch {
      return prev.createdAt;
    }
  })();
  // Kontext-Label (Plattform-Bedingung B): Vergleichslauf benennen — Datum +
  // Gesprächstyp, damit ein Typ-Wechsel das Delta nicht verschweigt.
  const prevType = [prev.conversationType, prev.conversationSubType].filter(Boolean).join(' · ');

  const overallDelta = deltas.overall;
  const overallTone =
    typeof overallDelta === 'number'
      ? overallDelta > 0 ? 'text-emerald-400' : overallDelta < 0 ? 'text-red-400' : 'text-muted-foreground'
      : 'text-muted-foreground';
  const OverallIcon =
    typeof overallDelta === 'number'
      ? overallDelta > 0 ? TrendingUp : overallDelta < 0 ? TrendingDown : Minus
      : Minus;

  const movements: Array<{ key: string; delta: number }> = [];
  for (const k of KEYS) {
    const d = deltas[k];
    if (typeof d === 'number') movements.push({ key: k, delta: d });
  }

  return (
    <div className="glass-panel rounded-2xl p-5 border border-primary/15">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <LineChart className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-bold text-foreground">{t.report.deltaTitle}</h3>
            <p className="text-xs text-muted-foreground">
              {t.report.deltaVs.replace('{date}', prevDate)}
              {prevType ? ` · ${prevType}` : ''}
            </p>
          </div>
        </div>
        {/* Gesamt-Delta auf der 1–4-Vertragsskala (Mittel der beobachtbaren) */}
        <div className={`flex items-center gap-2 ${overallTone}`}>
          <OverallIcon className="h-5 w-5" />
          <span className="text-2xl font-bold tabular-nums">
            {typeof overallDelta === 'number' ? fmtSigned(overallDelta) : '–'}
          </span>
          <span className="text-xs text-muted-foreground">
            {typeof previous.overall === 'number' && typeof current.overall === 'number'
              ? `${previous.overall.toLocaleString('de-DE')} → ${current.overall.toLocaleString('de-DE')} / 4`
              : t.report.deltaNotComparable}
          </span>
        </div>
      </div>

      {movements.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {movements.map(({ key, delta }) => (
            <span
              key={key}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums ${
                delta > 0
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : delta < 0
                    ? 'bg-red-500/10 text-red-400'
                    : 'bg-foreground/5 text-muted-foreground'
              }`}
              title={`${key}: ${previous[key]} → ${current[key]} / 4`}
            >
              {key} {delta > 0 ? '▲' : delta < 0 ? '▼' : '='} {fmtSigned(delta)}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {notComparableCount > 0 ? (
          <p className="text-[11px] text-muted-foreground">
            {t.report.deltaNotComparableCount.replace('{count}', String(notComparableCount))}
          </p>
        ) : <span />}
        {/* Der „Film" wohnt gelockt im Hub (/radar an der Origin-Wurzel).
            BEWUSST ohne withBasePath (das waere /coach/radar = 404) und nur im
            Front-Door-Modus gerendert — im Direkt-Modus existiert /radar nicht. */}
        {BASE_PATH && (
          <a
            href="/radar"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {t.report.deltaViewRadar}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}
