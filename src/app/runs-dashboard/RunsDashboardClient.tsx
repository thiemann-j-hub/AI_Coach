import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useTheme } from 'next-themes';

type RunsListItem = {
  id: string;
  createdAt?: string;
  conversationType?: string;
  conversationSubType?: string | null;
  goal?: string | null;
  scoreOverall?: number | null;
  summary?: string | null;
  hasTranscript?: boolean;
};

const STORAGE_KEY = 'commscoach_sessionId';

function newSessionId(): string {
  const c: any = globalThis.crypto as any;
  if (c?.randomUUID) return c.randomUUID();
  return `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function shortId(id?: string, n = 18) {
  const s = String(id ?? '');
  if (!s) return '—';
  if (s.length <= n) return s;
  return s.slice(0, n) + '…';
}

function fmtDateTime(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return d.toLocaleString('de-DE', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return d.toISOString();
  }
}

async function readErrorText(res: Response) {
  const t = await res.text();
  try {
    const j = JSON.parse(t);
    return String(j?.error || j?.message || t || res.statusText);
  } catch {
    return String(t || res.statusText);
  }
}

function getIconForTitle(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('gehalt') || t.includes('verhandlung')) return 'payments';
  if (t.includes('ziel') || t.includes('planung') || t.includes('strategy')) return 'rocket_launch';
  if (t.includes('feedback') || t.includes('kritik')) return 'mic';
  if (t.includes('interview') || t.includes('bewerbung')) return 'person_search';
  return 'forum'; // default
}

function getScoreColorClass(score: number | null): string {
  if (score === null || score === undefined) return 'bg-gray-100 text-gray-500 border-gray-200';
  if (score >= 9.0) return 'bg-green-100 text-green-600 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800';
  if (score >= 8.0) return 'bg-purple-100 text-purple-600 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-800';
  if (score >= 7.0) return 'bg-blue-100 text-blue-600 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800';
  return 'bg-orange-100 text-orange-600 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800';
}

export default function RunsDashboardClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { theme, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  const [sessionId, setSessionId] = useState<string>('');
  const [runs, setRuns] = useState<RunsListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<'date_desc' | 'date_asc' | 'score_desc' | 'score_asc'>('date_desc');
  const [refresh, setRefresh] = useState(0);

  // SessionId: URL -> localStorage sync (und fallback)
  useEffect(() => {
    const urlSid = searchParams.get('sessionId');
    if (urlSid && urlSid.trim()) {
      setSessionId(urlSid.trim());
      try {
        localStorage.setItem(STORAGE_KEY, urlSid.trim());
      } catch {}
      return;
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && stored.trim()) {
        setSessionId(stored.trim());
        // URL aufräumen (shareable)
        router.replace(`/runs-dashboard?sessionId=${encodeURIComponent(stored.trim())}`);
      }
    } catch {}
  }, [searchParams, router]);

  // Load runs
  useEffect(() => {
    const sid = sessionId.trim();
    if (!sid) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/runs/list?sessionId=${encodeURIComponent(sid)}`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
        });

        if (!res.ok) {
          const msg = await readErrorText(res);
          throw new Error(msg);
        }

        const j = await res.json();
        if (!j?.ok) throw new Error(String(j?.error || 'Runs konnten nicht geladen werden.'));
        const list = Array.isArray(j?.runs) ? (j.runs as RunsListItem[]) : [];
        if (!cancelled) setRuns(list);
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message || e || 'Unbekannter Fehler'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [sessionId, refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = [...runs];

    if (q) {
      list = list.filter((r) => {
        const s = [
          r.id,
          r.goal,
          r.summary,
          r.createdAt,
          r.conversationType,
          r.conversationSubType ?? '',
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return s.includes(q);
      });
    }

    const score = (x: RunsListItem) => (typeof x.scoreOverall === 'number' ? x.scoreOverall : -1);
    const ts = (x: RunsListItem) => {
      const d = x.createdAt ? new Date(x.createdAt).getTime() : 0;
      return Number.isFinite(d) ? d : 0;
    };

    switch (sortKey) {
      case 'date_asc':
        list.sort((a, b) => ts(a) - ts(b));
        break;
      case 'score_desc':
        list.sort((a, b) => score(b) - score(a));
        break;
      case 'score_asc':
        list.sort((a, b) => score(a) - score(b));
        break;
      case 'date_desc':
      default:
        list.sort((a, b) => ts(b) - ts(a));
        break;
    }

    return list;
  }, [runs, query, sortKey]);

  return (
    <div className="bg-background-light dark:bg-background-dark text-text-main-light dark:text-text-main-dark font-body antialiased selection:bg-primary selection:text-white transition-colors duration-300 h-screen overflow-hidden flex flex-col md:flex-row">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 bg-surface-light dark:bg-surface-dark border-b border-border-light dark:border-border-dark">
        <div className="font-bold text-xl text-primary">PulseCraft AI</div>
        <button className="text-text-main-light dark:text-text-main-dark" onClick={() => setMobileOpen(!mobileOpen)}>
          <span className="material-icons-round">menu</span>
        </button>
      </div>

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-surface-light dark:bg-surface-dark border-r border-border-light dark:border-border-dark flex-col transition-transform duration-300 md:translate-x-0 md:static md:flex ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-6">
            <h1 className="font-display font-bold text-2xl tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-400">
                PulseCraft AI
            </h1>
        </div>
        <nav className="flex-1 px-4 space-y-2 overflow-y-auto">
            <Link href="/analyze" className="flex items-center px-4 py-3 text-text-muted-light dark:text-text-muted-dark hover:text-text-main-light dark:hover:text-text-main-dark hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg transition-all duration-200 group">
                <span className="material-icons-round mr-3 group-hover:scale-110 transition-transform">analytics</span>
                <span className="font-medium">Analyse</span>
            </Link>
            <Link href="/runs-dashboard" className="flex items-center px-4 py-3 bg-primary/10 text-primary rounded-lg border-l-4 border-primary transition-all duration-200 group">
                <span className="material-icons-round mr-3">history</span>
                <span className="font-medium">Verlauf</span>
            </Link>
            <Link href="/design-preview" className="flex items-center px-4 py-3 text-text-muted-light dark:text-text-muted-dark hover:text-text-main-light dark:hover:text-text-main-dark hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg transition-all duration-200 group">
                <span className="material-icons-round mr-3 group-hover:scale-110 transition-transform">grid_view</span>
                <span className="font-medium">Design-Preview</span>
            </Link>
        </nav>
        <div className="p-4 mt-auto">
            <button 
              className="w-full btn-gradient text-white font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-2 shadow-glow" 
              onClick={() => {
                const sid = newSessionId();
                try { localStorage.setItem(STORAGE_KEY, sid); } catch {}
                router.push(`/analyze?sessionId=${encodeURIComponent(sid)}`);
              }}
            >
                <span className="material-icons-round text-xl">add_circle_outline</span>
                Neue Analyse
            </button>
        </div>
        <div className="px-4 pb-4">
            <button className="flex items-center justify-center w-full py-2 text-xs text-text-muted-light dark:text-text-muted-dark hover:bg-gray-100 dark:hover:bg-white/5 rounded transition-colors" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                <span className="material-icons-round text-base mr-2">brightness_6</span> Toggle Theme
            </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        <header className="h-16 flex items-center justify-between px-6 bg-background-light dark:bg-background-dark border-b border-border-light dark:border-border-dark flex-shrink-0">
            <div className="flex flex-col">
                <h2 className="text-lg font-bold text-text-main-light dark:text-text-main-dark leading-tight">Sitzungsverlauf</h2>
                <span className="text-xs text-text-muted-light dark:text-text-muted-dark font-mono">Session: {shortId(sessionId)}</span>
            </div>
            <div className="flex items-center space-x-4">
                <button 
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark text-text-muted-light dark:text-text-muted-dark text-sm hover:border-primary transition-colors"
                  onClick={() => {
                    const sid = newSessionId();
                    try { localStorage.setItem(STORAGE_KEY, sid); } catch {}
                    router.push(`/analyze?sessionId=${encodeURIComponent(sid)}`);
                  }}
                >
                  <span className="material-icons-round text-sm">add</span>
                  <span>Neue Sitzung</span>
                </button>
                <button className="relative p-2 text-text-muted-light dark:text-text-muted-dark hover:text-primary transition-colors">
                    <span className="material-icons-round">notifications</span>
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full border-2 border-background-light dark:border-background-dark"></span>
                </button>
                <div className="flex items-center pl-4 border-l border-border-light dark:border-border-dark">
                    <div className="text-right mr-3 hidden sm:block">
                        <div className="text-sm font-semibold text-text-main-light dark:text-text-main-dark">Jürgen Thiemann</div>
                        <div className="text-xs text-text-muted-light dark:text-text-muted-dark cursor-pointer hover:text-primary">Logout</div>
                    </div>
                    <div className="relative">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center text-white font-bold shadow-md">
                            J
                        </div>
                        <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-background-light dark:border-background-dark rounded-full"></div>
                    </div>
                </div>
            </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
          <div className="max-w-5xl mx-auto space-y-6">
            
            {/* Search & Sort Bar */}
            <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
              <div className="relative flex-1">
                <span className="material-icons-round absolute left-4 top-1/2 -translate-y-1/2 text-text-muted-light dark:text-text-muted-dark">
                  search
                </span>
                <input
                  className="w-full rounded-2xl bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark pl-12 pr-4 py-3 text-sm text-text-main-light dark:text-text-main-dark placeholder-text-muted-light dark:placeholder-text-muted-dark outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 shadow-card-light dark:shadow-card-dark transition-all"
                  placeholder="Suche nach Ziel, ID oder Datum…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-3">
                <div className="relative">
                  <select
                    className="appearance-none rounded-2xl bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark pl-4 pr-10 py-3 text-sm text-text-main-light dark:text-text-main-dark outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 shadow-card-light dark:shadow-card-dark cursor-pointer transition-all"
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as any)}
                    aria-label="Sortieren"
                  >
                    <option value="date_desc">Datum (Neueste)</option>
                    <option value="date_asc">Datum (Älteste)</option>
                    <option value="score_desc">Score (Höchster)</option>
                    <option value="score_asc">Score (Niedrigster)</option>
                  </select>
                  <span className="material-icons-round absolute right-3 top-1/2 -translate-y-1/2 text-text-muted-light dark:text-text-muted-dark pointer-events-none text-base">expand_more</span>
                </div>

                <button
                  className="inline-flex items-center gap-2 rounded-2xl bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark px-4 py-3 text-sm text-text-main-light dark:text-text-main-dark hover:bg-gray-100 dark:hover:bg-white/5 shadow-card-light dark:shadow-card-dark transition-all"
                  onClick={() => setRefresh((x) => x + 1)}
                >
                  <span className="material-icons-round text-base">refresh</span>
                  <span className="hidden sm:inline">Neu laden</span>
                </button>
              </div>
            </div>

            {/* Error State */}
            {error ? (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 rounded-2xl p-5 text-red-600 dark:text-red-300">
                <div className="font-semibold mb-1 flex items-center gap-2">
                  <span className="material-icons-round">error_outline</span>
                  Fehler
                </div>
                <div className="text-sm opacity-90 whitespace-pre-wrap">{error}</div>
                <button
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white/50 border border-red-200/50 px-4 py-2 text-sm hover:bg-white/80"
                  onClick={() => setRefresh((x) => x + 1)}
                >
                  <span className="material-icons-round text-sm">refresh</span>
                  Neu laden
                </button>
              </div>
            ) : null}

            {/* Loading State */}
            {loading ? (
              <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-2xl p-8 text-center text-text-muted-light dark:text-text-muted-dark shadow-card-light dark:shadow-card-dark">
                <div className="inline-flex flex-col items-center gap-3">
                  <span className="material-icons-round animate-spin text-3xl text-primary">autorenew</span>
                  <span>Lade Verlauf…</span>
                </div>
              </div>
            ) : null}

            {/* Empty State */}
            {!loading && !error && filtered.length === 0 ? (
              <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-2xl p-10 text-center shadow-card-light dark:shadow-card-dark">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
                   <span className="material-icons-round text-3xl">history</span>
                </div>
                <h3 className="font-bold text-lg text-text-main-light dark:text-text-main-dark mb-2">Noch keine Analysen</h3>
                <div className="text-sm text-text-muted-light dark:text-text-muted-dark max-w-md mx-auto mb-6">
                  Es sieht so aus, als hättest du für diese Session noch keine Gespräche analysiert. Starte jetzt deine erste Analyse!
                </div>
                <button
                  className="btn-gradient text-white px-6 py-3 rounded-xl text-sm font-semibold shadow-glow inline-flex items-center gap-2"
                  onClick={() => router.push(`/analyze?sessionId=${encodeURIComponent(sessionId || newSessionId())}`)}
                >
                  <span className="material-icons-round">add_circle_outline</span>
                  Neue Analyse
                </button>
              </div>
            ) : null}

            {/* Runs List */}
            <div className="space-y-4">
              {filtered.map((r) => {
                const title =
                  (r.goal && r.goal.trim()) ||
                  [r.conversationType, r.conversationSubType].filter(Boolean).join(' • ') ||
                  'Analyse';

                const scoreVal = typeof r.scoreOverall === 'number' ? Math.round(r.scoreOverall * 10) / 10 : null;
                const scoreStr = scoreVal !== null ? String(scoreVal) : '—';
                const scoreClass = getScoreColorClass(scoreVal);
                const icon = getIconForTitle(title);

                return (
                  <div
                    key={r.id}
                    className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-2xl p-0 hover:border-primary/50 transition-all shadow-card-light dark:shadow-card-dark group"
                  >
                    <div className="p-6 pb-4">
                        <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-4 mb-2">
                                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 text-primary border border-primary/10 flex-shrink-0 group-hover:scale-105 transition-transform">
                                    <span className="material-icons-round text-2xl">{icon}</span>
                                </div>
                                <div className="min-w-0">
                                    <div className="text-lg font-bold text-text-main-light dark:text-text-main-dark truncate leading-tight">{title}</div>
                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted-light dark:text-text-muted-dark mt-1 font-mono">
                                        <div className="flex items-center gap-1">
                                            <span className="material-icons-round text-[14px]">fingerprint</span>
                                            <span>{shortId(r.id, 8)}</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <span className="material-icons-round text-[14px]">event</span>
                                            <span>{fmtDateTime(r.createdAt)}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col items-center">
                            <div className="text-[10px] text-text-muted-light dark:text-text-muted-dark uppercase tracking-wider font-bold mb-1">SCORE</div>
                            <div className={`inline-flex items-center justify-center w-10 h-10 rounded-full text-sm font-bold border-2 ${scoreClass}`}>
                                {scoreStr}
                            </div>
                        </div>
                        </div>
                    </div>

                    <div className="px-6 pb-4">
                        <div className="bg-background-light dark:bg-background-dark/50 rounded-xl p-4 border border-border-light dark:border-border-dark/50">
                            <p className="text-sm text-text-main-light dark:text-text-muted-dark leading-relaxed line-clamp-2">
                                {(r.summary ?? '').trim() || 'Keine Zusammenfassung verfügbar.'}
                            </p>
                        </div>
                    </div>

                    <div className="px-6 py-3 border-t border-border-light dark:border-border-dark flex justify-end bg-gray-50/50 dark:bg-white/[0.02] rounded-b-2xl">
                        <button
                            className="inline-flex items-center gap-1 text-primary hover:text-primary-hover font-medium text-sm transition-colors group/btn"
                            onClick={() => {
                                const sid = sessionId.trim();
                                if (!sid) return;
                                router.push(`/runs/${encodeURIComponent(sid)}/${encodeURIComponent(r.id)}`);
                            }}
                        >
                            <span>Analyse öffnen</span>
                            <span className="material-icons-round text-lg group-hover/btn:translate-x-1 transition-transform">arrow_forward</span>
                        </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>

      {/* Mobile Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setMobileOpen(false)}></div>
      )}
    </div>
  );
}
