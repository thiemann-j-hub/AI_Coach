'use client';

import React, { useEffect, useMemo, useState, useDeferredValue } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Plus,
  Search,
  ChevronDown,
  RefreshCw,
  AlertCircle,
  History,
  PlusCircle,
  Fingerprint,
  CalendarDays,
  ArrowRight,
  Banknote,
  Rocket,
  Mic,
  UserSearch,
  MessagesSquare,
  MessageSquare,
  type LucideIcon,
} from 'lucide-react';
import AppShell from '@/components/app/app-shell';
import { authFetch } from '@/lib/api-client';
import { STORAGE_KEY_SESSION as STORAGE_KEY, migrateLegacyStorageKeys } from '@/lib/storage-keys';
import { useTranslation } from '@/i18n/useTranslation';

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

/** Simulations-Zeile der gemeinsamen Historie (W1-6, /api/simulation/list). */
type SimListItem = {
  id: string;
  scenarioId: string;
  scenarioTitle: string;
  personaName: string | null;
  status: 'active' | 'finished';
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  attempt: number;
  overall: number | null;
  verdict: 'passed' | 'failed' | 'unrated' | null;
};

/**
 * Gemeinsamer Eintrag beider Wege (W1-8: EINE Skalensprache — Anzeige in %;
 * `scoreOverall` 0–10 bleibt unverändert persistiert, nur die Darstellung
 * rechnet ×10 um).
 */
type HistoryItem =
  | { kind: 'run'; id: string; ts: number; pct: number | null; run: RunsListItem }
  | { kind: 'sim'; id: string; ts: number; pct: number | null; sim: SimListItem };

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
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return d.toISOString(); }
}

async function readErrorText(res: Response) {
  const t = await res.text();
  try {
    const j = JSON.parse(t);
    return String(j?.error || j?.message || t || res.statusText);
  } catch { return String(t || res.statusText); }
}

function getIconForTitle(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('gehalt') || t.includes('verhandlung')) return 'payments';
  if (t.includes('ziel') || t.includes('planung') || t.includes('strategy')) return 'rocket_launch';
  if (t.includes('feedback') || t.includes('kritik')) return 'mic';
  if (t.includes('interview') || t.includes('bewerbung')) return 'person_search';
  return 'forum';
}

const ICON_MAP: Record<string, LucideIcon> = {
  payments: Banknote,
  rocket_launch: Rocket,
  mic: Mic,
  person_search: UserSearch,
  forum: MessagesSquare,
};

/** Farbe nach Prozentwert (W1-8: einheitliche 0–100-%-Darstellung). */
function getScoreColor(pct: number | null): string {
  if (pct === null || pct === undefined) return 'bg-foreground/5 text-muted-foreground border-border';
  if (pct >= 90) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
  if (pct >= 80) return 'bg-accent/15 text-accent border-accent/30';
  if (pct >= 70) return 'bg-primary/15 text-primary border-primary/30';
  return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
}

