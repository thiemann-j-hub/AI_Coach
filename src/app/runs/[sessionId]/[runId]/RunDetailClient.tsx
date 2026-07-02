"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

import AppShell from "@/components/app/app-shell";
import ReportDashboard from "@/components/app/report-dashboard";
import { type PreviousComparison } from "@/components/app/delta-card";
import { DeleteRunButton } from "@/components/app/delete-run-button";
import { authFetch } from "@/lib/api-client";
import { useTranslation } from "@/i18n/useTranslation";
import { localeBcp47, type Locale } from "@/i18n/config";

type RunData = {
  id: string;
  createdAt: string | null;
  conversationType: string | null;
  conversationSubType: string | null;
  goal: string | null;
  lang: string | null;
  transcriptText: string | null;
  analysisJson: any;
  ragContext: any;
  scoreOverall: number | null;
  summary: string | null;
  rating: number | null;
};

function formatDate(iso: string | null, bcp47: string): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleString(bcp47, {
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
    rag_error:
      typeof analysis?.rag_error === "string"
        ? analysis.rag_error
        : typeof run.ragContext?.error === "string"
          ? run.ragContext.error
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
  const { t, locale } = useTranslation();
  const [run, setRun] = useState<RunData | null>(null);
  // Entwicklung seit letzter Messung (Server-berechnet, radar-contract 1–4) — P0-1.
  const [previousComparison, setPreviousComparison] = useState<PreviousComparison | null>(null);
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
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
          // Fehler-CODES speichern, Übersetzung erst beim Rendern (Sprachwechsel-fest)
          if (res.status === 403) throw new Error("__forbidden__");
          if (res.status === 404) throw new Error("__notfound__");
          const code = j?.code ?? res.status;
          throw new Error(typeof j?.error === "string" ? j.error : `Error (${code})`);
        }
        if (!cancelled) {
          setRun(j.run as RunData);
          setPreviousComparison(j.previousComparison ?? null);
          setPaymentsEnabled(j.paymentsEnabled === true);
        }
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

  const bcp47 = localeBcp47[locale as Locale] ?? "en-US";
  const createdLabel = formatDate(run?.createdAt ?? null, bcp47);

  const metaChips: { label: string; value: string }[] = [];
  if (run?.conversationType) metaChips.push({ label: t.report.type, value: String(run.conversationType) });
  if (run?.conversationSubType) metaChips.push({ label: t.report.subType, value: String(run.conversationSubType) });
  if (run?.goal) metaChips.push({ label: t.report.goal, value: String(run.goal) });

  const errorText =
    error === "__forbidden__" ? t.report.accessDenied :
    error === "__notfound__" ? t.report.runNotFound :
    error;

  return (
    <AppShell
      title={t.report.title}
      subtitle={createdLabel ? `${t.report.reportLabel} · ${createdLabel}` : undefined}
    >
      <div className="p-4 md:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex items-center justify-between gap-3">
            <Link
              href="/runs-dashboard"
              className="text-sm text-primary hover:text-primary/80 transition-colors"
            >
              {t.report.backToHistory}
            </Link>
            <div className="flex items-center gap-4">
              <div className="hidden sm:block text-xs text-muted-foreground font-mono">
                {t.common.session}: {sessionId}
              </div>
              {run && (
                <DeleteRunButton
                  sessionId={sessionId}
                  runId={runId}
                  createdAt={run.createdAt}
                  paymentsEnabled={paymentsEnabled}
                />
              )}
            </div>
          </div>

          {loading && (
            <div className="glass-panel rounded-2xl p-8 text-sm text-muted-foreground animate-pulse">
              {t.report.loadingRun}
            </div>
          )}

          {!loading && errorText && (
            <div className="glass-panel rounded-2xl p-8 text-sm text-red-400 border border-red-500/20">
              {errorText}
            </div>
          )}

          {!loading && !error && run && (
            <ReportDashboard
              result={buildResultForDashboard(run)}
              metaChips={metaChips}
              conversationType={run.conversationType ?? undefined}
              lang={run.lang ?? undefined}
              sessionId={sessionId}
              runId={runId}
              initialRating={run.rating}
              previousComparison={previousComparison}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}
