'use client';

import React from 'react';
import { BadgeCheck, TrendingUp, AlertTriangle } from 'lucide-react';

export function InsightCard({
  tone, title, items,
}: {
  tone: 'success' | 'warning' | 'danger';
  title: string;
  items: string[];
}) {
  const toneBar = tone === 'success' ? 'bg-emerald-500' : tone === 'warning' ? 'bg-amber-500' : 'bg-red-500';
  const toneText = tone === 'success' ? 'text-emerald-400' : tone === 'warning' ? 'text-amber-400' : 'text-red-400';
  const toneBg = tone === 'success' ? 'bg-emerald-500/10' : tone === 'warning' ? 'bg-amber-500/10' : 'bg-red-500/10';
  // lucide statt Material-Symbols-Ligatur (Font nicht geladen -> rendert sonst
  // Rohtext „verified"/„auto_graph"). verified->BadgeCheck (Stärken),
  // auto_graph->TrendingUp (Potenzial), warning->AlertTriangle.
  const ToneIcon = tone === 'success' ? BadgeCheck : tone === 'warning' ? TrendingUp : AlertTriangle;

  return (
    <div className="glass-panel rounded-2xl relative overflow-hidden">
      <div className={`absolute top-0 left-0 w-1 ${toneBar} h-full`} />
      <div className="p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className={`p-2 rounded-lg ${toneBg} ${toneText}`}>
            <ToneIcon className="h-5 w-5" />
          </div>
          <h3 className="font-bold text-lg text-foreground">{title}</h3>
        </div>

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <ul className="space-y-4">
            {items.map((x, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className={`mt-0.5 text-xs ${toneText}`}>●</span>
                <span className="text-sm text-muted-foreground">{x}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
