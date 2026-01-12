"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type RunListItem = {
  id: string;
  createdAt: string | null;
  conversationType: string | null;
  conversationSubType: string | null;
  goal: string | null;
  scoreOverall: number | null;
  summary: string | null;
  hasTranscript: boolean;
};

export default function SessionRunsPage({ params }: { params: { sessionId: string } }) {
  const sessionId = params.sessionId;

  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);

    try {
      const res = await fetch(`/api/runs/list?sessionId=${encodeURIComponent(sessionId)}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(
          (json && (json.error?.message || json.error || json.message)) ||
            `HTTP ${res.status}`
        );
      }

      setRuns(Array.isArray(json?.runs) ? json.runs : []);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Runs</h1>
          <div className="text-xs opacity-70 font-mono break-all">{sessionId}</div>
        </div>

        <div className="flex gap-2">
          <Link className="border rounded px-3 py-1 text-sm" href={`/analyze?sessionId=${encodeURIComponent(sessionId)}`}>
            Zur Analyse
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

      {runs.length === 0 ? (
        <div className="text-sm opacity-70">Keine Runs gefunden.</div>
      ) : (
        <div className="space-y-2">
          {runs.map((r) => (
            <div key={r.id} className="border rounded p-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div>
                  <div className="font-mono text-xs opacity-70">{r.id}</div>
                  <div className="font-semibold">
                    {r.conversationType ?? "—"}
                    {r.conversationSubType ? ` · ${r.conversationSubType}` : ""}
                  </div>
                  <div className="text-xs opacity-70">
                    {r.createdAt ?? "—"} · Score:{" "}
                    {typeof r.scoreOverall === "number" ? r.scoreOverall : "—"}
                    {r.hasTranscript ? " · Transcript: yes" : ""}
                  </div>
                  <div className="text-sm mt-1 opacity-90">{r.summary ?? "—"}</div>
                </div>

                <Link
                  className="border rounded px-3 py-1 text-sm"
                  href={`/runs/${encodeURIComponent(sessionId)}/${encodeURIComponent(r.id)}`}
                >
                  Öffnen
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
