"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function RunDetailPage({ params }: { params: { sessionId: string; runId: string } }) {
  const { sessionId, runId } = params;

  const [run, setRun] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);

    try {
      const res = await fetch(
        `/api/runs/get?sessionId=${encodeURIComponent(sessionId)}&runId=${encodeURIComponent(runId)}`,
        { cache: "no-store" }
      );
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(
          (json && (json.error?.message || json.error || json.message)) ||
            `HTTP ${res.status}`
        );
      }

      setRun(json?.run ?? null);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setRun(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, runId]);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Run Detail</h1>
          <div className="text-xs opacity-70 font-mono break-all">
            {sessionId} / {runId}
          </div>
        </div>

        <div className="flex gap-2">
          <Link className="border rounded px-3 py-1 text-sm" href={`/runs/${encodeURIComponent(sessionId)}`}>
            Zurück
          </Link>
          <button className="border rounded px-3 py-1 text-sm" onClick={load} disabled={loading}>
            {loading ? "…" : "Refresh"}
          </button>
        </div>
      </div>

      {err && (
        <div className="border border-red-300 bg-red-50 text-red-900 rounded p-3 text-sm">
          Fehler: {err}
        </div>
      )}

      {!run ? (
        <div className="text-sm opacity-70">
          {loading ? "Lade…" : "Keine Daten."}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="border rounded p-3">
            <div className="text-xs opacity-70">createdAt</div>
            <div className="font-mono text-sm">{run.createdAt ?? "—"}</div>
          </div>

          <div className="border rounded p-3">
            <div className="text-xs opacity-70">summary</div>
            <div className="text-sm">{run.summary ?? "—"}</div>
          </div>

          <details className="border rounded p-3">
            <summary className="cursor-pointer text-sm font-semibold">analysisJson</summary>
            <pre className="text-xs overflow-auto mt-2">{JSON.stringify(run.analysisJson ?? {}, null, 2)}</pre>
          </details>

          <details className="border rounded p-3">
            <summary className="cursor-pointer text-sm font-semibold">ragContext</summary>
            <pre className="text-xs overflow-auto mt-2">{JSON.stringify(run.ragContext ?? {}, null, 2)}</pre>
          </details>

          {run.transcriptText ? (
            <details className="border rounded p-3">
              <summary className="cursor-pointer text-sm font-semibold">transcriptText</summary>
              <pre className="text-xs overflow-auto mt-2 whitespace-pre-wrap">{run.transcriptText}</pre>
            </details>
          ) : (
            <div className="text-xs opacity-70">
              transcriptText nicht gespeichert (Option “Transkript speichern” war aus).
            </div>
          )}
        </div>
      )}
    </div>
  );
}
