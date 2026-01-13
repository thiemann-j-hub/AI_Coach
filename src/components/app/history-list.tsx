'use client';

import Link from 'next/link';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

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

type RunsListResponse = {
  ok: boolean;
  runs?: RunsListItem[];
  error?: string;
};

const STORAGE_KEY = 'commscoach_sessionId';

function newSessionId(): string {
  const c: any = globalThis.crypto as any;
  if (c?.randomUUID) return c.randomUUID();
  return `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getOrCreateSessionId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing && existing.trim()) return existing;
    const id = newSessionId();
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    // Fallback (z.B. wenn localStorage blockiert ist)
    return 'dev-session';
  }
}

function fmtIso(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

export type HistoryListProps = {
  sessionId?: string;
  limit?: number;
  className?: string;
};

function HistoryList(props: HistoryListProps) {
  const { sessionId: sessionIdProp, limit = 20, className } = props;

  const [sessionId, setSessionId] = useState<string | null>(sessionIdProp ?? null);
  const [runs, setRuns] = useState<RunsListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // SessionId nur im Browser holen
  useEffect(() => {
    if (sessionIdProp) {
      setSessionId(sessionIdProp);
      return;
    }
    setSessionId(getOrCreateSessionId());
  }, [sessionIdProp]);

  const fetchRuns = useCallback(async () => {
    if (!sessionId) return;

    setLoading(true);
    setError(null);

    try {
      const url = `/api/runs/list?sessionId=${encodeURIComponent(sessionId)}`;
      const res = await fetch(url, { method: 'GET' });

      const text = await res.text();
      let data: RunsListResponse;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Antwort ist kein JSON (HTTP ${res.status}): ${text.slice(0, 120)}`);
      }

      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const list = Array.isArray(data.runs) ? data.runs : [];
      setRuns(list);
    } catch (e: any) {
      setError(e?.message ?? 'Unbekannter Fehler');
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const shown = useMemo(() => runs.slice(0, Math.max(1, limit)), [runs, limit]);

  return (
    <div className={className}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h3 style={{ margin: 0 }}>History</h3>
        <button
          type="button"
          onClick={fetchRuns}
          style={{ padding: '6px 10px', border: '1px solid #ddd', borderRadius: 6, background: '#fff', cursor: 'pointer' }}
        >
          Aktualisieren
        </button>
      </div>

      <div style={{ marginTop: 12, fontSize: 13, color: '#666' }}>
        Session: <code>{sessionId ?? '—'}</code>
      </div>

      {loading && <div style={{ marginTop: 12 }}>Lade…</div>}

      {!loading && error && (
        <div style={{ marginTop: 12, color: '#b00020' }}>
          Fehler beim Laden der History: {error}
          <div style={{ marginTop: 6, color: '#666' }}>
            Tipp: Wenn du vorher Firestore direkt genutzt hast, kommen hier oft „Missing or insufficient permissions“.
            Mit dieser Version kommt alles über <code>/api/runs/list</code>.
          </div>
        </div>
      )}

      {!loading && !error && shown.length === 0 && (
        <div style={{ marginTop: 12, color: '#666' }}>
          Keine Runs gefunden (für diese Session).
        </div>
      )}

      {!loading && !error && shown.length > 0 && (
        <ul style={{ marginTop: 12, paddingLeft: 18 }}>
          {shown.map((r) => (
            <li key={r.id} style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 600 }}>
                <Link href={`/runs/${encodeURIComponent(sessionId ?? '')}/${encodeURIComponent(r.id)}`}>
                  {r.conversationType ?? 'run'}{r.conversationSubType ? ` / ${r.conversationSubType}` : ''} — {r.id}
                </Link>
              </div>
              <div style={{ fontSize: 13, color: '#666' }}>
                {fmtIso(r.createdAt)} · Score: {r.scoreOverall ?? '—'}
              </div>
              {r.summary && (
                <div style={{ fontSize: 13, color: '#333', marginTop: 4 }}>
                  {r.summary}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default HistoryList;
export { HistoryList };
