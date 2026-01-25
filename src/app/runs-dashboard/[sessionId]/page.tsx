'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
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

function fmtIso(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function scoreLabel(v: number | null | undefined) {
  if (v === null || v === undefined) return '—';
  if (v <= 10) return `${v.toFixed(1).replace('.0','')}/10`;
  return `${Math.round(v)}`;
}

export default function RunsDashboardListPage({ params }: { params: { sessionId: string } }) {
  const sessionId = params.sessionId;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunsListItem[]>([]);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setErr(null);
      try {
        const url = `/api/runs/list?sessionId=${encodeURIComponent(sessionId)}&debug=0`;
        const res = await fetch(url);
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j?.ok) {
          throw new Error(j?.error || `HTTP ${res.status}`);
        }
        const list = Array.isArray(j.runs) ? j.runs : [];
        if (alive) setRuns(list);
      } catch (e: any) {
        if (alive) setErr(e?.message || 'Fehler beim Laden');
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [sessionId]);

  const subtitle = useMemo(() => `Session: ${sessionId}`, [sessionId]);

  return (
    <AppShell
      title="Verlauf"
      subtitle={subtitle}
      active="runs"
      sessionId={sessionId}
      headerActions={
        <Link
          className="hidden sm:flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 transition"
          href={`/analyze?sessionId=${encodeURIComponent(sessionId)}`}
        >
          Neue Analyse
        </Link>
      }
    >
      <div className="space-y-4">
        {loading ? (
          <div className="bg-white dark:bg-[#111826] rounded-2xl border border-gray-200 dark:border-gray-800 p-6 text-sm text-gray-500">
            Lädt…
          </div>
        ) : err ? (
          <div className="bg-white dark:bg-[#111826] rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
            <div className="text-sm text-red-600 dark:text-red-400 font-medium">Fehler</div>
            <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">{err}</div>
            <div className="mt-4">
              <button
                className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition"
                onClick={() => location.reload()}
              >
                Neu laden
              </button>
            </div>
          </div>
        ) : runs.length === 0 ? (
          <div className="bg-white dark:bg-[#111826] rounded-2xl border border-gray-200 dark:border-gray-800 p-6 text-sm text-gray-600 dark:text-gray-300">
            Keine Runs gefunden.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {runs.map((r) => (
              <Link
                key={r.id}
                href={`/runs-dashboard/${encodeURIComponent(sessionId)}/${encodeURIComponent(r.id)}`}
                className="bg-white dark:bg-[#111826] rounded-2xl border border-gray-200 dark:border-gray-800 p-5 hover:shadow-md transition"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-xs text-gray-500 dark:text-gray-400">{fmtIso(r.createdAt)}</div>
                    <div className="mt-1 font-bold text-gray-900 dark:text-white truncate">
                      {r.conversationType || 'Analyse'}{r.conversationSubType ? ` · ${r.conversationSubType}` : ''}
                    </div>
                    {r.goal ? (
                      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300 line-clamp-2">
                        Ziel: {r.goal}
                      </div>
                    ) : null}
                  </div>

                  <div className="shrink-0 text-right">
                    <div className="text-xs text-gray-500 dark:text-gray-400">Score</div>
                    <div className="mt-1 inline-flex items-center justify-center px-3 py-1 rounded-lg bg-blue-50 dark:bg-[hsl(var(--primary))/0.10] text-[hsl(var(--primary))] font-bold text-sm tabular-nums">
                      {scoreLabel(r.scoreOverall ?? null)}
                    </div>
                  </div>
                </div>

                {r.summary ? (
                  <div className="mt-4 text-sm text-gray-600 dark:text-gray-300 line-clamp-3">
                    {r.summary}
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                    RunId: {r.id}
                  </span>
                  <span className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                    Transcript: {r.hasTranscript ? 'ja' : 'nein'}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
