'use client';

import React from 'react';

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

export function ScoreRing({ value }: { value: number | null }) {
  const pct = value === null ? 0 : clamp(value, 0, 100);
  const r = 40;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);

  return (
    <div className="relative w-32 h-32 shrink-0">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100" aria-label="Score">
        <circle
          className="text-foreground/5"
          cx="50" cy="50" r={r}
          fill="transparent" stroke="currentColor" strokeWidth="8"
        />
        <circle
          cx="50" cy="50" r={r}
          fill="transparent" stroke="#0091ff" strokeWidth="8"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
          style={{ filter: 'drop-shadow(0 0 10px rgba(0,145,255,0.30))' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center flex-col">
        <span className="text-3xl font-bold text-foreground tabular-nums">
          {value === null ? '—' : Math.round(pct)}
        </span>
        <span className="text-xs font-bold text-muted-foreground tracking-wider">GESAMT</span>
      </div>
    </div>
  );
}
