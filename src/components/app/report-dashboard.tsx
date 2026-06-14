'use client';

import React, { useMemo, useState } from 'react';
import { Star, AlertTriangle, Download, AlarmClock, Check, Copy } from 'lucide-react';
import { ScoreRing } from './score-ring';
import { InsightCard } from './insight-card';
import { useTranslation } from '@/i18n/useTranslation';
import { authFetch } from '@/lib/api-client';
import {
  unwrapRunResult,
  overallToPercent,
  scoreTitle,
  scoreBadge,
  asStringArray,
  pickPractice,
  parseRewrite,
  copyText,
  clamp,
  toNumber,
} from '@/lib/report-utils';
import { LinkedInPostCard } from './linkedin-post-card';

type AnyObj = Record<string, any>;

/* ------------------------------------------------------------------ */
/*  CompetencyPanel                                                    */
/* ------------------------------------------------------------------ */

export function CompetencyPanel({ competencies }: { competencies: any[] }) {
  const { t } = useTranslation();
  const list = Array.isArray(competencies) ? competencies : [];

  function getId(c: AnyObj) { return String(c?.id ?? c?.competencyId ?? '').trim() || 'C?'; }
  function getName(c: AnyObj) { return String(c?.title ?? c?.name ?? c?.label ?? '').trim() || t.report.competency; }
  function getReason(c: AnyObj) { return String(c?.reason ?? c?.why ?? '').trim(); }
  function getQuotes(c: AnyObj) { return asStringArray(c?.quotes ?? c?.evidence ?? []); }

  function scoreToPct(c: AnyObj): { pct: number | null; label: string } {
    const s = toNumber(c?.score);
    if (s === null) return { pct: null, label: 'N/A' };
    if (s <= 4) return { pct: clamp((s / 4) * 100, 0, 100), label: `${s}/4` };
    if (s <= 10) return { pct: clamp((s / 10) * 100, 0, 100), label: `${s}/10` };
    return { pct: clamp(s, 0, 100), label: `${Math.round(s)}` };
  }

  function barTone(pct: number | null) {
    if (pct === null) return 'bg-foreground/10';
    if (pct >= 75) return 'bg-emerald-500';
    if (pct >= 50) return 'bg-primary';
    if (pct >= 25) return 'bg-amber-500';
    return 'bg-red-500';
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
      {list.length === 0 ? (
        <div className="text-sm text-muted-foreground">{t.report.noCompetencyData}</div>
      ) : (
        list.map((c, idx) => {
          const id = getId(c);
          const name = getName(c);
          const reason = getReason(c);
          const quotes = getQuotes(c);
          const { pct, label } = scoreToPct(c);

          return (
            <details
              key={`${id}-${idx}`}
              className={`glass-panel rounded-xl overflow-hidden ${pct === null ? 'opacity-70' : ''}`}
              open={idx === 0}
            >
              <summary className="cursor-pointer list-none p-3 flex items-center justify-between bg-foreground/[0.02]">
                <div className="flex items-center gap-3">
                  <div className={`w-7 h-7 rounded-md flex items-center justify-center font-bold text-[10px] ${
                    pct === null ? 'bg-foreground/5 text-muted-foreground' : 'bg-primary/15 text-primary'
                  }`}>
                    {id}
                  </div>
                  <span className="font-medium text-sm text-foreground">{name}</span>
                </div>
                <span className={`text-sm font-bold ${pct === null ? 'text-muted-foreground' : 'text-foreground'}`}>
                  {label}
                </span>
              </summary>

              <div className="p-3 pt-2">
                <div className="w-full bg-foreground/5 rounded-full h-1.5 mb-2 mt-1">
                  <div className={`${barTone(pct)} h-1.5 rounded-full transition-all`} style={{ width: `${pct ?? 0}%` }} />
                </div>

                {reason ? (
                  <p className="text-xs text-muted-foreground leading-snug">{reason}</p>
                ) : (
                  <p className="text-xs text-muted-foreground/50">—</p>
                )}

                {quotes.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t.report.quotes}</div>
                    <ul className="space-y-1">
                      {quotes.slice(0, 3).map((q, i) => (
                        <li key={i} className="text-xs text-muted-foreground">"{q}"</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </details>
          );
        })
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  RatingCard                                                          */
/* ------------------------------------------------------------------ */

function RatingCard({
  sessionId,
  runId,
  initialRating,
}: {
  sessionId: string;
  runId: string;
  initialRating: number | null;
}) {
  const { t } = useTranslation();
  const [rating, setRating] = useState<number | null>(initialRating);
  const [hover, setHover] = useState<number | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    initialRating ? 'saved' : 'idle'
  );

  async function rate(value: number) {
    setRating(value);
    setState('saving');
    try {
      const res = await authFetch('/api/runs/rate', {
        method: 'POST',
        body: JSON.stringify({ sessionId, runId, rating: value }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) throw new Error();
      setState('saved');
    } catch {
      setState('error');
    }
  }

  const shown = hover ?? rating ?? 0;

  return (
    <div className="glass-panel rounded-2xl p-5">
      <h3 className="font-bold text-sm text-foreground mb-3">{t.report.rateTitle}</h3>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((v) => (
          <button
            key={v}
            type="button"
            disabled={state === 'saving'}
            onMouseEnter={() => setHover(v)}
            onMouseLeave={() => setHover(null)}
            onClick={() => rate(v)}
            className="leading-none transition-transform hover:scale-110 disabled:opacity-60"
            aria-label={`${v}/5`}
          >
            <Star className={`h-6 w-6 ${shown >= v ? 'fill-amber-400 text-amber-400' : 'text-foreground/20'}`} />
          </button>
        ))}
      </div>
      {state === 'saved' && <p className="text-xs text-emerald-500 mt-2">{t.report.rateThanks}</p>}
      {state === 'error' && <p className="text-xs text-red-400 mt-2">{t.report.rateError}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ReportDashboard (main)                                             */
/* ------------------------------------------------------------------ */

export default function ReportDashboard({
  result,
  metaChips,
  conversationType,
  lang,
  sessionId,
  runId,
  initialRating,
}: {
  result: AnyObj;
  metaChips?: Array<{ label: string; value: string }>;
  conversationType?: string;
  lang?: string;
  sessionId?: string;
  runId?: string;
  initialRating?: number | null;
}) {
  const { t } = useTranslation();

  result = unwrapRunResult(result as AnyObj);

  const pct = useMemo(() => overallToPercent(result), [result]);
  const title = useMemo(() => scoreTitle(pct), [pct]);
  const badge = useMemo(() => scoreBadge(pct), [pct]);

  const summary = String(result?.summary ?? '').trim();
  const strengths = asStringArray(result?.strengths);
  const improvements = asStringArray(result?.improvements);
  const riskFlags = asStringArray(result?.riskFlags);

  const rewritesRaw = Array.isArray(result?.rewrites) ? result.rewrites : [];
  const rewrites = rewritesRaw
    .map((x: any) => parseRewrite(x))
    .filter((r: any) => (r?.original ?? '').trim() || (r?.better ?? '').trim());

  const practice = pickPractice(result);
  const transcript = String(result?.transcriptText ?? '').trim();
  const hasTranscript = !!transcript;

  const chips = useMemo(() => {
    const base = Array.isArray(metaChips) ? [...metaChips] : [];
    if (hasTranscript) base.push({ label: t.report.transcriptLabel, value: t.report.saved });
    return base;
  }, [metaChips, hasTranscript, t]);

  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);

  const ragError = String(result?.rag_error ?? '').trim();
  const competencyError = String(result?.competency_error ?? '').trim();
  // Deterministische Qualitäts-Checks (Backend): nur warn/error anzeigen
  const groundingWarnings = (Array.isArray(result?.quality_notes) ? result.quality_notes : [])
    .filter((n: any) => n?.severity === 'warn' || n?.severity === 'error').length;

  function handleDownload() {
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analysis-${runId ?? 'report'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleReminder() {
    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(9, 0, 0, 0);
    const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    // ICS verlangt CRLF-Zeilenenden und escaped Kommas/Newlines im Text
    const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\r?\n/g, '\\n');
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//PulseCraft AI//Coach//EN',
      'BEGIN:VEVENT',
      `UID:pulsecraft-${runId ?? 'practice'}@pulsecraft.ai`,
      `DTSTAMP:${fmt(new Date())}`,
      `DTSTART:${fmt(start)}`,
      'DURATION:PT15M',
      'RRULE:FREQ=DAILY;COUNT=7',
      `SUMMARY:${esc(t.report.weeklyPractice)}`,
      `DESCRIPTION:${esc((practice || '').slice(0, 800))}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pulsecraft-7-tage-uebung.ics';
    a.click();
    URL.revokeObjectURL(url);
  }

  const competencies = Array.isArray(result?.competency_ratings)
    ? result.competency_ratings
    : Array.isArray(result?.competencies) ? result.competencies : [];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* DEGRADATION NOTICES */}
      {(ragError || competencyError || groundingWarnings > 0) && (
        <div className="xl:col-span-12 space-y-2">
          {ragError && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {t.report.ragDegraded}
            </div>
          )}
          {competencyError && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {t.report.competencyDegraded}
            </div>
          )}
          {groundingWarnings > 0 && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {t.report.groundingWarning.replace('{count}', String(groundingWarnings))}
            </div>
          )}
        </div>
      )}

      {/* LEFT MAIN COLUMN */}
      <div className="xl:col-span-8 space-y-6">
        {/* HERO */}
        <div className="glass-panel rounded-2xl p-6 md:p-8">
          <div className="flex flex-col md:flex-row items-center gap-8">
            <ScoreRing value={pct} label={t.report.overall} />
            <div className="flex-1 text-center md:text-left">
              <div className="flex flex-col md:flex-row md:items-center gap-3 mb-3 justify-center md:justify-start">
                <h2 className="text-xl font-bold text-foreground">{title}</h2>
                <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide inline-block w-fit mx-auto md:mx-0 ${badge.cls}`}>
                  {badge.label}
                </span>
              </div>

              <p className="text-muted-foreground leading-relaxed text-sm md:text-base max-w-3xl">
                {summary || t.report.emptyState}
              </p>

              {chips.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2 justify-center md:justify-start">
                  {chips.map((c, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-foreground/5 rounded text-xs text-muted-foreground border border-border"
                    >
                      <span className="font-medium">{c.label}:</span> {c.value}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-4 flex justify-center md:justify-start">
                <button
                  type="button"
                  className="px-3 py-2 rounded-xl text-xs font-semibold border border-border bg-secondary hover:bg-primary/10 text-foreground transition-colors flex items-center gap-1.5"
                  onClick={handleDownload}
                >
                  <Download className="h-4 w-4" />
                  {t.report.download}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 3 INSIGHTS */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <InsightCard tone="success" title={t.report.strengths} items={strengths} />
          <InsightCard tone="warning" title={t.report.potential} items={improvements} />

          <div className="glass-panel rounded-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 bg-red-500 h-full" />
            <div className="p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="p-2 rounded-lg bg-red-500/10 text-red-400">
                  <AlertTriangle className="h-5 w-5 leading-none" />
                </div>
                <h3 className="font-bold text-lg text-foreground">{t.report.risks}</h3>
              </div>

              {riskFlags.length === 0 ? (
                <p className="text-sm text-muted-foreground">—</p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground leading-relaxed">{riskFlags[0]}</p>
                  {riskFlags.length > 1 && (
                    <div className="mt-4 pt-4 border-t border-border">
                      <span className="text-xs font-semibold text-red-400 uppercase tracking-wide">{t.report.pitfalls}</span>
                      <ul className="mt-2 space-y-2">
                        {riskFlags.slice(1, 4).map((x, i) => (
                          <li key={i} className="text-xs text-muted-foreground">{x}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* PRACTICE + REWRITES */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pb-8">
          {/* 7-Day Practice */}
          <div className="lg:col-span-1 glass-panel rounded-2xl p-6 flex flex-col border-primary/10">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-primary rounded-lg text-white shadow-neon">
                <span className="text-sm font-bold">7</span>
              </div>
              <h3 className="font-bold text-lg text-foreground">{t.report.weeklyPractice}</h3>
            </div>

            <p className="text-sm text-muted-foreground mb-6 flex-1 leading-relaxed">{practice || '—'}</p>

            <button
              type="button"
              className="w-full py-3 bg-secondary text-primary text-sm font-semibold rounded-xl border border-border hover:bg-primary/10 hover:shadow-primary-glow transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              onClick={handleReminder}
              disabled={!practice}
            >
              <AlarmClock className="h-4 w-4" />
              {t.report.reminder}
            </button>
          </div>

          {/* Rewrites */}
          <div className="lg:col-span-2 glass-panel rounded-2xl overflow-hidden flex flex-col">
            <div className="p-5 border-b border-border bg-foreground/[0.02] flex justify-between items-center">
              <div>
                <h3 className="font-bold text-lg text-foreground">{t.report.rewritesTitle}</h3>
                <p className="text-xs text-muted-foreground mt-1">{t.report.rewritesSubtitle}</p>
              </div>
              <span className="text-muted-foreground text-sm">✦</span>
            </div>

            <div className="divide-y divide-border flex-1">
              {rewrites.length === 0 ? (
                <div className="p-5 text-sm text-muted-foreground">—</div>
              ) : (
                rewrites.slice(0, 6).map((r, idx) => (
                  <div key={idx} className="p-5 hover:bg-foreground/[0.02] transition group">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="relative pl-3 border-l-2 border-red-500/60">
                        <span className="text-[10px] font-bold text-red-400 uppercase tracking-wide block mb-1">{t.report.original}</span>
                        <p className="text-sm text-muted-foreground italic">{r.original ? `"${r.original}"` : '—'}</p>
                      </div>

                      <div className="relative pl-3 border-l-2 border-emerald-500/60">
                        <div className="flex justify-between items-start">
                          <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wide block mb-1">{t.report.better}</span>
                          <button
                            type="button"
                            className="opacity-0 group-hover:opacity-100 transition text-muted-foreground hover:text-primary"
                            title={t.common.copy}
                            onClick={async () => {
                              await copyText(r.better || '');
                              setCopiedIdx(idx);
                              setTimeout(() => setCopiedIdx((v) => (v === idx ? null : v)), 900);
                            }}
                          >
                            {copiedIdx === idx ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                        <p className="text-sm text-foreground font-medium">{r.better || '—'}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* LINKEDIN POST */}
        <LinkedInPostCard
          summary={summary}
          strengths={strengths}
          improvements={improvements}
          scoreOverall={pct}
          conversationType={conversationType ?? ''}
          lang={lang ?? 'de'}
        />

        {/* TRANSCRIPT */}
        <div className="glass-panel rounded-2xl overflow-hidden">
          <div className="p-5 border-b border-border bg-foreground/[0.02] flex items-start justify-between gap-4">
            <div>
              <h3 className="font-bold text-lg text-foreground">{t.report.transcriptTitle}</h3>
              <p className="text-xs text-muted-foreground mt-1">
                {hasTranscript
                  ? t.report.transcriptSaved
                  : t.report.transcriptNotSaved}
              </p>
            </div>

            {hasTranscript && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="px-3 py-2 rounded-xl text-xs font-semibold border border-border bg-secondary hover:bg-primary/10 text-foreground transition-colors"
                  onClick={() => copyText(transcript)}
                  title={t.common.copy}
                >
                  <Copy className="h-4 w-4 mr-1 align-middle" />
                  {t.common.copy}
                </button>

                <button
                  type="button"
                  className="px-3 py-2 rounded-xl text-xs font-semibold border border-border bg-secondary hover:bg-primary/10 text-foreground transition-colors"
                  onClick={() => setShowTranscript((v) => !v)}
                >
                  {showTranscript ? t.common.hide : t.common.show}
                </button>
              </div>
            )}
          </div>

          {hasTranscript ? (
            showTranscript ? (
              <div className="p-5">
                <pre className="whitespace-pre-wrap text-sm text-foreground font-mono bg-background/60 rounded-xl p-4 border border-border max-h-[520px] overflow-auto custom-scrollbar">
                  {transcript}
                </pre>
              </div>
            ) : (
              <div className="p-5 text-sm text-muted-foreground">{t.report.transcriptHidden}</div>
            )
          ) : (
            <div className="p-5 text-sm text-muted-foreground">
              {t.report.transcriptNotSavedHint}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT COLUMN (SIDEBAR) */}
      <div className="xl:col-span-4 w-full space-y-6 sticky top-24">
        <div className="glass-panel rounded-2xl p-4">
          <div className="mb-4 px-2">
            <h3 className="font-bold text-lg text-foreground">{t.report.competencies}</h3>
            <p className="text-xs text-muted-foreground">{t.report.competenciesSubtitle}</p>
          </div>
          <CompetencyPanel competencies={competencies} />
        </div>

        {sessionId && runId && (
          <RatingCard
            sessionId={sessionId}
            runId={runId}
            initialRating={typeof initialRating === 'number' ? initialRating : null}
          />
        )}
      </div>
    </div>
  );
}
