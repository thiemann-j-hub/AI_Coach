'use client';

/**
 * EIN Score-Ring für beide Ergebnis-Ansichten (COACH-UX-BLUEPRINT §3/W1-8) —
 * ersetzt die zwei gleichnamigen, unterschiedlichen Implementierungen
 * (report-dashboard-Variante + lokale Debrief-Variante der Simulation).
 * Ohne verdict: Primärfarbe. Mit verdict: Urteilsfarbe + Bestehensmarke.
 */
import React, { useEffect, useState } from 'react';

export function ScoreRing({
  value,
  label,
  verdict,
  passMark,
  unratedLabel,
}: {
  /** Prozentwert 0–100; null = nicht bewertbar. */
  value: number | null;
  /** Kleines Label unter der Zahl (z. B. „GESAMT"). */
  label?: string;
  /** Färbt den Ring nach Urteil; ohne Angabe Primärfarbe. */
  verdict?: 'passed' | 'failed' | 'unrated';
  /** Bestehensgrenze 0–100 — rendert eine Marke auf dem Ring. */
  passMark?: number;
  /** Text im Ring, wenn value null ist. */
  unratedLabel?: string;
}) {
  const [animated, setAnimated] = useState(0);
  useEffect(() => {
    const target = value ?? 0;
    const id = requestAnimationFrame(() => setAnimated(target));
    return () => cancelAnimationFrame(id);
  }, [value]);

  const R = 52;
  const C = 2 * Math.PI * R;
  const pct = Math.min(100, Math.max(0, animated));
  const stroke =
    verdict === 'passed'
      ? '#34d399'
      : verdict === 'failed'
        ? '#fb7185'
        : verdict === 'unrated'
          ? '#94a3b8'
          : '#0091ff';
  const markAngle = passMark != null ? (passMark / 100) * 2 * Math.PI - Math.PI / 2 : null;

  return (
    <div
      className="relative h-[120px] w-[120px] shrink-0"
      role="img"
      aria-label={value != null ? `${Math.round(value)} %` : (unratedLabel ?? '—')}
    >
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={R} fill="none" strokeWidth="10" className="stroke-border" />
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          stroke={stroke}
          strokeDasharray={C}
          strokeDashoffset={C - (pct / 100) * C}
          style={{
            transition: 'stroke-dashoffset 900ms cubic-bezier(0.22, 1, 0.36, 1)',
            filter: verdict ? undefined : 'drop-shadow(0 0 10px rgba(0,145,255,0.30))',
          }}
        />
      </svg>
      {markAngle != null && (
        <svg viewBox="0 0 120 120" className="absolute inset-0 h-full w-full pointer-events-none">
          <circle
            cx={60 + R * Math.cos(markAngle)}
            cy={60 + R * Math.sin(markAngle)}
            r="3.5"
            className="fill-foreground/60"
          />
        </svg>
      )}
      <div className="absolute inset-0 grid place-items-center">
        {value != null ? (
          <div className="text-center leading-none">
            <div className="text-3xl font-bold tabular-nums">{Math.round(value)}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              %{label ? ` · ${label}` : ''}
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-muted-foreground text-center px-3 leading-tight">
            {unratedLabel ?? '—'}
          </div>
        )}
      </div>
    </div>
  );
}
