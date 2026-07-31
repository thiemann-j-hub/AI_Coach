/**
 * Radar-Vertrag (Coach-Seite) — SPIEGELT den gelockten Hub-Vertrag
 * (SSOT: pulscraft-hub `src/lib/plug/radar.ts`, RADAR_CONTRACT_VERSION 1).
 * Feldnamen EXAKT wie im Hub; Aenderungen NUR im Gleichschritt mit dem SSOT.
 *
 * PURE (kein "server-only", kein I/O) — wird sowohl vom Server-Emitter
 * (src/lib/server/radar-emit.ts) als auch vom One-off-Backfill
 * (scripts/backfill-radar-events.ts) importiert (Muster quality-core.ts).
 *
 * GELOCKTE REGELN (Wirbelsäule V6 Kap. 6 / Hub-Vertrag):
 *  - `ts` IMMER = runDoc.createdAt (NIE Date.now) — sonst springt ein
 *    Re-Emit/Backfill den Messpunkt zeitlich nach vorn (Hub „Riss 4").
 *  - score 0 ODER null in competency_ratings ⇒ Metrik null („nicht
 *    beobachtbar", NICHT 0 — eine 0 wuerde den Laengsschnitt verzerren).
 *  - overall = arithmetisches Mittel NUR der beobachtbaren C-Werte, gerundet
 *    auf 1 Nachkommastelle (NICHT scoreOverall/10 — andere Skala/Quelle).
 */

/** Vertrags-Version — Breaking Changes erhoehen sie (Forward-Compat der Leser). */
export const RADAR_CONTRACT_VERSION = 1 as const;

/** Quell-App-Kennung des Coach im Radar-Ledger. */
export const RADAR_APP_ID = "coach" as const;

/** Wertebereich der Coach-C-Scores (1 = schwach beobachtet … 4 = stark). */
export const COACH_SCALE = { min: 1, max: 4 } as const;

/** Die 10 Kompetenz-Dimensionen (ohne overall) — identisch zum Hub. */
export const COMPETENCY_KEYS = [
  "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10",
] as const;
export type CompetencyKey = (typeof COMPETENCY_KEYS)[number];

/**
 * C1–C10 + overall; `null` = in diesem Lauf nicht beobachtbar (Hub
 * `RadarMetrics`). Skala steht im Event (`scale`), nicht im Wert.
 */
export type RadarMetrics = Record<CompetencyKey, number | null> & {
  overall: number | null;
};

/** measurement-Doc exakt nach Hub-Vertrag (ScoreEvent + id + v). */
export interface CoachMeasurementDoc {
  /** Idempotente Doc-id `coach:${runId}` — Re-Emit/Backfill zaehlt nie doppelt. */
  id: string;
  v: number;
  type: "measurement";
  appId: typeof RADAR_APP_ID;
  /** Mandant = Partition Key = zentraler Workspace (resolve-workspace-Wert). */
  workspaceId: string;
  /** Gemessenes Subjekt = Entra-oid (app-uebergreifend stabil). */
  subjectId: string;
  /** Ereigniszeit (ISO-8601) — IMMER runDoc.createdAt (gelockt). */
  ts: string;
  runId: string;
  metrics: RadarMetrics;
  scale: { min: number; max: number };
  /**
   * GL-A4 (31.07.2026, ADDITIV — v1-kompatibel, alle Leser tolerieren Fehlen):
   * je beobachtbarer Kompetenz bis zu 2 woertliche, anonymisierte Zitate aus
   * der Analyse („Warum diese Note?" im Hub-Radar). Nur gesetzt, wenn Zitate
   * existieren; Alt-Events tragen das Feld nicht.
   */
  evidence?: Partial<Record<CompetencyKey, string[]>>;
}

/** Idempotente Doc-id — exakt Hub `measurementDocId(appId, runId)`. */
export function coachMeasurementDocId(runId: string): string {
  return `${RADAR_APP_ID}:${runId}`;
}

function emptyMetrics(): RadarMetrics {
  return {
    C1: null, C2: null, C3: null, C4: null, C5: null,
    C6: null, C7: null, C8: null, C9: null, C10: null,
    overall: null,
  };
}

