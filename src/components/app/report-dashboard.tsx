'use client';

// Force re-compile
import React, { useMemo, useState } from 'react';

type AnyObj = Record<string, any>;
type RewritePair = { original: string; better: string };

function unwrapRunResult(input: AnyObj): AnyObj {
  // Support: entweder direkt Analyse-Objekt ODER Firestore-Run (mit analysisJson)
  const ai = (input as any)?.analysisJson;
  if (ai && typeof ai === 'object' && !Array.isArray(ai)) {
    const summary =
      typeof (ai as any).summary === 'string' && String((ai as any).summary).trim()
        ? (ai as any).summary
        : typeof (input as any).summary === 'string'
          ? (input as any).summary
          : null;

    return {
      ...ai,
      // Run-level fallbacks (nützlich fürs UI)
      summary,
      scoreOverall: (input as any).scoreOverall ?? (ai as any)?.scores?.overall ?? null,
      createdAt: (input as any).createdAt ?? null,
      conversationType: (input as any).conversationType ?? null,
      conversationSubType: (input as any).conversationSubType ?? null,
      goal: (input as any).goal ?? null,
      lang: (input as any).lang ?? null,
      jurisdiction: (input as any).jurisdiction ?? null,
      transcriptText: (input as any).transcriptText ?? null,
    };
  }
  return input;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function toNumber(v: any): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Accepts overall score as 0–10 or 0–100 and returns percent 0–100 */
function overallToPercent(result: AnyObj): number | null {
  const raw = toNumber(result?.scores?.overall ?? result?.scoreOverall ?? result?.overall);
  if (raw === null) return null;
  if (raw <= 10) return clamp(raw * 10, 0, 100);
  return clamp(raw, 0, 100);
}

function scoreTitle(pct: number | null) {
  if (pct === null) return 'Analyse bereit';
  if (pct >= 85) return 'Sehr starke Gesprächsführung';
  if (pct >= 70) return 'Gute Gesprächsführung';
  if (pct >= 55) return 'Solide Basis';
  return 'Ausbaufähig';
}

function scoreBadge(pct: number | null) {
  if (pct === null) return { label: '—', cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' };
  if (pct >= 85) return { label: 'Sehr stark', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' };
  if (pct >= 70) return { label: 'Stark', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' };
  if (pct >= 55) return { label: 'Solide', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' };
  return { label: 'Fokus nötig', cls: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300' };
}

function asStringArray(v: any): string[] {
  return Array.isArray(v) ? v.map((x) => String(x ?? '')).map((s) => s.trim()).filter(Boolean) : [];
}

function pickPractice(result: AnyObj): string | null {
  const cands = [
    result?.practice7Days,
    result?.sevenDayPractice,
    result?.practice_7days,
    result?.practice7days,
    result?.practice,
    result?.exercise7Days,
    result?.exercise,
    result?.next7Days,
  ];
  for (const c of cands) {
    const s = typeof c === 'string' ? c.trim() : '';
    if (s) return s;
  }

  // Fallback: wenn kein eigenes 7‑Tage‑Feld vorhanden ist, nimm den 1. Verbesserungs‑Hebel.
  const fallback = asStringArray(result?.improvements ?? result?.potential ?? result?.improvementAreas);
  if (fallback.length) return fallback[0];

  return null;
}

function isPlainObject(v: any): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stripWrappingQuotes(input: string): string {
  let s = String(input ?? '').trim();
  if (!s) return '';

  // Remove bullet prefixes
  s = s.replace(/^[•\-\*\u2022]\s+/, '').trim();

  // If string ends with punctuation AFTER a closing quote, drop that punctuation
  if (s.length >= 2 && /[.,;:!?]$/.test(s)) {
    const prev = s[s.length - 2];
    if (`"'”»›`.includes(prev)) s = s.slice(0, -1).trim();
  }

  const first = s[0];
  const last = s[s.length - 1];

  const pairs: Record<string, string[]> = {
    '"': ['"'],
    "'": ["'"],
    '“': ['”', '“'],
    '„': ['“', '”'],
    '«': ['»'],
    '‹': ['›'],
  };

  const closing = pairs[first];
  if (closing && closing.includes(last) && s.length >= 2) {
    s = s.slice(1, -1).trim();
  }

  return s;
}

function cleanupSegment(input: string): string {
  let s = String(input ?? '').trim();
  if (!s) return '';

  // remove leading bullets
  s = s.replace(/^[•\-\*\u2022]\s+/, '').trim();

  // strip leading timestamp prefix e.g. "(0:01:14)" or "00:01:14"
  s = s.replace(/^\(?\s*\d{1,2}:\d{2}:\d{2}\)?\s*/, '').trim();

  // strip "könnte ... sagen:" / "could ... say:" prefix (display-only)
  s = s.replace(/^(könnte|could)\s+[\s\S]{0,80}?\b(sagen|say)\b\s*:\s*/i, '').trim();

  s = stripWrappingQuotes(s);
  return s.trim();
}

function parseRewrite(line: any): { original: string; better: string } {
  // 1) Object support (falls rewrites als {original, better} kommen)
  if (line && typeof line === 'object' && !Array.isArray(line)) {
    const o =
      (line as any).original ??
      (line as any).before ??
      (line as any).from ??
      (line as any).old ??
      (line as any).source ??
      null;

    const b =
      (line as any).better ??
      (line as any).after ??
      (line as any).to ??
      (line as any).new ??
      (line as any).target ??
      null;

    const os = typeof o === 'string' ? o.trim() : '';
    const bs = typeof b === 'string' ? b.trim() : '';

    if (os || bs) return { original: os, better: bs || '' };
  }

  const raw = String(line ?? '').trim();
  if (!raw) return { original: '', better: '' };

  const s = raw.replace(/\s+/g, ' ').trim();

  const cleanup = (x: string) => {
    let t = String(x ?? '').trim();

    // bullets
    t = t.replace(/^[•\-*\u2022]\s+/, '').trim();

    // strip leading timecode like "(00:01:14)" or "00:01:14"
    t = t.replace(/^\(?\s*\d{1,2}:\d{2}:\d{2}\s*\)?\s*/, '').trim();

    // strip outer quotes only if they wrap the whole segment
    if (t.length >= 2) {
      const first = t[0];
      const last = t[t.length - 1];
      const pairs = [
        ['"', '"'],
        ['“', '”'],
        ['„', '“'],
        ['“', '“'],
        ['«', '»'],
        ['»', '«'],
        ['‹', '›'],
        ['›', '‹'],
        ["'", "'"],
      ];
      for (const [a, b] of pairs) {
        if (first === a && last === b) {
          t = t.slice(1, -1).trim();
          break;
        }
      }
    }

    // drop trailing punctuation right after closing quote
    t = t.replace(/([”"“'»›])\s*[.,;:!?]$/, '$1').trim();

    return t.trim();
  };

  const extractQuoted = (text: string) => {
    const out: string[] = [];
    // curly + normal double quotes (absichtlich NICHT single quotes wegen Apostrophen)
    // plus guillemets
    const rq = /["“„«»‹›]([\s\S]*?)["”“«»‹›]/g;
    let m;
    while ((m = rq.exec(text)) && out.length < 10) {
      const t = String(m[1] ?? '').trim();
      if (t) out.push(t);
    }
    return out;
  };

  // 2) Label-based: Original: ... Rewritten/Rewrite/Besser/Alternative: ...
  const m1 = s.match(
    /Original\s*:\s*([\s\S]+?)\s*(?:Rewritten|Rewrite|Besser|Alternative|Better)\s*:\s*([\s\S]+)$/i
  );
  if (m1) return { original: cleanup(m1[1]), better: cleanup(m1[2]) };

  // 3) Arrow forms: A -> B
  const m2 = s.match(/^(.*?)\s*(?:->|⇒|→)\s*(.*?)$/);
  if (m2) return { original: cleanup(m2[1]), better: cleanup(m2[2]) };

  // 4) Statt/Anstatt ... sagen: ...  (robust, ohne Quote-Abhängigkeit)
  // Beispiele:
  // - Statt „X“ (00:01:14) könnte die Führungskraft sagen: „Y“
  // - Anstatt: X könnte man sagen: Y
  const mStatt = s.match(
    /^(?:Statt|Anstatt)\b\s*[:\-–—]?\s*([\s\S]+?)\s*\b(?:kann|konnte|könnte|koennte)\b[\s\S]{0,80}?\b(?:sagen|formulieren|schreiben|verwenden)\b\s*:\s*([\s\S]+)$/i
  );
  if (mStatt) return { original: cleanup(mStatt[1]), better: cleanup(mStatt[2]) };

  // 5) Quote fallback (falls kein Statt/Anstatt-Delimiter greift)
  const q = extractQuoted(raw);
  if (q.length >= 2) return { original: cleanup(q[0]), better: cleanup(q[q.length - 1]) };

  // fallback: keep everything on the "better" side
  return { original: '', better: raw };
}

async function copyText(text: string) {
  const t = String(text ?? '').trim();
  if (!t) return;
  try {
    await navigator.clipboard.writeText(t);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

function ScoreRing({ value }: { value: number | null }) {
  const pct = value === null ? 0 : clamp(value, 0, 100);
  const r = 40;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);

  return (
    <div className="relative w-32 h-32 shrink-0">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100" aria-label="Score">
        <circle
          className="text-gray-100 dark:text-slate-800"
          cx="50"
          cy="50"
          r={r}
          fill="transparent"
          stroke="currentColor"
          strokeWidth="8"
        />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="transparent"
          stroke="hsl(var(--primary))"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ filter: 'drop-shadow(0 0 10px rgba(56,189,248,0.30))' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center flex-col">
        <span className="text-3xl font-bold text-gray-900 dark:text-white tabular-nums">
          {value === null ? '—' : Math.round(pct)}
        </span>
        <span className="text-xs font-bold text-gray-500 tracking-wider">GESAMT</span>
      </div>
    </div>
  );
}

function InsightCard({
  tone,
  title,
  items,
}: {
  tone: 'success' | 'warning' | 'danger';
  title: string;
  items: string[];
}) {
  const t = tone;

  const toneBar = t === 'success' ? 'bg-emerald-500' : t === 'warning' ? 'bg-amber-500' : 'bg-red-500';

  const toneText =
    t === 'success'
      ? 'text-emerald-600 dark:text-emerald-400'
      : t === 'warning'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-red-600 dark:text-red-400';

  // ✅ NUR DIE 3 SYMBOLE (wie Stitch)
  const toneIcon = t === 'success' ? 'verified' : t === 'warning' ? 'auto_graph' : 'warning';

  const has = items.length > 0;

  return (
    <div className="glass-panel rounded-2xl relative overflow-hidden">
      <div className={`absolute top-0 left-0 w-1 ${toneBar} h-full`} />
      <div className="p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className={`p-2 rounded-lg bg-gray-50 dark:bg-slate-800/40 ${toneText}`}>
            <span className="material-symbols-outlined text-xl leading-none">{toneIcon}</span>
          </div>
          <h3 className="font-bold text-lg text-gray-900 dark:text-white">{title}</h3>
        </div>

        {!has ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <ul className="space-y-4">
            {items.map((x, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className={`mt-0.5 text-xs ${toneText}`}>●</span>
                <span className="text-sm text-gray-600 dark:text-gray-300">{x}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function CompetencyPanel({ competencies }: { competencies: any[] }) {
  const list = Array.isArray(competencies) ? competencies : [];

  function getId(c: AnyObj) {
    return String(c?.id ?? c?.competencyId ?? '').trim() || 'C?';
  }
  function getName(c: AnyObj) {
    return String(c?.title ?? c?.name ?? c?.label ?? '').trim() || 'Kompetenz';
  }
  function getReason(c: AnyObj) {
    return String(c?.reason ?? c?.why ?? '').trim();
  }
  function getQuotes(c: AnyObj) {
    return asStringArray(c?.quotes ?? c?.evidence ?? []);
  }

  function scoreToPct(c: AnyObj): { pct: number | null; label: string } {
    const s = toNumber(c?.score);
    if (s === null) return { pct: null, label: 'N/A' };

    if (s <= 4) return { pct: clamp((s / 4) * 100, 0, 100), label: `${s}/4` };
    if (s <= 10) return { pct: clamp((s / 10) * 100, 0, 100), label: `${s}/10` };
    return { pct: clamp(s, 0, 100), label: `${Math.round(s)}` };
  }

  function barTone(pct: number | null) {
    if (pct === null) return 'bg-slate-300 dark:bg-slate-700';
    if (pct >= 75) return 'bg-emerald-500';
    if (pct >= 50) return 'bg-[hsl(var(--primary))]';
    if (pct >= 25) return 'bg-amber-500';
    return 'bg-red-500';
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {list.length === 0 ? (
        <div className="text-sm text-muted-foreground">Keine Kompetenzdaten.</div>
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
              <summary className="cursor-pointer list-none p-3 flex items-center justify-between bg-gray-50/50 dark:bg-slate-800/50">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-7 h-7 rounded-md flex items-center justify-center font-bold text-[10px] ${
                      pct === null
                        ? 'bg-gray-100 dark:bg-slate-800 text-gray-500'
                        : 'bg-blue-100 dark:bg-blue-900/30 text-[hsl(var(--primary))]'
                    }`}
                  >
                    {id}
                  </div>
                  <span className="font-medium text-sm text-gray-800 dark:text-gray-200">{name}</span>
                </div>
                <span className={`text-sm font-bold ${pct === null ? 'text-gray-400' : 'text-gray-800 dark:text-gray-200'}`}>
                  {label}
                </span>
              </summary>

              <div className="p-3 pt-2">
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mb-2 mt-1">
                  <div className={`${barTone(pct)} h-1.5 rounded-full`} style={{ width: `${pct ?? 0}%` }} />
                </div>

                {reason ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">{reason}</p>
                ) : (
                  <p className="text-xs text-gray-400">—</p>
                )}

                {quotes.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Zitate</div>
                    <ul className="space-y-1">
                      {quotes.slice(0, 3).map((q, i) => (
                        <li key={i} className="text-xs text-gray-600 dark:text-gray-300">
                          “{q}”
                        </li>
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

export default function ReportDashboard({
  result,
  metaChips,
}: {
  result: AnyObj;
  metaChips?: Array<{ label: string; value: string }>;
}) {
  // NOTE: /runs Seiten liefern ein Run-Objekt (run.analysisJson). Fürs UI entpacken.
  // eslint-disable-next-line no-param-reassign
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

  // Zeige in der Kopfzeile, ob ein Transkript gespeichert wurde
  const chips = useMemo(() => {
    const base = Array.isArray(metaChips) ? [...metaChips] : [];
    if (hasTranscript) base.push({ label: 'Transkript', value: 'gespeichert' });
    return base;
  }, [metaChips, hasTranscript]);


  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);

  const competencies = Array.isArray(result?.competency_ratings)
    ? result.competency_ratings
    : Array.isArray(result?.competencies)
      ? result.competencies
      : [];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* LEFT MAIN COLUMN */}
      <div className="xl:col-span-8 space-y-6">
        {/* HERO */}
        <div className="glass-panel rounded-2xl p-6 md:p-8">
          <div className="flex flex-col md:flex-row items-center gap-8">
            <ScoreRing value={pct} />
            <div className="flex-1 text-center md:text-left">
              <div className="flex flex-col md:flex-row md:items-center gap-3 mb-3 justify-center md:justify-start">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{title}</h2>
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide inline-block w-fit mx-auto md:mx-0 ${badge.cls}`}
                >
                  {badge.label}
                </span>
              </div>

              <p className="text-gray-600 dark:text-gray-300 leading-relaxed text-sm md:text-base max-w-3xl">
                {summary || 'Füge ein Transkript ein und starte die Analyse.'}
              </p>

              {chips.length ? (
                <div className="mt-4 flex flex-wrap gap-2 justify-center md:justify-start">
                  {chips.map((c, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-slate-800 rounded text-xs text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700"
                    >
                      <span className="font-medium">{c.label}:</span> {c.value}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* 3 INSIGHTS */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <InsightCard tone="success" title="Stärken" items={strengths} />
          <InsightCard tone="warning" title="Potenzial" items={improvements} />

        <div className="glass-panel rounded-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 bg-red-500 h-full" />
            <div className="p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="p-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400">
                  <span className="material-symbols-outlined text-xl leading-none">warning</span>
                </div>
                <h3 className="font-bold text-lg text-gray-900 dark:text-white">Risiken</h3>
              </div>

              {riskFlags.length === 0 ? (
                <p className="text-sm text-muted-foreground">—</p>
              ) : (
                <>
                  <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{riskFlags[0]}</p>

                  {riskFlags.length > 1 && (
                    <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
                      <span className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide">
                        Fallstricke
                      </span>
                      <ul className="mt-2 space-y-2">
                        {riskFlags.slice(1, 4).map((x, i) => (
                          <li key={i} className="text-xs text-gray-500 dark:text-gray-400">
                            {x}
                          </li>
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
          <div className="lg:col-span-1 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-slate-800 dark:to-slate-900 p-6 rounded-2xl border border-blue-100 dark:border-slate-700 shadow-sm flex flex-col">
            <div className="flex items-center gap-3 mb-4">
              <div
                className="p-2 bg-[hsl(var(--primary))] rounded-lg text-white shadow-md"
                style={{ boxShadow: '0 10px 24px rgba(56,189,248,0.20)' }}
              >
                <span className="text-sm font-bold">7</span>
              </div>
              <h3 className="font-bold text-lg text-gray-900 dark:text-white">7‑Tage‑Praxis</h3>
            </div>

            <p className="text-sm text-gray-700 dark:text-gray-300 mb-6 flex-1 leading-relaxed">{practice || '—'}</p>

            <button
              type="button"
              className="w-full py-3 bg-white dark:bg-slate-800 text-[hsl(var(--primary))] text-sm font-semibold rounded-xl shadow-sm border border-blue-100 dark:border-slate-600 hover:shadow-md transition-all flex items-center justify-center gap-2"
              onClick={() => {}}
            >
              <span className="text-xs">＋</span>
              (später) Reminder
            </button>
          </div>

          <div className="lg:col-span-2 glass-panel rounded-2xl overflow-hidden flex flex-col">
            <div className="p-5 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-slate-800/30 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-lg text-gray-900 dark:text-white">Vorgeschlagene Umformulierungen</h3>
                <p className="text-xs text-gray-500 mt-1">KI‑generierte Alternativen für bessere Wirkung</p>
              </div>
              <span className="text-gray-400 text-sm">✦</span>
            </div>

            <div className="divide-y divide-gray-100 dark:divide-gray-800 flex-1">
              {rewrites.length === 0 ? (
                <div className="p-5 text-sm text-muted-foreground">—</div>
              ) : (
                rewrites.slice(0, 6).map((r, idx) => (
                  <div key={idx} className="p-5 hover:bg-gray-50 dark:hover:bg-slate-800/40 transition group">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="relative pl-3 border-l-2 border-red-500">
                        <span className="text-[10px] font-bold text-red-600 dark:text-red-400 uppercase tracking-wide block mb-1">
                          Original
                        </span>
                        <p className="text-sm text-gray-500 dark:text-gray-400 italic">{r.original ? `“${r.original}”` : '—'}</p>
                      </div>

                      <div className="relative pl-3 border-l-2 border-emerald-500">
                        <div className="flex justify-between items-start">
                          <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide block mb-1">
                            Besser
                          </span>
                          <button
                            type="button"
                            className="opacity-0 group-hover:opacity-100 transition text-gray-400 hover:text-[hsl(var(--primary))]"
                            title="Kopieren"
                            onClick={async () => {
                              await copyText(r.better || '');
                              setCopiedIdx(idx);
                              setTimeout(() => setCopiedIdx((v) => (v === idx ? null : v)), 900);
                            }}
                          >
                            <span className="text-xs">{copiedIdx === idx ? '✓' : '⧉'}</span>
                          </button>
                        </div>
                        <p className="text-sm text-gray-800 dark:text-gray-200 font-medium">{r.better || '—'}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* TRANSCRIPT */}
        <div className="glass-panel rounded-2xl overflow-hidden">
          <div className="p-5 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-slate-800/30 flex items-start justify-between gap-4">
            <div>
              <h3 className="font-bold text-lg text-gray-900 dark:text-white">Transkript</h3>
              <p className="text-xs text-gray-500 mt-1">
                {hasTranscript
                  ? 'Gespeichert (genau die Version, die analysiert wurde – bei Datenschutz ggf. anonymisiert).'
                  : 'Nicht gespeichert (Toggle „Transkript speichern“ war aus).'}
              </p>
            </div>

            {hasTranscript ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="px-3 py-2 rounded-xl text-xs font-semibold border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200"
                  onClick={() => copyText(transcript)}
                  title="Transkript kopieren"
                >
                  ⧉ Kopieren
                </button>

                <button
                  type="button"
                  className="px-3 py-2 rounded-xl text-xs font-semibold border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200"
                  onClick={() => setShowTranscript((v) => !v)}
                >
                  {showTranscript ? 'Verbergen' : 'Anzeigen'}
                </button>
              </div>
            ) : null}
          </div>

          {hasTranscript ? (
            showTranscript ? (
              <div className="p-5">
                <pre className="whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200 font-mono bg-gray-50 dark:bg-slate-900/30 rounded-xl p-4 border border-gray-100 dark:border-gray-800 max-h-[520px] overflow-auto">
                  {transcript}
                </pre>
              </div>
            ) : (
              <div className="p-5 text-sm text-muted-foreground">Ausgeblendet.</div>
            )
          ) : (
            <div className="p-5 text-sm text-muted-foreground">
              Für diesen Run wurde kein Transkript gespeichert. Wenn du es später im Verlauf wiedersehen möchtest,
              aktiviere in der Analyse „Transkript speichern“.
            </div>
          )}
        </div>
      </div>

      {/* RIGHT COLUMN (SIDEBAR) */}
      <div className="xl:col-span-4 w-full space-y-6 sticky top-24">
        <div className="glass-panel rounded-2xl p-4">
          <div className="mb-4 px-2">
            <h3 className="font-bold text-lg text-gray-900 dark:text-white">Kompetenzen</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">Erkannte Fähigkeiten in diesem Gespräch</p>
          </div>
          <CompetencyPanel competencies={competencies} />
        </div>
      </div>

    </div>
  );
}
