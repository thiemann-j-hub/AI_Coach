/**
 * Report-dashboard utility functions.
 * Extracted from report-dashboard.tsx for reuse and testability.
 */

type AnyObj = Record<string, any>;

export function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n));
}

export function toNumber(v: any): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

export function overallToPercent(result: AnyObj): number | null {
  const raw = toNumber(result?.scores?.overall ?? result?.scoreOverall ?? result?.overall);
  if (raw === null) return null;
  if (raw <= 10) return clamp(raw * 10, 0, 100);
  return clamp(raw, 0, 100);
}

export function scoreTitle(pct: number | null): string {
  if (pct === null) return 'Analyse bereit';
  if (pct >= 85) return 'Sehr starke Gesprächsführung';
  if (pct >= 70) return 'Gute Gesprächsführung';
  if (pct >= 55) return 'Solide Basis';
  return 'Ausbaufähig';
}

export function scoreBadge(pct: number | null): { label: string; cls: string } {
  if (pct === null) return { label: '—', cls: 'bg-foreground/5 text-muted-foreground' };
  if (pct >= 85) return { label: 'Sehr stark', cls: 'bg-emerald-500/15 text-emerald-400' };
  if (pct >= 70) return { label: 'Stark', cls: 'bg-primary/15 text-primary' };
  if (pct >= 55) return { label: 'Solide', cls: 'bg-amber-500/15 text-amber-400' };
  return { label: 'Fokus nötig', cls: 'bg-red-500/15 text-red-400' };
}

export function asStringArray(v: any): string[] {
  return Array.isArray(v)
    ? v.map((x) => String(x ?? '')).map((s) => s.trim()).filter(Boolean)
    : [];
}

export function pickPractice(result: AnyObj): string | null {
  const cands = [
    result?.practice7Days, result?.sevenDayPractice, result?.practice_7days,
    result?.practice7days, result?.practice, result?.exercise7Days,
    result?.exercise, result?.next7Days,
  ];
  for (const c of cands) {
    const s = typeof c === 'string' ? c.trim() : '';
    if (s) return s;
  }
  const fallback = asStringArray(result?.improvements ?? result?.potential ?? result?.improvementAreas);
  if (fallback.length) return fallback[0];
  return null;
}

export function stripWrappingQuotes(input: string): string {
  let s = String(input ?? '').trim();
  if (!s) return '';
  s = s.replace(/^[•\-\*\u2022]\s+/, '').trim();
  if (s.length >= 2 && /[.,;:!?]$/.test(s)) {
    const prev = s[s.length - 2];
    if ('"\'“”‘’»›'.includes(prev)) s = s.slice(0, -1).trim();
  }
  const first = s[0];
  const last = s[s.length - 1];
  // Achtung: Keys muessen distinkte typografische Zeichen bleiben — Tooling,
  // das sie zu ASCII normalisiert, erzeugt identische Keys (TS1117-Bug).
  const pairs: Record<string, string[]> = {
    '"': ['"'],
    "'": ["'"],
    '“': ['”', '“'],
    '„': ['“', '”'],
    '‘': ['’', '‘'],
    '‚': ['‘', '’'],
    '«': ['»'],
    '‹': ['›'],
  };
  const closing = pairs[first];
  if (closing && closing.includes(last) && s.length >= 2) s = s.slice(1, -1).trim();
  return s;
}

export function parseRewrite(line: any): { original: string; better: string } {
  if (line && typeof line === 'object' && !Array.isArray(line)) {
    const o = (line as any).original ?? (line as any).before ?? (line as any).from ?? (line as any).old ?? (line as any).source ?? null;
    const b = (line as any).better ?? (line as any).after ?? (line as any).to ?? (line as any).new ?? (line as any).target ?? null;
    const os = typeof o === 'string' ? o.trim() : '';
    const bs = typeof b === 'string' ? b.trim() : '';
    if (os || bs) return { original: os, better: bs || '' };
  }

  const raw = String(line ?? '').trim();
  if (!raw) return { original: '', better: '' };
  const s = raw.replace(/\s+/g, ' ').trim();

  const cleanup = (x: string) => {
    let t = String(x ?? '').trim();
    t = t.replace(/^[•\-*\u2022]\s+/, '').trim();
    t = t.replace(/^\(?\s*\d{1,2}:\d{2}:\d{2}\s*\)?\s*/, '').trim();
    if (t.length >= 2) {
      const first = t[0]; const last = t[t.length - 1];
      const pairs = [['"', '"'], ['"', '"'], ['„', '"'], ['"', '"'], ['«', '»'], ['»', '«'], ['‹', '›'], ['›', '‹'], ["'", "'"]];
      for (const [a, b] of pairs) { if (first === a && last === b) { t = t.slice(1, -1).trim(); break; } }
    }
    t = t.replace(/(["""'»›])\s*[.,;:!?]$/, '$1').trim();
    return t.trim();
  };

  const extractQuoted = (text: string) => {
    const out: string[] = [];
    const rq = /[""„«»‹›]([\s\S]*?)["""«»‹›]/g;
    let m;
    while ((m = rq.exec(text)) && out.length < 10) {
      const t = String(m[1] ?? '').trim();
      if (t) out.push(t);
    }
    return out;
  };

  const m1 = s.match(/Original\s*:\s*([\s\S]+?)\s*(?:Rewritten|Rewrite|Besser|Alternative|Better)\s*:\s*([\s\S]+)$/i);
  if (m1) return { original: cleanup(m1[1]), better: cleanup(m1[2]) };

  const m2 = s.match(/^(.*?)\s*(?:->|⇒|→)\s*(.*?)$/);
  if (m2) return { original: cleanup(m2[1]), better: cleanup(m2[2]) };

  const mStatt = s.match(/^(?:Statt|Anstatt)\b\s*[:\-–—]?\s*([\s\S]+?)\s*\b(?:kann|konnte|könnte|koennte)\b[\s\S]{0,80}?\b(?:sagen|formulieren|schreiben|verwenden)\b\s*:\s*([\s\S]+)$/i);
  if (mStatt) return { original: cleanup(mStatt[1]), better: cleanup(mStatt[2]) };

  const q = extractQuoted(raw);
  if (q.length >= 2) return { original: cleanup(q[0]), better: cleanup(q[q.length - 1]) };

  return { original: '', better: raw };
}

export async function copyText(text: string): Promise<void> {
  const t = String(text ?? '').trim();
  if (!t) return;
  try {
    await navigator.clipboard.writeText(t);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = t; ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
  }
}

export function unwrapRunResult(input: AnyObj): AnyObj {
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
