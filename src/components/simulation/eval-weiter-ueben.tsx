'use client';

/**
 * Paket 3, U14 und S10 (12.11.2026): Reiter „Weiter üben“ der Rollenspiel-Auswertung.
 * Alles, was nach dem Lesen kommt: dasselbe Gespräch noch einmal mit Fokus, die Empfehlung, ein passender Kurs oder
 * der Kurswunsch, die Brücke ins Studio und ein neues Gespräch. Die Bausteine stammen aus simulation-evaluation.tsx
 * (Stand vor Paket 3) und sind inhaltlich unverändert.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BookOpen, GraduationCap, Lightbulb, Loader2, MessagesSquare, RotateCcw } from 'lucide-react';
import { useHubNav } from '@/components/app/app-switcher';
import { computeDeltaCta, computeStudioBridge } from '@/lib/simulation/endscreen';
import { matchCourse, type CourseMatch, type HubCourseLike, type HubRecommendationLike } from '@/lib/simulation/kurs-match';
import { useTranslation } from '@/i18n/useTranslation';
import { splitTitle, type SimEvalDelta, type SimEvalRating } from './eval-teile';

/** Hub `/api/lernbereich/courses` (same-origin, Sitzungs-Cookie): eigene Kurse mit Kompetenz-Tags. */
interface HubCoursesResponse {
  ok?: boolean;
  courses?: HubCourseLike[];
  recommendations?: HubRecommendationLike[];
}
let hubCoursesCache: Promise<HubCoursesResponse> | null = null;
function fetchHubCourses(): Promise<HubCoursesResponse> {
  if (!hubCoursesCache) {
    // Hub-Wurzel, bewusst OHNE basePath /coach (wie /api/nav im App-Umschalter).
    hubCoursesCache = fetch('/api/lernbereich/courses', { credentials: 'same-origin', cache: 'no-store' })
      .then(async (r) => (r.ok ? ((await r.json()) as HubCoursesResponse) : {}))
      .catch(() => ({}));
  }
  return hubCoursesCache;
}

