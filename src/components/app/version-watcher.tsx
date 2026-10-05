'use client';

/**
 * Bündel-Frische (Blueprint COACH-OPTIMIERUNG 27.09.2026, O4 / Befund B10).
 *
 * Ein offener Tab behält nach einem Deploy sein altes Client-Bündel — neue
 * Felder (z. B. Merkkarten) fehlen, schlimmstenfalls laufen alte Chunks gegen
 * neue Routen. Der Watcher vergleicht die eingebackene Build-SHA
 * (NEXT_PUBLIC_BUILD_SHA) mit public/build-info.json des laufenden Servers:
 * - beim Start, wenn der Tab wieder sichtbar wird und alle 10 Minuten,
 * - weicht sie ab: schmaler Hinweis mit „Neu laden" — und beim nächsten
 *   Seitenwechsel lädt der Tab von selbst neu (Navigationsgrenze = sicher,
 *   Simulationszustand liegt serverseitig).
 * Ohne Build-SHA (lokal) tut der Watcher nichts.
 */
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const POLL_MS = 10 * 60_000;

/**
 * Vergleichswert des Tabs: das <meta name="build-sha"> des ausgelieferten HTML
 * (Root-Layout). Es steht mit dem Dokument fest — anders als eine in einen Chunk
 * eingebackene Konstante, die der Tab nach einem Deploy schon in der NEUEN
 * Fassung nachladen kann (Deploy-Test 27.09.: genau deshalb blieb der Hinweis
 * aus). Fallback: die Build-Konstante (lokal/alte Dokumente).
 */
function clientSha(): string {
  if (typeof document !== 'undefined') {
    const meta = document.querySelector('meta[name="build-sha"]')?.getAttribute('content');
    if (meta) return meta.slice(0, 7);
  }
  return (process.env.NEXT_PUBLIC_BUILD_SHA ?? '').slice(0, 7);
}

async function fetchServerSha(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_PATH}/build-info.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const j = (await res.json()) as { sha?: string };
    return typeof j?.sha === 'string' && j.sha ? j.sha.slice(0, 7) : null;
  } catch {
    return null;
  }
}

export function VersionWatcher() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const [stale, setStale] = useState(false);
  const firstPath = useRef(pathname);

  useEffect(() => {
    const mine = clientSha();
    if (!mine) return;
    let cancelled = false;
    const check = async () => {
      const sha = await fetchServerSha();
      if (!cancelled && sha && sha !== mine) setStale(true);
    };
    void check();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    const id = window.setInterval(() => void check(), POLL_MS);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(id);
    };
  }, []);

  // Navigationsgrenze: veraltet + Pfad gewechselt → sauber neu laden.
  useEffect(() => {
    if (stale && pathname !== firstPath.current) {
      window.location.reload();
    }
  }, [stale, pathname]);

  if (!stale) return null;
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-3 bg-primary/10 border-b border-primary/30 px-4 py-1.5 text-xs text-foreground"
      data-testid="version-stale"
    >
      <span>{t.common.newVersion}</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="pn-none inline-flex items-center gap-1 rounded-md border border-primary/40 px-2 py-0.5 font-semibold text-primary hover:bg-primary/10"
      >
        <RefreshCw className="h-3 w-3" aria-hidden /> {t.common.reload}
      </button>
    </div>
  );
}
