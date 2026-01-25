'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppShell from '@/components/app/app-shell';

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

export default function RunsDashboardClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

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

  const actions = (
    <button
      className="inline-flex items-center gap-2 rounded-xl bg-sky-400 hover:bg-sky-300 text-black px-3 py-2 text-sm font-semibold shadow-lg shadow-sky-400/20"
      onClick={() => {
        const sid = newSessionId();
        try {
          localStorage.setItem(STORAGE_KEY, sid);
        } catch {}
        router.push(`/analyze?sessionId=${encodeURIComponent(sid)}`);
      }}
    >
      <span className="material-symbols-outlined">add</span>
      Neue Sitzung
    </button>
  );

  return (
    <AppShell title="Sitzungsverlauf" subtitle={sessionId ? `Session: ${shortId(sessionId)}` : 'Session: —'} actions={actions}>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Search / Sort */}
        <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
          <div className="relative flex-1">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              search
            </span>
            <input
              className="w-full rounded-2xl bg-[#0B1221] border border-[#1F2937] pl-11 pr-3 py-3 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-sky-400/50 focus:ring-1 focus:ring-sky-400/20"
              placeholder="Suche nach Ziel, ID oder Datum…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-3">
            <select
              className="rounded-2xl bg-[#0B1221] border border-[#1F2937] px-3 py-3 text-sm text-slate-100 outline-none focus:border-sky-400/50"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as any)}
              aria-label="Sortieren"
            >
              <option value="date_desc">Datum (Neueste)</option>
              <option value="date_asc">Datum (Älteste)</option>
              <option value="score_desc">Score (Höchster)</option>
              <option value="score_asc">Score (Niedrigster)</option>
            </select>

            <button
              className="inline-flex items-center gap-2 rounded-2xl bg-[#0B1221] border border-[#1F2937] px-4 py-3 text-sm text-slate-200 hover:bg-white/5"
              onClick={() => setRefresh((x) => x + 1)}
            >
              <span className="material-symbols-outlined">refresh</span>
              Neu laden
            </button>
          </div>
        </div>

        {/* Error */}
        {error ? (
          <div className="bg-[#111826] border border-red-500/30 rounded-2xl p-5 text-red-200">
            <div className="font-semibold mb-1">Fehler</div>
            <div className="text-sm opacity-90 whitespace-pre-wrap">{error}</div>
            <button
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-4 py-2 text-sm hover:bg-white/10"
              onClick={() => setRefresh((x) => x + 1)}
            >
              <span className="material-symbols-outlined">refresh</span>
              Neu laden
            </button>
          </div>
        ) : null}

        {/* Loading */}
        {loading ? (
          <div className="bg-[#111826] border border-[#1F2937] rounded-2xl p-5 text-slate-200">
            <div className="inline-flex items-center gap-2">
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              Lädt…
            </div>
          </div>
        ) : null}

        {/* Empty */}
        {!loading && !error && filtered.length === 0 ? (
          <div className="bg-[#111826] border border-[#1F2937] rounded-2xl p-6 text-slate-200">
            <div className="font-semibold mb-1">Noch keine Runs in dieser Session</div>
            <div className="text-sm text-slate-400">
              Starte eine Analyse – dann erscheinen hier die Ergebnisse.
            </div>
            <button
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-sky-400 hover:bg-sky-300 text-black px-4 py-2 text-sm font-semibold"
              onClick={() => router.push(`/analyze?sessionId=${encodeURIComponent(sessionId || newSessionId())}`)}
            >
              <span className="material-symbols-outlined">analytics</span>
              Neue Analyse
            </button>
          </div>
        ) : null}

        {/* List */}
        <div className="space-y-4">
          {filtered.map((r) => {
            const title =
              (r.goal && r.goal.trim()) ||
              [r.conversationType, r.conversationSubType].filter(Boolean).join(' • ') ||
              'Analyse';

            const score =
              typeof r.scoreOverall === 'number' ? String(Math.round(r.scoreOverall * 10) / 10) : '—';

            return (
              <div
                key={r.id}
                className="bg-[#111826] border border-[#1F2937] rounded-2xl p-5 md:p-6 hover:border-sky-400/40 transition-all"
              >
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-sky-400/10 text-sky-400 border border-sky-400/20">
                        <span className="material-symbols-outlined">mic</span>
                      </span>
                      <div className="min-w-0">
                        <div className="text-lg font-semibold text-white truncate">{title}</div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-400">
                      <div className="inline-flex items-center gap-2">
                        <span className="material-symbols-outlined text-sky-400">fingerprint</span>
                        <span>Nr. {shortId(r.id, 14)}</span>
                      </div>
                      <div className="inline-flex items-center gap-2">
                        <span className="material-symbols-outlined text-sky-400">calendar_today</span>
                        <span>{fmtDateTime(r.createdAt)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end">
                    <div className="text-xs text-slate-400 uppercase tracking-wide font-medium mb-1">Score</div>
                    <div className="inline-flex items-center justify-center px-3 py-1 rounded-full text-base font-bold bg-sky-400/10 text-sky-400 border border-sky-400/20">
                      {score}
                    </div>
                  </div>
                </div>

                <div className="bg-white/5 rounded-xl p-4 mb-4 border border-white/5">
                  <p className="text-sm text-slate-300 leading-relaxed">
                    {(r.summary ?? '').trim() || '—'}
                  </p>
                </div>

                <div className="flex items-center justify-end border-t border-[#1F2937] pt-4">
                  <button
                    className="inline-flex items-center gap-2 text-sky-400 hover:text-white font-medium text-sm"
                    onClick={() => {
                      const sid = sessionId.trim();
                      if (!sid) return;
                      router.push(`/runs/${encodeURIComponent(sid)}/${encodeURIComponent(r.id)}`);
                    }}
                  >
                    Analyse öffnen
                    <span className="material-symbols-outlined">arrow_forward</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
