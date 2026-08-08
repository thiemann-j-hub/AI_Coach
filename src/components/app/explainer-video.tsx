'use client';

// Erklärvideo-Button + Modal (Owner-Vorgabe 04.08., Synthesia-Muster
// »Watch preview«): Pill-Button mit Play-Symbol, Klick öffnet ein Fenster
// mit dem Video.
//
// Sprachfassungen (Fix 08.08.): Vorher war hier das deutsche Video fest
// verdrahtet — die App hat die 21 übersetzten Videos im Blob nie angefordert,
// jede Sprache sah Deutsch. Jetzt wie in pulscraft-hub/src/i18n/videos.ts:
// DE same-origin aus public/, alle anderen Sprachen aus dem Blob
// (Container "videos", Konvention <app>/erklaervideo-<locale>.mp4).
// Fehlt eine Blob-Datei, fällt das <video> per onError auf DE zurück.
import { useEffect, useState } from 'react';
import { Play, X } from 'lucide-react';
import { withBasePath } from '@/lib/base-path';
import { useTranslation } from '@/i18n/useTranslation';

const VIDEO_BLOB_BASE = 'https://pulsenorthassets.blob.core.windows.net/videos';

export function ExplainerVideoButton() {
  const { t, locale } = useTranslation();
  const [open, setOpen] = useState(false);

  const deSrc = withBasePath('/videos/erklaervideo.mp4');
  const src =
    locale === 'de' ? deSrc : `${VIDEO_BLOB_BASE}/coach/erklaervideo-${locale}.mp4`;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
      >
        <Play className="h-3.5 w-3.5 fill-current" />
        {t.common.watchVideo}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={t.common.watchVideo}
        >
          <div
            className="relative w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-black shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t.common.close}
              className="absolute right-3 top-3 z-10 rounded-full bg-black/60 p-2 text-white/80 transition-colors hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- Sprecherstimme im Video */}
            <video
              key={src}
              src={src}
              controls
              autoPlay
              playsInline
              className="aspect-video w-full"
              onError={(e) => {
                // Blob-Datei fehlt oder nicht erreichbar -> deutsche Fassung
                const el = e.currentTarget;
                if (!el.src.endsWith(deSrc)) el.src = deSrc;
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
