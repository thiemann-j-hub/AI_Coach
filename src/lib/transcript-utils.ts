/**
 * Transcript processing utilities extracted from AnalyzeClient.
 * Pure functions – no React dependencies, fully testable.
 */

import {
  applyCityPii,
  applyOrgPii,
  applyPersonPii,
  applyStructuredPii,
  createNumberer,
  type PiiFinding,
} from './pii/pii';

export type { PiiFinding } from './pii/pii';

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

/**
 * Sprecherzeile im manuellen Format "Name: Text" — 1–4 Wörter vor dem Doppelpunkt.
 * Erfasst auch volle Namen ("Anna Müller:", "Dr. Anna Müller-Schmidt:") und nicht
 * nur Ein-Wort-Kürzel wie "FK:" (Live-Testfund: mehrwortige Namen wurden nie
 * erkannt → Rollen-Dropdown blieb leer → Analyse-Start unmöglich). Folgewörter
 * müssen großgeschrieben beginnen — das begrenzt Fehltreffer auf Fließtext-
 * Phrasen wie "wichtig zu beachten:".
 */
const NAME_LINE_RE = /^([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß.'’-]{0,19}(?:[ \t]+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß.'’-]{0,19}){0,3}):\s+/;

export function cleanTeamsTranscript(text: string): string {
  const lines = String(text ?? '').split(/\r?\n/);
  const kept = lines.filter((line) => {
    const s = line.trim();
    if (/^\d{2}:\d{2}:\d{2}\s+/.test(s)) return true;
    if (NAME_LINE_RE.test(s)) return true;
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
    const m2 = s.match(NAME_LINE_RE);
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

export interface SanitizeResult {
  text: string;
  /**
   * Alles, was ersetzt wurde (Klartext → Platzhalter). Bleibt im Browser —
   * das ist das »Mapping« aus dem Presidio-Konzept. Steckdose fürs spätere
   * zweite Netz (EU-NER-Service hängt hier einfach weitere Findings an).
   */
  findings: PiiFinding[];
}

/**
 * Browser-Anonymisierung, Netz 1 (N1+, PRESIDIO-ANONYMISIERUNG-BLUEPRINT).
 * Reihenfolge ist tragend:
 *  1. strukturierte PII (E-Mail/URL/Tel/IBAN/Karte/Nummern/Geburtsdatum/…)
 *  2. Firmen (Rechtsform + Trigger)
 *  3. zitierte Projekt-/Kundennamen (Bestand)
 *  4. Sprecher → Führungskraft / Mitarbeiter:in / Person n (Bestand)
 *  5. Dritte im Fließtext (Anrede/Titel + Vornamen-Wörterbuch, konsolidiert)
 *  6. Orte (Städteliste hinter lokativen Präpositionen)
 *  7. Zusatzbegriffe des Nutzers
 */
export function sanitizeTranscriptWithFindings(
  text: string,
  opts: SanitizeOptions
): SanitizeResult {
  let out = String(text ?? '');
  const findings: PiiFinding[] = [];
  const numberFor = createNumberer();

  // 1) Strukturierte PII (Prüfsummen + Kontext — von Presidio gelernt)
  const structured = applyStructuredPii(out);
  out = structured.text;
  findings.push(...structured.findings);

  // 2) Firmen (Rechtsform/Trigger) — vor den Personen, damit »Meier GmbH«
  //    nicht fälschlich als Person endet.
  const orgs = applyOrgPii(out, numberFor);
  out = orgs.text;
  findings.push(...orgs.findings);

  // 3) Projekt-/Kundennamen in Anführungszeichen (Bestand)
  out = out.replace(/\bProjekt\s*[""„']([^"""„'\n]{1,120})["""„']/giu, 'Projekt [PROJEKT]');
  out = out.replace(/\b(Kunde|Kunden|Customer)\s*[""„']([^"""„'\n]{1,120})["""„']/giu, '$1 [KUNDE]');

  // 4) Sprecher → generische Labels (Bestand; Zuordnung bleibt intakt)
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

  // 5) Dritte im Fließtext — Nummerierung führt die Sprecher-Zählung fort.
  const persons = applyPersonPii(out, personIdx);
  out = persons.text;
  findings.push(...persons.findings);

  // 6) Orte
  const cities = applyCityPii(out, numberFor);
  out = cities.text;
  findings.push(...cities.findings);

  // 7) Zusatzbegriffe des Nutzers (Denylist — wie Presidio, gab es schon)
  const extras = (opts.extraTerms ?? []).map((t) => t.trim()).filter((t) => t.length >= 2);
  const uniqueExtras = Array.from(new Set(extras)).sort((a, b) => b.length - a.length);
  uniqueExtras.forEach((term, i) => {
    out = replaceToken(out, term, `[ANON_${i + 1}]`);
  });

  // Whitespace cleanup
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return { text: out, findings };
}

/** Bestands-API: liefert nur den Text (Client-Aufrufer unverändert). */
export function sanitizeTranscript(text: string, opts: SanitizeOptions): string {
  return sanitizeTranscriptWithFindings(text, opts).text;
}
