/**
 * Transcript processing utilities extracted from AnalyzeClient.
 * Pure functions – no React dependencies, fully testable.
 */

/* ------------------------------------------------------------------ */
/*  String helpers                                                     */
/* ------------------------------------------------------------------ */

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function replaceToken(text: string, token: string, replacement: string): string {
  const t = (token ?? '').trim();
  if (!t) return text;

  const pattern = `(?<![\\p{L}\\p{N}_])${escapeRegExp(t)}(?![\\p{L}\\p{N}_])`;
  try {
    const re = new RegExp(pattern, 'gu');
    return text.replace(re, replacement);
  } catch {
    return text.split(t).join(replacement);
  }
}

export function parseExtraTerms(raw: string): string[] {
  return (raw ?? '')
    .split(/[,;\n]/g)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2);
}

/* ------------------------------------------------------------------ */
/*  Teams transcript cleanup                                           */
/* ------------------------------------------------------------------ */

export function cleanTeamsTranscript(text: string): string {
  const lines = String(text ?? '').split(/\r?\n/);
  const kept = lines.filter((line) => {
    const s = line.trim();
    if (/^\d{2}:\d{2}:\d{2}\s+/.test(s)) return true;
    if (/^[A-Za-zÄÖÜäöüß]{1,8}:\s+/.test(s)) return true;
    if (/^(Datum|Dauer)\s*:/i.test(s)) return true;
    return false;
  });
  return (kept.length ? kept.join('\n') : String(text ?? '')).trim();
}

/* ------------------------------------------------------------------ */
/*  Speaker detection                                                  */
/* ------------------------------------------------------------------ */

const IGNORED_SPEAKERS = new Set([
  'datum', 'dauer', 'date', 'duration', 'uhrzeit',
  'time', 'subject', 'betreff', 'organizer', 'organisator',
]);

export function detectSpeakers(text: string): string[] {
  const speakers = new Set<string>();
  const lines = String(text ?? '').split(/\r?\n/);

  for (const line of lines) {
    const s = line.trim();
    const m = s.match(/^\d{2}:\d{2}:\d{2}\s+([^:]{1,120}):\s+/);
    if (m?.[1]) {
      const name = m[1].trim();
      const key = name.toLowerCase();
      if (name && key !== 'microsoft teams' && !IGNORED_SPEAKERS.has(key)) speakers.add(name);
      continue;
    }
    const m2 = s.match(/^([A-Za-zÄÖÜäöüß]{1,16}):\s+/);
    if (m2?.[1]) {
      const name = m2[1].trim();
      const key = name.toLowerCase();
      if (name && !IGNORED_SPEAKERS.has(key)) speakers.add(name);
    }
  }

  return Array.from(speakers);
}

/* ------------------------------------------------------------------ */
/*  Anonymisation                                                      */
/* ------------------------------------------------------------------ */

export interface SanitizeOptions {
  leaderLabel: string;
  employeeLabel: string;
  detectedSpeakers: string[];
  extraTerms: string[];
}

export function sanitizeTranscript(text: string, opts: SanitizeOptions): string {
  let out = String(text ?? '');

  // PII patterns
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]');
  out = out.replace(/\bhttps?:\/\/\S+/gi, '[URL]');
  out = out.replace(/\bwww\.\S+/gi, '[URL]');
  out = out.replace(/(\+?\d[\d\s().-]{7,}\d)/g, '[TEL]');

  // Project / Customer names in quotes
  out = out.replace(/\bProjekt\s*[""„']([^"""„'\n]{1,120})["""„']/giu, 'Projekt [PROJEKT]');
  out = out.replace(/\b(Kunde|Kunden|Customer)\s*[""„']([^"""„'\n]{1,120})["""„']/giu, '$1 [KUNDE]');

  // Map speakers to generic labels
  const leader = (opts.leaderLabel ?? '').trim();
  const employee = (opts.employeeLabel ?? '').trim();

  const speakerMap = new Map<string, string>();
  if (leader) speakerMap.set(leader, 'Führungskraft');
  if (employee) speakerMap.set(employee, 'Mitarbeiter:in');

  let personIdx = 1;
  for (const sp of opts.detectedSpeakers ?? []) {
    const k = String(sp ?? '').trim();
    if (!k || speakerMap.has(k)) continue;
    speakerMap.set(k, `Person ${personIdx++}`);
  }

  const keys = Array.from(speakerMap.keys()).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    const rep = speakerMap.get(k)!;
    out = replaceToken(out, k, rep);
    const parts = k.split(/\s+/).map((p) => p.trim()).filter((p) => p.length >= 3);
    for (const p of parts) out = replaceToken(out, p, rep);
  }

  // Extra terms
  const extras = (opts.extraTerms ?? []).map((t) => t.trim()).filter((t) => t.length >= 2);
  const uniqueExtras = Array.from(new Set(extras)).sort((a, b) => b.length - a.length);
  uniqueExtras.forEach((term, i) => {
    out = replaceToken(out, term, `[ANON_${i + 1}]`);
  });

  // Whitespace cleanup
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return out;
}