export default function RunsDashboardClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslation();

  const [sessionId, setSessionId] = useState<string>('');
  const [runs, setRuns] = useState<RunsListItem[]>([]);
  const [sims, setSims] = useState<SimListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [sortKey, setSortKey] = useState<'date_desc' | 'date_asc' | 'score_desc' | 'score_asc'>('date_desc');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    migrateLegacyStorageKeys(); // Alt-Key (commscoach_sessionId) -> coach_sessionId, damit laufende Sessions nicht abreißen
    const urlSid = searchParams.get('sessionId');
    if (urlSid && urlSid.trim()) {
      setSessionId(urlSid.trim());
      try { localStorage.setItem(STORAGE_KEY, urlSid.trim()); } catch {}
      return;
    }
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && stored.trim()) {
        setSessionId(stored.trim());
        router.replace(`/runs-dashboard?sessionId=${encodeURIComponent(stored.trim())}`);
      }
    } catch {}
  }, [searchParams, router]);

  useEffect(() => {
    const sid = sessionId.trim();
    if (!sid) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await authFetch(`/api/runs/list?sessionId=${encodeURIComponent(sid)}&limit=50`);
        // Fremde oder ungueltige Session (Owner-Fund 04.08.: alter localStorage-
        // Wert eines anderen Kontos → dauerhaft rote "Zugriff verweigert"-Wand):
        // still auf eine FRISCHE Session rotieren statt in der Sackgasse zu enden.
        if (res.status === 403 || res.status === 400) {
          const fresh = newSessionId();
          try { localStorage.setItem(STORAGE_KEY, fresh); } catch {}
          if (!cancelled) {
            setRuns([]);
            setHasMore(false);
            setNextCursor(null);
            router.replace(`/runs-dashboard?sessionId=${encodeURIComponent(fresh)}`);
          }
          return;
        }
        if (!res.ok) throw new Error(await readErrorText(res));
        const j = await res.json();
        if (!j?.ok) throw new Error(String(j?.error || t.dashboard.errorLoading));
        const list = Array.isArray(j?.runs) ? (j.runs as RunsListItem[]) : [];
        if (!cancelled) {
          setRuns(list);
          setHasMore(Boolean(j?.hasMore));
          setNextCursor(typeof j?.nextCursor === 'string' ? j.nextCursor : null);
        }
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message || e || t.dashboard.unknownError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [sessionId, refresh, t]);

  // W1-6: Simulations-Historie dazuladen (User-gebunden, unabhängig von der
  // Session). Fail-soft: ohne Simulation-Feature bleibt die Liste einfach leer.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch('/api/simulation/list?limit=50');
        if (!res.ok) return;
        const j = await res.json().catch(() => null);
        if (!j?.ok || !Array.isArray(j.items)) return;
        if (!cancelled) setSims(j.items as SimListItem[]);
      } catch {
        /* Simulationen sind Zusatz — Analyse-Historie bleibt nutzbar. */
      }
    })();
    return () => { cancelled = true; };
  }, [refresh]);

  async function loadMore() {
    const sid = sessionId.trim();
    if (!sid || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await authFetch(
        `/api/runs/list?sessionId=${encodeURIComponent(sid)}&limit=50&cursor=${encodeURIComponent(nextCursor)}`
      );
      if (!res.ok) throw new Error(await readErrorText(res));
      const j = await res.json();
      if (!j?.ok) throw new Error(String(j?.error || t.dashboard.errorLoading));
      const list = Array.isArray(j?.runs) ? (j.runs as RunsListItem[]) : [];
      setRuns((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...list.filter((r) => !seen.has(r.id))];
      });
      setHasMore(Boolean(j?.hasMore));
      setNextCursor(typeof j?.nextCursor === 'string' ? j.nextCursor : null);
    } catch (e: any) {
      setError(String(e?.message || e || t.dashboard.unknownError));
    } finally {
      setLoadingMore(false);
    }
  }

  // W1-6: Analysen UND Simulationen in EINER Liste — Suche/Sortierung wie
  // bestehend, Score-Vergleich einheitlich in Prozent (W1-8).
  const filtered = useMemo(() => {
    const toTs = (iso?: string) => {
      const d = iso ? new Date(iso).getTime() : 0;
      return Number.isFinite(d) ? d : 0;
    };
    let list: HistoryItem[] = [
      ...runs.map((r): HistoryItem => ({
        kind: 'run',
        id: `run:${r.id}`,
        ts: toTs(r.createdAt),
        pct: typeof r.scoreOverall === 'number' ? Math.round(r.scoreOverall * 10) : null,
        run: r,
      })),
      ...sims.map((s): HistoryItem => ({
        kind: 'sim',
        id: `sim:${s.id}`,
        ts: toTs(s.createdAt),
        pct: typeof s.overall === 'number' ? Math.round(s.overall) : null,
        sim: s,
      })),
    ];
    const q = deferredQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((it) => {
        const hay =
          it.kind === 'run'
            ? [it.run.id, it.run.goal, it.run.summary, it.run.createdAt, it.run.conversationType, it.run.conversationSubType ?? '']
            : [it.sim.id, it.sim.scenarioTitle, it.sim.personaName ?? '', it.sim.createdAt, it.sim.status];
        return hay.filter(Boolean).join(' ').toLowerCase().includes(q);
      });
    }
    const score = (x: HistoryItem) => (typeof x.pct === 'number' ? x.pct : -1);
    switch (sortKey) {
      case 'date_asc': list.sort((a, b) => a.ts - b.ts); break;
      case 'score_desc': list.sort((a, b) => score(b) - score(a)); break;
      case 'score_asc': list.sort((a, b) => score(a) - score(b)); break;
      case 'date_desc': default: list.sort((a, b) => b.ts - a.ts); break;
    }
    return list;
  }, [runs, sims, deferredQuery, sortKey]);

  const headerActions = (
    <button
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card border border-border text-muted-foreground text-sm hover:border-primary/30 hover:text-foreground transition-colors"
      onClick={() => {
        const sid = newSessionId();
        try { localStorage.setItem(STORAGE_KEY, sid); } catch {}
        router.push(`/analyze?sessionId=${encodeURIComponent(sid)}`);
      }}
    >
      <Plus className="h-4 w-4" />
      <span>{t.dashboard.newSession}</span>
    </button>
  );

  return (
    <AppShell
      title={t.dashboard.title}
      subtitle={`Session: ${shortId(sessionId)}`}
      actions={headerActions}
    >
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Search & Sort */}
        <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
          <div className="relative flex-1">
            <Search className="h-5 w-5 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              className="w-full rounded-xl bg-card border border-border pl-12 pr-4 py-3 text-sm text-foreground placeholder-muted-foreground/60 outline-none focus:border-primary/30 focus:ring-1 focus:ring-primary/20 transition-all"
              placeholder={t.dashboard.searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <select
                className="appearance-none rounded-xl bg-card border border-border pl-4 pr-10 py-3 text-sm text-foreground outline-none focus:border-primary/30 focus:ring-1 focus:ring-primary/20 cursor-pointer transition-all"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as any)}
                aria-label={t.dashboard.sort}
              >
                <option value="date_desc">{t.dashboard.sortNewest}</option>
                <option value="date_asc">{t.dashboard.sortOldest}</option>
                <option value="score_desc">{t.dashboard.sortHighest}</option>
                <option value="score_asc">{t.dashboard.sortLowest}</option>
              </select>
              <ChevronDown className="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            </div>

            <button
              className="inline-flex items-center gap-2 rounded-xl bg-card border border-border px-4 py-3 text-sm text-muted-foreground hover:text-foreground hover:border-primary/20 transition-all"
              onClick={() => setRefresh((x) => x + 1)}
            >
              <RefreshCw className="h-4 w-4" />
              <span className="hidden sm:inline">{t.common.reload}</span>
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-5 text-red-400">
            <div className="font-semibold mb-1 flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              {t.common.error}
            </div>
            <div className="text-sm opacity-90 whitespace-pre-wrap">{error}</div>
            <button
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-foreground/5 border border-red-500/20 px-4 py-2 text-sm hover:bg-white/10 transition-colors"
              onClick={() => setRefresh((x) => x + 1)}
            >
              <RefreshCw className="h-4 w-4" />
              {t.common.reload}
            </button>
          </div>
        )}

        {/* Loading Skeleton */}
        {loading && (
          <div className="space-y-4" aria-busy="true" aria-label={t.dashboard.loadingHistory}>
            {[1, 2, 3].map((i) => (
              <div key={i} className="glass-panel rounded-2xl overflow-hidden animate-pulse">
                <div className="p-6 pb-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-4 flex-1">
                      <div className="w-12 h-12 rounded-full bg-foreground/10 flex-shrink-0" />
                      <div className="flex-1 space-y-2">
                        <div className="h-5 bg-foreground/10 rounded-lg w-3/5" />
                        <div className="h-3 bg-foreground/5 rounded w-2/5" />
                      </div>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-foreground/10" />
                  </div>
                </div>
                <div className="px-6 pb-4">
                  <div className="bg-background/50 rounded-xl p-4 border border-border space-y-2">
                    <div className="h-3 bg-foreground/5 rounded w-full" />
                    <div className="h-3 bg-foreground/5 rounded w-4/5" />
                  </div>
                </div>
                <div className="px-6 py-3 border-t border-border bg-background/30 rounded-b-2xl">
                  <div className="h-4 bg-foreground/5 rounded w-24 ml-auto" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty */}
        {!loading && !error && filtered.length === 0 && (
          <div className="glass-panel rounded-2xl p-10 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
              <History className="h-7 w-7" />
            </div>
            <h3 className="font-bold text-lg text-foreground mb-2">{t.dashboard.noAnalyses}</h3>
            <div className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
              {t.dashboard.noAnalysesHint}
            </div>
            <button
              className="btn-gradient text-white px-6 py-3 rounded-xl text-sm font-semibold shadow-neon inline-flex items-center gap-2 hover:shadow-neon-hover transition-all"
              onClick={() => router.push(`/analyze?sessionId=${encodeURIComponent(sessionId || newSessionId())}`)}
            >
              <PlusCircle className="h-5 w-5" />
              {t.nav.newAnalysis}
            </button>
          </div>
        )}

        {/* Gemeinsame Historie: Analysen UND Rollenspiele (W1-6) */}
        <div className="space-y-4">
          {filtered.map((it) => {
            const isRun = it.kind === 'run';
            const title = isRun
              ? (it.run.goal && it.run.goal.trim()) ||
                [it.run.conversationType, it.run.conversationSubType].filter(Boolean).join(' · ') ||
                t.nav.analyze
              : it.sim.scenarioTitle;
            const scoreStr = it.pct !== null ? `${it.pct} %` : '—';
            const scoreClass = getScoreColor(it.pct);
            const IconComp = isRun
              ? ICON_MAP[getIconForTitle(title)] ?? MessageSquare
              : MessagesSquare;
            const createdAt = isRun ? it.run.createdAt : it.sim.createdAt;
            const summary = isRun
              ? (it.run.summary ?? '').trim() || t.dashboard.noSummary
              : [
                  it.sim.personaName,
                  `${t.simulation.attemptLabel} ${it.sim.attempt}`,
                  `${it.sim.turnCount} ${t.simulation.turnsLabel}`,
                  it.sim.status === 'active' ? t.simulation.statusActive : t.simulation.statusFinished,
                ]
                  .filter(Boolean)
                  .join(' · ');

            return (
              <div
                key={it.id}
                className="group glass-panel rounded-2xl overflow-hidden transition-all hover:border-primary/20 hover:shadow-primary-glow"
              >
                <div className="p-6 pb-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-4 mb-2">
                        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 text-primary border border-primary/10 flex-shrink-0 group-hover:scale-105 transition-transform">
                          <IconComp className="h-6 w-6" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="text-lg font-bold text-foreground truncate leading-tight">{title}</div>
                            {/* Typ-Badge mit Bindungs-Tooltip (Session vs. Konto) */}
                            <span
                              title={isRun ? t.dashboard.bindingTooltipRun : t.dashboard.bindingTooltipSim}
                              className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${
                                isRun
                                  ? 'bg-primary/10 text-primary border-primary/20'
                                  : 'bg-accent/10 text-accent border-accent/20'
                              }`}
                            >
                              {isRun ? t.dashboard.typeAnalysis : t.dashboard.typeSim}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1 font-mono">
                            <div className="flex items-center gap-1">
                              <Fingerprint className="h-3.5 w-3.5" />
                              <span>{shortId(isRun ? it.run.id : it.sim.id, 8)}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <CalendarDays className="h-3.5 w-3.5" />
                              <span>{fmtDateTime(createdAt)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-center">
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold mb-1">{t.dashboard.score}</div>
                      <div className={`inline-flex items-center justify-center min-w-10 h-10 px-1.5 rounded-full text-xs font-bold border tabular-nums ${scoreClass}`}>
                        {scoreStr}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="px-6 pb-4">
                  <div className="bg-background/50 rounded-xl p-4 border border-border">
                    <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
                      {summary}
                    </p>
                  </div>
                </div>

                <div className="px-6 py-3 border-t border-border flex justify-end bg-background/30 rounded-b-2xl">
                  <button
                    className="inline-flex items-center gap-1 text-primary hover:text-primary/80 font-medium text-sm transition-colors group/btn"
                    onClick={() => {
                      if (isRun) {
                        const sid = sessionId.trim();
                        if (!sid) return;
                        router.push(`/runs/${encodeURIComponent(sid)}/${encodeURIComponent(it.run.id)}`);
                      } else if (it.sim.status === 'finished') {
                        // W1-7: die Auswertung hat eine eigene Adresse.
                        router.push(`/simulation/${encodeURIComponent(it.sim.id)}`);
                      } else {
                        // Offene Läufe werden am Einstieg fortgesetzt.
                        router.push('/');
                      }
                    }}
                  >
                    <span>
                      {isRun
                        ? t.dashboard.openAnalysis
                        : it.sim.status === 'finished'
                          ? t.dashboard.openSim
                          : t.entry.resumeTitle}
                    </span>
                    <ArrowRight className="h-5 w-5 group-hover/btn:translate-x-1 transition-transform" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Load More */}
        {!loading && !error && hasMore && (
          <div className="flex justify-center pt-2">
            <button
              className="inline-flex items-center gap-2 rounded-xl bg-card border border-border px-6 py-3 text-sm text-muted-foreground hover:text-foreground hover:border-primary/20 transition-all disabled:opacity-60"
              onClick={loadMore}
              disabled={loadingMore}
            >
              <RefreshCw className={`h-4 w-4 ${loadingMore ? 'animate-spin' : ''}`} />
              {loadingMore ? t.dashboard.loadingMore : t.dashboard.loadMore}
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
