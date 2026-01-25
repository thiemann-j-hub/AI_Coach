'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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

function safeDecode(s: string) {
  let out = String(s ?? '');
  for (let i = 0; i < 2; i++) {
    try {
      const d = decodeURIComponent(out);
      if (d === out) break;
      out = d;
    } catch {
      break;
    }
  }
  return out;
}

/**
 * Accepts:
 * - "uuid"
 * - "sessionId=uuid"
 * - "sessionId%3Duuid"
 * - "sessionId=uuid&foo=bar"
 */
function normalizeSessionId(raw: string) {
  let s = safeDecode(raw).trim();

  // If it looks like a querystring ("a=b&c=d"), parse it.
  if (s.includes('=') && s.includes('&')) {
    try {
      const usp = new URLSearchParams(s);
      const v = usp.get('sessionId') || usp.get('sid') || usp.get('session');
      if (v) s = v;
    } catch {
      // ignore
    }
  }

  // If it contains "sessionId=..."
  const m = s.match(/(?:^|[?&])sessionId=([^&]+)/);
  if (m?.[1]) s = m[1];

  // If it starts with "sessionId="
  if (s.startsWith('sessionId=')) s = s.slice('sessionId='.length);

  return s.trim();
}

function fmtIso(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function scoreLabel(v: number | null | undefined) {
  if (v === null || v === undefined) return '—';
  // support 0-10 or 0-100
  if (v <= 10) return `${v.toFixed(1).replace('.0', '')}/10`;
  return `${Math.round(v)}`;
}

function anyToPretty(v: any) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

function makeErr(message: string, debug?: any) {
  const e: any = new Error(message);
  e.debug = debug;
  return e as Error;
}

async function fetchRuns(sessionId: string): Promise<{ runs: RunsListItem[]; raw: any }> {
  const url = `/api/runs/list?sessionId=${encodeURIComponent(sessionId)}&limit=200&debug=0`;
  const res = await fetch(url);
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const msg = body?.error
      ? (typeof body.error === 'string' ? body.error : anyToPretty(body.error))
      : `HTTP ${res.status}`;
    throw makeErr(msg, { url, status: res.status, body });
  }

  // tolerant parsing of response shapes
  const runs =
    (body?.ok === true && Array.isArray(body?.runs) ? body.runs : null) ??
    (Array.isArray(body?.runs) ? body.runs : null) ??
    (Array.isArray(body?.data) ? body.data : null) ??
    null;

  if (!runs) {
    throw makeErr('Unerwartete Antwort von /api/runs/list', { url, status: res.status, body });
  }

  return { runs, raw: body };
}

export default function RunsListPage({ params }: { params: { sessionId: string } }) {
  const router = useRouter();

  const rawParam = String(params.sessionId ?? '');
  const sessionId = useMemo(() => normalizeSessionId(rawParam), [rawParam]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<Error | null>(null);
  const [errDebug, setErrDebug] = useState<any>(null);
  const [runs, setRuns] = useState<RunsListItem[]>([]);

  // Canonicalize URL + fix localStorage value so navigation becomes stable
  useEffect(() => {
    if (!sessionId) return;

    // write normalized sessionId back to storage (fixes "sessionId=..." pollution)
    try {
      localStorage.setItem('commscoach_sessionId', sessionId);
    } catch {}

    const canonical = encodeURIComponent(sessionId);
    if (rawParam !== canonical && rawParam !== sessionId) {
      router.replace(`/runs/${canonical}`);
    }
  }, [rawParam, sessionId, router]);

  useEffect(() => {
    let alive = true;

    async function load() {
      if (!sessionId) {
        setErr(makeErr('SessionId ist leer/ungültig. Bitte von /analyze aus öffnen.'));
        setLoading(false);
        return;
      }

      setLoading(true);
      setErr(null);
      setErrDebug(null);

      try {
        const { runs } = await fetchRuns(sessionId);
        if (alive) setRuns(Array.isArray(runs) ? runs : []);
      } catch (e: any) {
        if (!alive) return;
        setErr(e instanceof Error ? e : makeErr(String(e ?? 'Fehler')));
        setErrDebug((e as any)?.debug ?? null);
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => { alive = false; };
  }, [sessionId]);

  return (
    <AppShell
      title="Verlauf"
      subtitle={`Session: ${sessionId || '—'}`}
      active="runs"
      sessionId={sessionId || null}
      headerActions={
        <Link
          className="hidden sm:flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 transition"
          href={`/analyze?sessionId=${encodeURIComponent(sessionId || '')}`}
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
            <div className="mt-1 text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">
              {err.message}
            </div>

            <div className="mt-4 flex gap-2">
              <button
                className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition"
                onClick={() => location.reload()}
              >
                Neu laden
              </button>

              <a
                className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition"
                href={`/api/runs/list?sessionId=${encodeURIComponent(sessionId || '')}&limit=20&debug=1`}
                target="_blank"
                rel="noreferrer"
              >
                API ansehen
              </a>
            </div>

            {errDebug ? (
              <details className="mt-4">
                <summary className="cursor-pointer text-xs text-gray-500">Details</summary>
                <pre className="mt-2 text-xs bg-gray-50 dark:bg-slate-900/40 border border-gray-200 dark:border-gray-800 p-3 rounded-xl overflow-auto whitespace-pre-wrap">
{anyToPretty(errDebug)}
                </pre>
              </details>
            ) : null}
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
                href={`/runs/${encodeURIComponent(sessionId)}/${encodeURIComponent(r.id)}`}
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
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
