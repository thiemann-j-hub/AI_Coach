'use client';

import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';

type AnalyzeRequest = {
  conversationType: string;
  conversationSubType?: string;
  goal?: string;
  transcriptText: string;
  lang?: string;
  jurisdiction?: string;
};

type RunsListItem = {
  id: string;
  createdAt?: string;
  conversationType?: string;
  conversationSubType?: string | null;
  goal?: string | null;
  scoreOverall?: number | null;
  summary?: string | null;
};

const STORAGE_KEY = 'commscoach_sessionId';

function newSessionId(): string {
  // Browser crypto is fine; fallback for older environments
  const c: any = globalThis.crypto as any;
  if (c?.randomUUID) return c.randomUUID();
  return `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function fmtIso(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

export default function AnalyzePage() {
  const [sessionId, setSessionId] = useState('');

  const [conversationType, setConversationType] = useState('feedback');
  const [conversationSubType, setConversationSubType] = useState('kritisch');
  const [goal, setGoal] = useState('klar und fair, ohne Eskalation');
  const [lang, setLang] = useState('de');
  const [jurisdiction, setJurisdiction] = useState('de_eu');

  const [transcriptText, setTranscriptText] = useState('FK: Mir ist aufgefallen ...\nMA: ...');

  const [autoSave, setAutoSave] = useState(true);
  const [storeTranscript, setStoreTranscript] = useState(false);

  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const [runs, setRuns] = useState<RunsListItem[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);

  // init sessionId
  useEffect(() => {
    const existing = localStorage.getItem(STORAGE_KEY);
    const sid = existing && existing.trim() ? existing.trim() : newSessionId();
    localStorage.setItem(STORAGE_KEY, sid);
    setSessionId(sid);
  }, []);

  // persist changes
  useEffect(() => {
    if (sessionId) localStorage.setItem(STORAGE_KEY, sessionId);
  }, [sessionId]);

  const runsListHref = useMemo(() => {
    if (!sessionId) return null;
    return `/runs/${encodeURIComponent(sessionId)}`;
  }, [sessionId]);

  async function refreshRuns() {
    if (!sessionId) return;
    setRunsLoading(true);
    setRunsError(null);

    try {
      const res = await fetch(`/api/runs/list?sessionId=${encodeURIComponent(sessionId)}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? `Runs list failed (${res.status})`);
      }

      setRuns(Array.isArray(json.runs) ? json.runs : []);
    } catch (e: any) {
      setRunsError(e?.message ?? String(e));
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  }

  // initial load after sessionId resolved
  useEffect(() => {
    if (sessionId) refreshRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function onAnalyze() {
    setLoading(true);
    setError(null);

    const req: AnalyzeRequest = {
      conversationType: conversationType.trim(),
      conversationSubType: conversationSubType.trim() || undefined,
      goal: goal.trim() || undefined,
      transcriptText: transcriptText,
      lang: lang.trim() || undefined,
      jurisdiction: jurisdiction.trim() || undefined,
    };

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(req),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ? JSON.stringify(json.error) : `Analyze failed (${res.status})`);
      }

      setAnalysis(json.result ?? null);

      if (autoSave) {
        const saveRes = await fetch('/api/runs/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            sessionId,
            request: req,
            result: json.result ?? null,
            storeTranscript,
          }),
        });

        const saveJson = await saveRes.json().catch(() => null);

        if (!saveRes.ok || !saveJson?.ok) {
          throw new Error(saveJson?.error ?? `Save failed (${saveRes.status})`);
        }

        // after save: refresh list
        await refreshRuns();
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  function clearResult() {
    setAnalysis(null);
    setError(null);
  }

  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: 24, fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Conversation Analysis</h1>

      <div style={{ opacity: 0.8, marginBottom: 16 }}>
        UI → <code>/api/analyze</code> → Ergebnis JSON. Pinecone &amp; Gemini bleiben serverseitig.
      </div>

      <section style={{ border: '1px solid #ddd', borderRadius: 10, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 320 }}>
            <div style={{ fontSize: 12, opacity: 0.8 }}>Session</div>
            <input
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 8 }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={autoSave} onChange={(e) => setAutoSave(e.target.checked)} />
              Auto Save nach Analyse
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={storeTranscript}
                onChange={(e) => setStoreTranscript(e.target.checked)}
              />
              Transkript speichern
            </label>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
          <Field label="conversationType" value={conversationType} onChange={setConversationType} />
          <Field label="conversationSubType (optional)" value={conversationSubType} onChange={setConversationSubType} />
          <Field label="goal (optional)" value={goal} onChange={setGoal} />
          <div />
          <Field label="lang (optional)" value={lang} onChange={setLang} />
          <Field label="jurisdiction (optional)" value={jurisdiction} onChange={setJurisdiction} />
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>transcriptText</div>
          <textarea
            value={transcriptText}
            onChange={(e) => setTranscriptText(e.target.value)}
            rows={8}
            style={{ width: '100%', padding: 10, border: '1px solid #ccc', borderRadius: 8, fontFamily: 'inherit' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <button
            onClick={onAnalyze}
            disabled={loading || !sessionId || !conversationType.trim() || !transcriptText.trim()}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #999', cursor: 'pointer' }}
          >
            {loading ? 'Analysiere…' : 'Analyse starten'}
          </button>

          <button
            onClick={clearResult}
            type="button"
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #999', cursor: 'pointer' }}
          >
            Clear
          </button>

          {runsListHref ? (
            <Link
              href={runsListHref}
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #999', textDecoration: 'none' }}
            >
              Runs öffnen →
            </Link>
          ) : null}
        </div>

        {error ? (
          <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: '#ffecec', border: '1px solid #f3b1b1' }}>
            <strong>Fehler:</strong> <span style={{ whiteSpace: 'pre-wrap' }}>{error}</span>
          </div>
        ) : null}
      </section>

      <section style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Ergebnis</h2>
        {!analysis ? (
          <div style={{ opacity: 0.7 }}>Noch keine Analyse ausgeführt.</div>
        ) : (
          <pre style={{ padding: 12, border: '1px solid #ddd', borderRadius: 10, overflow: 'auto' }}>
{JSON.stringify(analysis, null, 2)}
          </pre>
        )}
      </section>

      <section style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 18, marginBottom: 0 }}>Saved Runs</h2>
          <button
            onClick={refreshRuns}
            disabled={runsLoading || !sessionId}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #999', cursor: 'pointer' }}
          >
            {runsLoading ? 'Lade…' : 'Refresh'}
          </button>
        </div>

        {runsError ? (
          <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: '#fff7e6', border: '1px solid #f1d18a' }}>
            <strong>Hinweis:</strong> <span style={{ whiteSpace: 'pre-wrap' }}>{runsError}</span>
          </div>
        ) : null}

        {runs.length === 0 ? (
          <div style={{ marginTop: 10, opacity: 0.75 }}>Noch keine Runs gespeichert.</div>
        ) : (
          <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
            {runs.map((r) => (
              <div key={r.id} style={{ border: '1px solid #ddd', borderRadius: 10, padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <strong>{r.conversationType ?? '—'}</strong>
                    {r.conversationSubType ? ` · ${r.conversationSubType}` : ''}
                  </div>
                  <div style={{ opacity: 0.75 }}>{fmtIso(r.createdAt)}</div>
                </div>

                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.8 }}>
                  runId: <code>{r.id}</code> · score: <code>{r.scoreOverall ?? '—'}</code>
                </div>

                {r.goal ? <div style={{ marginTop: 6 }}><strong>Ziel:</strong> {r.goal}</div> : null}
                {r.summary ? <div style={{ marginTop: 6, opacity: 0.9 }}>{r.summary}</div> : null}

                <div style={{ marginTop: 10 }}>
                  <Link
                    href={`/runs/${encodeURIComponent(sessionId)}/${encodeURIComponent(r.id)}`}
                    style={{ textDecoration: 'none' }}
                  >
                    Run öffnen →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div style={{ marginTop: 24, opacity: 0.7, fontSize: 12 }}>
        Healthchecks: <code>/api/pinecone-smoke</code> und <code>/api/analyze</code>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 8 }}
      />
    </label>
  );
}
