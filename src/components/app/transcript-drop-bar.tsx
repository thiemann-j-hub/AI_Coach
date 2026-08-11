'use client';

/**
 * Einzeilige Transkript-Ablageleiste am Einstieg (COACH-UX-BLUEPRINT §3/W1-2,
 * Sparring-Entscheid 09.08.: kein großes Feld, kein FAB — EINE Zeile, die auf
 * dem Desktop Dateien annimmt und auf Touch schlicht eine Schaltfläche ist).
 */

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload } from 'lucide-react';
import { setPendingFile } from '@/lib/pending-file';
import { useTranslation } from '@/i18n/useTranslation';

export function TranscriptDropBar() {
  const router = useRouter();
  const { t } = useTranslation();
  const [over, setOver] = useState(false);

  function go() {
    router.push('/analyze');
  }

  return (
    <button
      type="button"
      onClick={go}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f && f.type === 'application/pdf') setPendingFile(f);
        go();
      }}
      className={[
        'w-full flex items-center gap-3 rounded-xl border border-dashed px-4 py-2.5 text-left transition-colors',
        over
          ? 'border-primary bg-primary/10'
          : 'border-border bg-card/50 hover:border-primary/50 hover:bg-primary/5',
      ].join(' ')}
    >
      <Upload className="h-4 w-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate text-sm">
        <span className="font-medium">{t.entry.dropTitle}</span>
        <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">
          {t.entry.dropMeta}
        </span>
      </span>
      <span className="shrink-0 rounded-lg border border-border px-3 py-1 text-xs font-semibold text-muted-foreground">
        {t.entry.dropCta}
      </span>
    </button>
  );
}