/**
 * Mappt Coach-`analysisJson.competency_ratings` auf die Radar-Metriken.
 * GELOCKT: score 0/null/nicht-numerisch ⇒ null (nicht beobachtbar, NICHT 0);
 * overall = Mittel NUR der beobachtbaren Werte, 1 Nachkommastelle; ohne
 * beobachtbare Werte bleibt overall null. Defensive Eingabe (unknown), damit
 * auch Alt-/Backfill-Formen nie werfen.
 */
export function metricsFromCompetencyRatings(ratings: unknown): RadarMetrics {
  const m = emptyMetrics();
  if (Array.isArray(ratings)) {
    for (const r of ratings) {
      const id = typeof (r as { id?: unknown })?.id === "string" ? (r as { id: string }).id : "";
      if (!(COMPETENCY_KEYS as readonly string[]).includes(id)) continue;
      const s = (r as { score?: unknown })?.score;
      m[id as CompetencyKey] =
        typeof s === "number" && Number.isFinite(s) && s > 0 ? s : null;
    }
  }
  const observed = COMPETENCY_KEYS
    .map((k) => m[k])
    .filter((v): v is number => typeof v === "number");
  m.overall = observed.length
    ? Math.round((observed.reduce((a, b) => a + b, 0) / observed.length) * 10) / 10
    : null;
  return m;
}

/**
 * GL-A4: extrahiert je Kompetenz bis zu 2 nicht-leere Evidenz-Zitate aus den
 * competency_ratings — NUR fuer Kompetenzen, die auch einen beobachtbaren
 * Score tragen (Zitate ohne Score waeren im Radar irrefuehrend). Zitate werden
 * auf 220 Zeichen gekappt (Ledger-Doc klein halten). `undefined`, wenn nichts
 * da ist (kein leeres Objekt ins Doc schreiben).
 */
export function evidenceFromCompetencyRatings(
  ratings: unknown
): Partial<Record<CompetencyKey, string[]>> | undefined {
  if (!Array.isArray(ratings)) return undefined;
  const out: Partial<Record<CompetencyKey, string[]>> = {};
  for (const r of ratings) {
    const id = typeof (r as { id?: unknown })?.id === "string" ? (r as { id: string }).id : "";
    if (!(COMPETENCY_KEYS as readonly string[]).includes(id)) continue;
    const s = (r as { score?: unknown })?.score;
    if (!(typeof s === "number" && Number.isFinite(s) && s > 0)) continue;
    const ev = (r as { evidence?: unknown })?.evidence;
    if (!Array.isArray(ev)) continue;
    const quotes = ev
      .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
      .map((q) => (q.length > 220 ? `${q.slice(0, 219)}…` : q))
      .slice(0, 2);
    if (quotes.length) out[id as CompetencyKey] = quotes;
  }
  return Object.keys(out).length ? out : undefined;
}

/** true, wenn mindestens EIN Wert Signal traegt (Hub verwirft Leer-Events). */
export function hasObservableMetric(m: RadarMetrics): boolean {
  return (
    COMPETENCY_KEYS.some((k) => typeof m[k] === "number") ||
    typeof m.overall === "number"
  );
}

/**
 * Baut das measurement-Doc nach Hub-Vertrag — oder `null`, wenn ein
 * Pflichtfeld fehlt oder KEIN Wert beobachtbar ist (Leer-Events werden gar
 * nicht erst emittiert; die Hub-Validierung wuerde sie ohnehin verwerfen).
 */
export function buildCoachMeasurementDoc(args: {
  workspaceId: string;
  subjectId: string;
  runId: string;
  /** IMMER runDoc.createdAt (ISO-8601) — NIE Date.now() (gelockt). */
  createdAt: string;
  competencyRatings: unknown;
}): CoachMeasurementDoc | null {
  if (!args.workspaceId || !args.subjectId || !args.runId || !args.createdAt) {
    return null;
  }
  const metrics = metricsFromCompetencyRatings(args.competencyRatings);
  if (!hasObservableMetric(metrics)) return null;
  const evidence = evidenceFromCompetencyRatings(args.competencyRatings);
  return {
    id: coachMeasurementDocId(args.runId),
    v: RADAR_CONTRACT_VERSION,
    type: "measurement",
    appId: RADAR_APP_ID,
    workspaceId: args.workspaceId,
    subjectId: args.subjectId,
    ts: args.createdAt,
    runId: args.runId,
    metrics,
    scale: { min: COACH_SCALE.min, max: COACH_SCALE.max },
    ...(evidence ? { evidence } : {}),
  };
}
