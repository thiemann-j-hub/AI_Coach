import "server-only";

import { radarEventsContainer, upsertItem } from "@/lib/cosmos";
import { logger } from "@/lib/logger";

/**
 * Radar-Measurement-Emit (gelockter Signal-Vertrag) — Coach schreibt nach jeder
 * Analyse EIN append-only `measurement`-Signal in den zentralen Radar-Store
 * (`radar-events`, DB `pulsecraft`, pk /workspaceId). Der Hub liest GENAU dieses
 * Dokument (filtert Score-Reads hart auf `type='measurement'`).
 *
 * ZWEI HARTE REGELN:
 *  1) `ts` kommt IMMER aus dem Run-`createdAt` — NIE new Date()/Date.now() (sonst
 *     springt ein Re-Emit/Backfill den Punkt auf der Timeline nach vorn).
 *  2) `type:"measurement"` ist Pflicht.
 * Nicht beobachtbare Kompetenzen bleiben `null` (NICHT 0); mind. ein Wert muss
 * eine Zahl sein. Idempotent ueber doc-id `coach:<runId>`. Fail-soft (wirft nie).
 */

const KEYS = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"] as const;

type Rating = { id?: string; score?: number | null } | null | undefined;

export function buildMetrics(
  ratings: Rating[] | null | undefined,
  scoreOverall: number | null | undefined
): Record<string, number | null> {
  const m: Record<string, number | null> = Object.fromEntries(KEYS.map((k) => [k, null]));
  for (const r of ratings ?? []) {
    if (r?.id && (KEYS as readonly string[]).includes(r.id)) {
      m[r.id] = typeof r.score === "number" && Number.isFinite(r.score) ? r.score : null;
    }
  }
  const present = KEYS.map((k) => m[k]).filter((v): v is number => typeof v === "number");
  const mean = present.length
    ? Math.round((present.reduce((a, b) => a + b, 0) / present.length) * 10) / 10
    : null;
  // overall = der echte Gesamtscore, NUR wenn er auf der 1–4-Skala liegt; sonst
  // der Mittelwert der vorhandenen Kompetenzen (alte Runs trugen 0–10-Scores).
  m.overall =
    typeof scoreOverall === "number" && scoreOverall >= 1 && scoreOverall <= 4 ? scoreOverall : mean;
  return m;
}

export interface CoachMeasurementInput {
  workspaceId: string | null | undefined;
  subjectId: string | null | undefined; // Entra-oid (NICHT uid)
  runId: string | null | undefined;
  createdAt: string | null | undefined; // = Run-createdAt (ISO), NIE generieren
  competency_ratings: Rating[] | null | undefined;
  scoreOverall: number | null | undefined;
}

export async function emitCoachMeasurement(a: CoachMeasurementInput): Promise<boolean> {
  if (process.env.RADAR_EMIT_ENABLED !== "on") return false; // dark by default → komplett inert
  if (!a.workspaceId || !a.subjectId || !a.runId || !a.createdAt) return false;

  const metrics = buildMetrics(a.competency_ratings, a.scoreOverall);
  // Mind. EIN numerischer Wert (Kompetenz oder overall) — sonst kein Signal.
  if (!KEYS.some((k) => typeof metrics[k] === "number") && typeof metrics.overall !== "number") {
    return false;
  }

  const doc = {
    id: `coach:${a.runId}`,
    v: 1,
    type: "measurement",
    appId: "coach",
    workspaceId: a.workspaceId,
    subjectId: a.subjectId,
    metrics,
    scale: { min: 1, max: 4 },
    ts: a.createdAt, // HARTE REGEL 1
    runId: a.runId,
    sourceRunId: a.runId,
  };

  try {
    await upsertItem(radarEventsContainer(), doc);
    return true;
  } catch (e) {
    logger.apiError("radar-emit", e, { runId: a.runId });
    return false; // fail-soft: darf den Analyse-Flow nie umwerfen
  }
}
