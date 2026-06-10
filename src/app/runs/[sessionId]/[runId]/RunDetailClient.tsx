"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

import AppShell from "@/components/app/app-shell";
import ReportDashboard from "@/components/app/report-dashboard";
import { authFetch } from "@/lib/api-client";

type RunData = {
  id: string;
  createdAt: string | null;
  conversationType: string | null;
  conversationSubType: string | null;
  goal: string | null;
  lang: string | null;
  transcriptText: string | null;
  analysisJson: any;
  scoreOverall: number | null;
  summary: string | null;
};

function formatDe(iso: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function buildResultForDashboard(run: RunData): any {
  const analysis: any = run.analysisJson ?? {};
  const scores =
    typeof analysis?.scores === "object" && analysis?.scores ? analysis.scores : {};

  const overall =
    typeof scores?.overall === "number"
      ? scores.overall
      : typeof run.scoreOverall === "number"
        ? run.scoreOverall
        : null;

  return {
    ...analysis,
    summary:
      typeof analysis?.summary === "string"
        ? analysis.summary
        : typeof run.summary === "string"
          ? run.summary
          : null,
    scores: { ...scores, overall },
    practice7Days:
      typeof analysis?.practice7Days === "string"
        ? analysis.practice7Days
        : typeof analysis?.sevenDayPractice === "string"
          ? analysis.sevenDayPractice
          : typeof analysis?.practice === "string"
            ? analysis.practice
            : null,
    competency_ratings: Array.isArray(analysis?.competency_ratings)
      ? analysis.competency_ratings
      : Array.isArray(analysis?.competencyRatings)
        ? analysis.competencyRatings
        : Array.isArray(analysis?.competencies)
          ? analysis.competencies
          : [],
    transcriptText:
      typeof run.transcriptText === "string"
        ? run.transcriptText
        : typeof analysis?.transcriptText === "string"
          ? analysis.transcriptText
          : null,
  };
}

export default function RunDetailClient({
  sessionId,
  runId,
}: {
  sessionId: string;
  runId: string;
}) {
  const [run, setRun] = useState<RunData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const url = `/api/runs/get?sessionId=${encodeURIComponent(sessionId)}&runId=${encodeURIComponent(runId)}`;
        const res = await authFetch(url);
        const j = await res.json().catch(() => null);
        if (!res.ok || !j?.ok) {
          const code = j?.code ?? res.status;
          if (res.status === 403) throw new Error("Kein Zugriff auf diese Analyse.");
          if (res.status === 404) throw new Error("Analyse nicht gefunden.");
          throw new Error(typeof j?.error === "string" ? j.error : `Fehler (${code})`);
        }
        if (!cancelled) setRun(j.run as RunData);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Unbekannter Fehler");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, runId]);

  const createdLabel = formatDe(run?.createdAt ?? null);

  const metaChips: { label: string; value: string }[] = [];
  if (run?.conversationType) metaChips.push({ label: "Typ", value: String(run.conversationType) });
  if (run?.conversationSubType) metaChips.push({ label: "Sub", value: String(run.conversationSubType) });
  if (run?.goal) metaChips.push({ label: "Ziel", value: String(run.goal) });

  return (
    <AppShell
      title="Meeting Analyse"
      subtitle={createdLabel ? `Bericht · ${createdLabel}` : undefined}
    >
      <div className="p-4 md:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex items-center justify-between gap-3">
            <Link
              href="/runs-dashboard"
              className="text-sm text-primary hover:text-primary/80 transition-colors"
            >
              ← Zurück zum Verlauf
            </Link>
            <div className="text-xs text-muted-foreground font-mono">Session: {sessionId}</div>
          </div>

          {loading && (
            <div className="glass-panel rounded-2xl p-8 text-sm text-muted-foreground animate-pulse">
              Analyse wird geladen…
            </div>
          )}

          {!loading && error && (
            <div className="glass-panel rounded-2xl p-8 text-sm text-red-400 border border-red-500/20">
              {error}
            </div>
          )}

          {!loading && !error && run && (
            <ReportDashboard
              result={buildResultForDashboard(run)}
              metaChips={metaChips}
              conversationType={run.conversationType ?? undefined}
              lang={run.lang ?? undefined}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}