export function EvalWeiterUeben(props: {
  ratings: SimEvalRating[] | null;
  delta: SimEvalDelta | null;
  /** Der gespeicherte Vorsatz, sonst der Vorschlag des Coachs: der Fokus für „Nochmal üben“. */
  commitment: string;
  /** true = `commitment` ist ein gespeicherter Vorsatz, false = noch der Vorschlag. */
  commitmentSaved: boolean;
  /** Szenario dieser Auswertung (für die Empfehlung: Abwechslung schlägt Wiederholung). */
  currentScenarioId?: string | null;
  /** Katalog-Projektion für die Empfehlung (W3-1); leer = ohne Szenario-Knopf. */
  scenarios?: Array<{ id: string; title: string; competencyFocus?: string[] }>;
  /** W3-1: öffnet das Briefing eines empfohlenen Szenarios. */
  onOpenScenario?: (scenarioId: string) => void;
  /** Startet dasselbe Szenario mit diesem Fokus. */
  onRetry: (focusText: string) => void;
  retryBusy?: boolean;
  /** Zurück zum Einstieg. */
  onNew: () => void;
}) {
  const { t } = useTranslation();
  const ts = t.simulation;
  const { ratings, delta, commitment } = props;

  // W3-1: Erkenntnis → Handlung (pure, getestet).
  const deltaCta = useMemo(
    () =>
      computeDeltaCta({
        ratings,
        deltaCompetencies: delta?.competencies ?? null,
        scenarios: props.scenarios ?? [],
        currentScenarioId: props.currentScenarioId ?? null,
      }),
    [ratings, delta, props.scenarios, props.currentScenarioId]
  );
  // W3-3: Studio-Brücke nur bei echter Schwäche (≤ 2).
  const studioBridge = useMemo(() => computeStudioBridge(ratings), [ratings]);
  // N17 / C8 (11.10.2026): erst einen vorhandenen passenden Kurs zeigen, dann „Kurs wünschen“;
  // „Kurs im Studio erstellen“ nur, wenn die Person das Studio hat (Häkchen aus dem Hub).
  const hubNav = useHubNav();
  const hasStudio = hubNav.apps === null || hubNav.apps.includes('studio');
  const [courseMatch, setCourseMatch] = useState<CourseMatch | 'loading'>('loading');
  useEffect(() => {
    if (!studioBridge) return;
    let aktiv = true;
    fetchHubCourses().then((j) => {
      if (!aktiv) return;
      setCourseMatch(matchCourse(studioBridge.cKey, j.courses ?? [], j.recommendations ?? []));
    });
    return () => {
      aktiv = false;
    };
  }, [studioBridge]);

  return (
    <>
      {/* Nochmal üben mit Fokus: der Vorsatz aus dem Überblick ist der Fokus des nächsten Versuchs. */}
      <section className="pn-surface glass-panel rounded-2xl p-5 border border-border space-y-3" data-testid="retry-section">
        {commitment.trim().length > 0 && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-primary">
              {props.commitmentSaved ? t.evaluation.commitSavedTitle : t.evaluation.commitSuggestionTitle}
            </div>
            <p className="text-sm font-medium leading-snug">{commitment}</p>
          </div>
        )}
        <button
          onClick={() => props.onRetry(commitment.trim().slice(0, 300))}
          disabled={props.retryBusy || commitment.trim().length === 0}
          className="btn-gradient text-white font-semibold rounded-xl px-6 py-3 flex items-center gap-2 shadow-neon disabled:opacity-60"
        >
          {props.retryBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <RotateCcw className="h-5 w-5" />}
          {ts.retryFocusCta}
        </button>
      </section>

      {/* W3-1: Delta als Auslöser — Satz + Handlung statt stummem Tag. */}
      {deltaCta && (
        <section className="pn-none glass-panel rounded-2xl p-5 border border-primary/30 bg-primary/5">
          <p className="text-sm leading-relaxed">
            <span className="font-semibold">
              {(deltaCta.mode === 'dropped'
                ? t.evaluation.deltaDroppedSentence
                : t.evaluation.deltaWeakestSentence
              ).replace('{c}', deltaCta.cName ?? deltaCta.cKey)}
            </span>
            {deltaCta.scenarioTitle && (
              <> {t.evaluation.deltaScenarioAims.replace('{s}', splitTitle(deltaCta.scenarioTitle).motto)}</>
            )}
          </p>
          {deltaCta.scenarioId && props.onOpenScenario && (
            <button
              onClick={() => props.onOpenScenario!(deltaCta.scenarioId!)}
              className="pn-none mt-3 inline-flex items-center gap-2 rounded-lg border border-primary/40 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/10 transition-colors"
            >
              {t.evaluation.deltaCtaButton} <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </section>
      )}

      {/* N17 / C8 (11.10.2026): bei echter Schwäche zuerst ein vorhandener Kurs, sonst „Kurs wünschen“. */}
      {studioBridge && courseMatch !== 'loading' && (
        <section
          className="pn-none glass-panel rounded-2xl p-5 border border-primary/30 bg-primary/5"
          data-testid="course-bridge"
          data-kind={courseMatch ? courseMatch.kind : 'wish'}
        >
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              {courseMatch?.kind === 'course' ? <BookOpen className="h-5 w-5" /> : <Lightbulb className="h-5 w-5" />}
            </span>
            <div className="min-w-0">
              {courseMatch?.kind === 'course' ? (
                <>
                  <h3 className="text-sm font-semibold">{t.evaluation.courseMatchTitle}</h3>
                  <p className="mt-0.5 text-sm text-muted-foreground leading-relaxed">
                    {t.evaluation.courseMatchBody.replace('{c}', studioBridge.cName ?? studioBridge.cKey).replace('{title}', courseMatch.title)}
                  </p>
                  <a
                    href={courseMatch.learnUrl}
                    className="pn-none mt-2 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-colors"
                    data-testid="course-open"
                  >
                    <BookOpen className="h-4 w-4" /> {courseMatch.refresh ? t.evaluation.courseRefresh : t.evaluation.courseOpen}
                    <ArrowRight className="h-4 w-4" />
                  </a>
                </>
              ) : (
                <>
                  <h3 className="text-sm font-semibold">{t.evaluation.courseWishTitle}</h3>
                  <p className="mt-0.5 text-sm text-muted-foreground leading-relaxed">{t.evaluation.courseWishBody}</p>
                  <a
                    href={`/radar?wunsch${courseMatch?.kind === 'recommendation' ? `=${encodeURIComponent(courseMatch.title)}` : `Text=${encodeURIComponent(t.evaluation.courseWishText.replace('{c}', studioBridge.cName ?? studioBridge.cKey))}`}#lernwuensche`}
                    className="pn-none mt-2 inline-flex items-center gap-2 rounded-lg border border-primary/40 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/10 transition-colors"
                    data-testid="course-wish"
                  >
                    <Lightbulb className="h-4 w-4" /> {t.evaluation.courseWishCta}
                    <ArrowRight className="h-4 w-4" />
                  </a>
                </>
              )}
            </div>
          </div>
        </section>
      )}

      {/* W3-3: Studio-Brücke — nur bei echter Schwäche (≤ 2), neuer Tab; seit 11.10.2026 nur mit Studio-Häkchen. */}
      {studioBridge && hasStudio && (
        <section className="pn-none glass-panel rounded-2xl p-5 border border-accent/30 bg-accent/5">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
              <GraduationCap className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">{t.evaluation.studioBridgeTitle}</h3>
              <p className="mt-0.5 text-sm text-muted-foreground leading-relaxed">
                {t.evaluation.studioBridgeBody.replace(
                  '{c}',
                  studioBridge.cName ?? studioBridge.cKey
                )}
              </p>
              <a
                href={studioBridge.href}
                target="_blank"
                rel="noreferrer"
                className="pn-none mt-2 inline-flex items-center gap-2 rounded-lg border border-accent/40 px-4 py-2 text-sm font-semibold text-accent hover:bg-accent/10 transition-colors"
              >
                <GraduationCap className="h-4 w-4" /> {t.evaluation.studioBridgeCta}
                <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          </div>
        </section>
      )}

      <div>
        <button
          onClick={props.onNew}
          className="pn-none rounded-xl px-6 py-3 text-sm font-semibold border border-border hover:bg-muted transition-colors flex items-center gap-2"
        >
          <MessagesSquare className="h-5 w-5" /> {ts.newSimulation}
        </button>
      </div>
    </>
  );
}
