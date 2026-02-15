import React from "react";
import { notFound } from "next/navigation";

import { getAdminDb } from "@/lib/firebase-admin";
import RunDetailClient from "./RunDetailClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toIso(v: any): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (v?.toDate) {
    try {
      return v.toDate().toISOString();
    } catch {
      return null;
    }
  }
  if (v instanceof Date) return v.toISOString();
  return null;
}

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

export default async function RunDetailPage({
  params,
}: {
  params: { sessionId: string; runId: string };
}) {
  const sessionId = params?.sessionId ?? "";
  const runId = params?.runId ?? "";

  if (!sessionId || !runId) notFound();

  const db = getAdminDb();
  const ref = db
    .collection("sessions")
    .doc(sessionId)
    .collection("runs")
    .doc(runId);

  const snap = await ref.get();
  if (!snap.exists) notFound();

  const data: any = snap.data() ?? {};
  const createdAtIso = toIso(data?.createdAt);
  const createdLabel = formatDe(createdAtIso);

  // ✅ WICHTIG: hier liegt der Report drin (nicht in run.result)
  const analysis: any = (data?.analysisJson ?? data?.result ?? data?.analysis ?? {}) as any;

  const scores =
    typeof analysis?.scores === "object" && analysis?.scores ? analysis.scores : {};

  const overall =
    typeof scores?.overall === "number"
      ? scores.overall
      : typeof data?.scoreOverall === "number"
        ? data.scoreOverall
        : null;

  const resultForDashboard: any = {
    ...analysis,
    summary:
      typeof analysis?.summary === "string"
        ? analysis.summary
        : typeof data?.summary === "string"
          ? data.summary
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
        typeof data?.transcriptText === "string"
          ? data.transcriptText
          : typeof data?.request?.transcriptText === "string"
            ? data.request.transcriptText
            : typeof analysis?.transcriptText === "string"
              ? analysis.transcriptText
              : null,
  };

  return (
    <RunDetailClient 
      runId={runId} 
      sessionId={sessionId} 
      result={resultForDashboard} 
    />
  );
}
