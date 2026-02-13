'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppShell from '@/components/app/app-shell';
import PdfUpload from '@/components/app/pdf-upload';

type AnalyzeResult = any;

const STORAGE_KEY = 'commscoach_sessionId';

function newSessionId(): string {
  const c: any = globalThis.crypto as any;
  if (c?.randomUUID) return c.randomUUID();
  return `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function shortId(id?: string, n = 18) {
  const s = String(id ?? '');
  if (!s) return '—';
  if (s.length <= n) return s;
  return s.slice(0, n) + '…';
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceToken(text: string, token: string, replacement: string) {
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

function parseExtraTerms(raw: string): string[] {
  return (raw ?? '')
    .split(/[,;\n]/g)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2);
}

function cleanTeamsTranscript(text: string): string {
  const lines = String(text ?? '').split(/\r?\n/);
  const kept = lines.filter((line) => {
    const s = line.trim();
    if (/^\d{2}:\d{2}:\d{2}\s+/.test(s)) return true; // Teams timestamp
    if (/^[A-Za-zÄÖÜäöüß]{1,8}:\s+/.test(s)) return true; // FK: / MA: etc.
    if (/^(Datum|Dauer)\s*:/i.test(s)) return true;
    return false;
  });

  return (kept.length ? kept.join('\n') : String(text ?? '')).trim();
}


function detectSpeakers(text: string): string[] {
  const speakers = new Set<string>();
  const lines = String(text ?? '').split(/\r?\n/);

  // Ignore common metadata labels that look like "Label: ..."
  const IGNORE = new Set([
    'datum',
    'dauer',
    'date',
    'duration',
    'uhrzeit',
    'time',
    'subject',
    'betreff',
    'organizer',
    'organisator',
  ]);

  for (const line of lines) {
    const s = line.trim();

    // Teams format: "00:00:00 Anna Müller: ..."
    const m = s.match(/^\d{2}:\d{2}:\d{2}\s+([^:]{1,120}):\s+/);
    if (m?.[1]) {
      const name = m[1].trim();
      const key = name.toLowerCase();
      if (name && key !== 'microsoft teams' && !IGNORE.has(key)) speakers.add(name);
      continue;
    }

    // Simple label format: "FK: ..." / "MA: ..." / etc.
    const m2 = s.match(/^([A-Za-zÄÖÜäöüß]{1,16}):\s+/);
    if (m2?.[1]) {
      const name = m2[1].trim();
      const key = name.toLowerCase();
      if (name && !IGNORE.has(key)) speakers.add(name);
    }
  }

  return Array.from(speakers);
}


/**
 * Client-side privacy sanitizer (NO LLM).
 */
function sanitizeTranscript(
  text: string,
  opts: {
    leaderLabel: string;
    employeeLabel: string;
    detectedSpeakers: string[];
    extraTerms: string[];
  }
) {
  let out = String(text ?? '');

  // basic patterns
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]');
  out = out.replace(/\bhttps?:\/\/\S+/gi, '[URL]');
  out = out.replace(/\bwww\.\S+/gi, '[URL]');
  out = out.replace(/(\+?\d[\d\s().-]{7,}\d)/g, '[TEL]');

  // quoted projects/customers
  out = out.replace(/\bProjekt\s*[“"„']([^”"“„'\n]{1,120})[”"“„']/giu, 'Projekt [PROJEKT]');
  out = out.replace(/\b(Kunde|Kunden|Customer)\s*[“"„']([^”"“„'\n]{1,120})[”"“„']/giu, '$1 [KUNDE]');

  // speaker mapping
  const leader = (opts.leaderLabel ?? '').trim();
  const employee = (opts.employeeLabel ?? '').trim();

  const speakerMap = new Map<string, string>();
  if (leader) speakerMap.set(leader, 'Führungskraft');
  if (employee) speakerMap.set(employee, 'Mitarbeiter:in');

  let personIdx = 1;
  for (const sp of opts.detectedSpeakers ?? []) {
    const k = String(sp ?? '').trim();
    if (!k) continue;
    if (speakerMap.has(k)) continue;
    speakerMap.set(k, `Person ${personIdx++}`);
  }

  // replace full names first, then parts
  const keys = Array.from(speakerMap.keys()).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    const rep = speakerMap.get(k)!;
    out = replaceToken(out, k, rep);
    const parts = k.split(/\s+/).map((p) => p.trim()).filter((p) => p.length >= 3);
    for (const p of parts) out = replaceToken(out, p, rep);
  }

  // extra terms
  const extras = (opts.extraTerms ?? []).map((t) => t.trim()).filter((t) => t.length >= 2);
  const uniqueExtras = Array.from(new Set(extras)).sort((a, b) => b.length - a.length);
  uniqueExtras.forEach((term, i) => {
    out = replaceToken(out, term, `[ANON_${i + 1}]`);
  });

  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

async function readErrorText(res: Response) {
  const t = await res.text();
  try {
    const j = JSON.parse(t);
    return String(j?.error || j?.message || t || res.statusText);
  } catch {
    return String(t || res.statusText);
  }
}

function Card(props: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="glass-panel">
      <div className="mb-4">
        <div className="text-base font-bold text-foreground">{props.title}</div>
        {props.subtitle ? <div className="text-sm text-muted-foreground mt-1">{props.subtitle}</div> : null}
      </div>
      {props.children}
    </section>
  );
}

export default function AnalyzeClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [sessionId, setSessionId] = useState<string>('');

  const [lang, setLang] = useState<'de' | 'en'>('de');
  const [goal, setGoal] = useState<string>('');

  const [transcriptText, setTranscriptText] = useState<string>('');
  const [undoTranscript, setUndoTranscript] = useState<string | null>(null);

  const detectedSpeakers = useMemo(() => {
    const raw = detectSpeakers(transcriptText);
    const blocked = new Set(['datum', 'dauer', 'date', 'duration']);
    return raw.filter((sp) => !blocked.has(String(sp ?? '').trim().toLowerCase()));
  }, [transcriptText]);

  const [leaderLabel, setLeaderLabel] = useState<string>('');
  const [employeeLabel, setEmployeeLabel] = useState<string>('');

  const leaderFound = useMemo(() => {
    const l = leaderLabel.trim();
    return !!l && transcriptText.includes(l);
  }, [leaderLabel, transcriptText]);

  const employeeFound = useMemo(() => {
    const e = employeeLabel.trim();
    return !!e && transcriptText.includes(e);
  }, [employeeLabel, transcriptText]);

  const [privacyMode, setPrivacyMode] = useState(true);
  const [extraTerms, setExtraTerms] = useState('');
  const [autoSave, setAutoSave] = useState(true);
  const [saveTranscript, setSaveTranscript] = useState(false);

  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // sessionId sync (URL <-> localStorage)
  useEffect(() => {
    const urlSid = searchParams.get('sessionId');
    if (urlSid && urlSid.trim()) {
      const sid = urlSid.trim();
      setSessionId(sid);
      try {
        localStorage.setItem(STORAGE_KEY, sid);
      } catch {}
      return;
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && stored.trim()) {
        setSessionId(stored.trim());
        router.replace(`/analyze?sessionId=${encodeURIComponent(stored.trim())}`);
        return;
      }
    } catch {}

    const sid = newSessionId();
    setSessionId(sid);
    try {
      localStorage.setItem(STORAGE_KEY, sid);
    } catch {}
    router.replace(`/analyze?sessionId=${encodeURIComponent(sid)}`);
  }, [searchParams, router]);

  // prefill labels if transcript uses FK/MA
  useEffect(() => {
    if (!transcriptText) return;
    if (!leaderLabel && transcriptText.includes('FK:')) setLeaderLabel('FK');
    if (!employeeLabel && transcriptText.includes('MA:')) setEmployeeLabel('MA');
  }, [transcriptText, leaderLabel, employeeLabel]);

  const privacyPreview = useMemo(() => {
    if (!privacyMode) return '';
    const l = leaderLabel.trim();
    const e = employeeLabel.trim();
    if (!l || !e) return '';
    try {
      const sanitized = sanitizeTranscript(transcriptText, {
        leaderLabel: l,
        employeeLabel: e,
        detectedSpeakers,
        extraTerms: parseExtraTerms(extraTerms),
      });
      return sanitized.slice(0, 400);
    } catch {
      return '';
    }
  }, [privacyMode, transcriptText, leaderLabel, employeeLabel, detectedSpeakers, extraTerms]);

  const actions = (
    <button
      className="hidden sm:inline-flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
      onClick={() => {
        const sid = sessionId.trim();
        if (!sid) return;
        router.push(`/runs-dashboard?sessionId=${encodeURIComponent(sid)}`);
      }}
    >
      <span className="material-symbols-outlined">history</span>
      Verlauf
    </button>
  );

  async function onAnalyze() {
    setError(null);

    const sid = sessionId.trim();
    if (!sid) {
      setError('SessionId fehlt.');
      return;
    }

    const t = transcriptText.trim();
    if (!t) {
      setError('Bitte zuerst ein Transkript einfügen oder PDF hochladen.');
      return;
    }

    const l = leaderLabel.trim();
    let e = employeeLabel.trim();

    // Auto-Ableitung: wenn genau 2 Sprecher und MA noch leer
    if (!e && l && detectedSpeakers.length === 2) {
      const other = detectedSpeakers.find((s) => s !== l) ?? '';
      if (other) {
        e = other;
        if (employeeLabel.trim() !== other) setEmployeeLabel(other);
      }
    }

    if (!l) {
      setError('Bitte Führungskraft wählen.');
      return;
    }
    if (!e) {
      setError('Bitte Mitarbeitende wählen.');
      return;
    }
    if (l === e) {
      setError('Führungskraft und Mitarbeitende dürfen nicht identisch sein.');
      return;
    }

    setLoading(true);
    setStep('Analyse läuft…');

    try {
      const transcriptToSend = privacyMode
        ? sanitizeTranscript(transcriptText, {
            leaderLabel: l,
            employeeLabel: e,
            detectedSpeakers,
            extraTerms: parseExtraTerms(extraTerms),
          })
        : transcriptText;

      // Wir bleiben (vorerst) beim Mitarbeitendengespräch, aber senden technisch weiterhin eine stabile conversationType,
      // damit RAG nicht ins Leere läuft. Später machen wir das sauber als Auswahl.
      const payload = {
        conversationType: 'feedback',
        conversationSubType: 'mitarbeitendengespräch',
        goal: goal.trim() || undefined,
        transcriptText: transcriptToSend,
        lang,
        jurisdiction: lang === 'de' ? 'de_eu' : 'en_us',
        leaderLabel: l,
        employeeLabel: e,
      };

      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const msg = await readErrorText(res);
        throw new Error(msg);
      }

      const j = await res.json();
      if (!j?.ok) throw new Error(String(j?.error || 'Analyse fehlgeschlagen.'));
      const result: AnalyzeResult = j.result;

      if (!autoSave) {
        setStep('Analyse fertig (nicht gespeichert).');
        setLoading(false);
        return;
      }

      setStep('Speichere Run…');

      const savePayload = {
        sessionId: sid,
        request: {
          conversationType: payload.conversationType,
          conversationSubType: payload.conversationSubType,
          goal: payload.goal ?? null,
          lang: payload.lang,
          jurisdiction: payload.jurisdiction,
          leaderLabel: payload.leaderLabel,
          employeeLabel: payload.employeeLabel,
          transcriptText: saveTranscript ? transcriptToSend : null,
        },
        options: { storeTranscript: saveTranscript },
        result,
      };

      const saveRes = await fetch('/api/runs/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(savePayload),
      });

      if (!saveRes.ok) {
        const msg = await readErrorText(saveRes);
        throw new Error(msg);
      }

      const sj = await saveRes.json();
      if (!sj?.ok || !sj?.runId) throw new Error(String(sj?.error || 'Speichern fehlgeschlagen.'));
      const runId = String(sj.runId);

      setStep('Öffne Bericht…');
      router.push(`/runs/${encodeURIComponent(sid)}/${encodeURIComponent(runId)}`);
    } catch (e: any) {
      setError(String(e?.message || e || 'Unbekannter Fehler'));
    } finally {
      setLoading(false);
      setStep(null);
    }
  }

  return (
    <AppShell title="Analyse" subtitle={`Session: ${shortId(sessionId)}`} actions={actions}>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Transcript */}
          <div className="lg:col-span-2 space-y-6">
            <Card title="Transkript" subtitle="PDF hochladen oder Text einfügen">
              <div className="space-y-4">
                {/* PDF Upload (deine vorhandene Komponente) */}
                <PdfUpload
                  onApplyText={(txt, mode) => {
                    setUndoTranscript(transcriptText);
                    if (mode === 'append' && transcriptText.trim()) {
                      setTranscriptText(`${transcriptText.trim()}\n\n${txt.trim()}`);
                    } else {
                      setTranscriptText(txt);
                    }
                  }}
                  cleaner={cleanTeamsTranscript}
                />

                {/* Actions */}
                <div className="flex flex-wrap gap-2">
                  <button
                    className="inline-flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
                    onClick={() => {
                      setUndoTranscript(transcriptText);
                      setTranscriptText(cleanTeamsTranscript(transcriptText));
                    }}
                    disabled={!transcriptText.trim() || loading}
                  >
                    <span className="material-symbols-outlined">auto_fix_high</span>
                    Teams bereinigen
                  </button>

                  <button
                    className="inline-flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
                    onClick={() => {
                      const l = leaderLabel.trim();
                      const e = employeeLabel.trim();
                      if (!l || !e) return;
                      setUndoTranscript(transcriptText);
                      setTranscriptText(
                        sanitizeTranscript(transcriptText, {
                          leaderLabel: l,
                          employeeLabel: e,
                          detectedSpeakers,
                          extraTerms: parseExtraTerms(extraTerms),
                        })
                      );
                    }}
                    disabled={!transcriptText.trim() || !leaderLabel.trim() || !employeeLabel.trim() || loading}
                  >
                    <span className="material-symbols-outlined">shield_person</span>
                    Anonymisieren
                  </button>

                  <button
                    className="inline-flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
                    onClick={() => {
                      if (!undoTranscript) return;
                      const cur = transcriptText;
                      setTranscriptText(undoTranscript);
                      setUndoTranscript(cur);
                    }}
                    disabled={!undoTranscript || loading}
                  >
                    <span className="material-symbols-outlined">undo</span>
                    Undo
                  </button>

                  <button
                    className="inline-flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
                    onClick={() => {
                      setUndoTranscript(transcriptText);
                      setTranscriptText('');
                    }}
                    disabled={!transcriptText.trim() || loading}
                  >
                    <span className="material-symbols-outlined">delete</span>
                    Clear
                  </button>
                </div>

                {/* Textarea */}
                <div>
                  <div className="text-xs text-slate-400 mb-2">Transkript</div>
                  <textarea
                    className="w-full min-h-[340px] rounded-2xl bg-[#0B1221] border border-[#1F2937] p-4 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-sky-400/50 focus:ring-1 focus:ring-sky-400/20"
                    placeholder="Hier steht nach dem PDF-Upload der Text… oder du fügst ihn manuell ein."
                    value={transcriptText}
                    onChange={(e) => setTranscriptText(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>
            </Card>
          </div>

          {/* Right: Settings */}
          <div className="lg:col-span-1 space-y-6">
            <Card title="Einstellungen">
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-slate-400 mb-2">Sprache</div>
                  <select
                    className="w-full rounded-2xl bg-[#0B1221] border border-[#1F2937] px-3 py-3 text-sm text-slate-100 outline-none focus:border-sky-400/50"
                    value={lang}
                    onChange={(e) => setLang(e.target.value as any)}
                    disabled={loading}
                  >
                    <option value="de">Deutsch</option>
                    <option value="en">Englisch</option>
                  </select>
                  <div className="text-xs text-slate-500 mt-2">
                    (Deutsch/Englisch ist vorbereitet – Logik kann später erweitert werden.)
                  </div>
                </div>

                <div>
                  <div className="text-xs text-slate-400 mb-2">Ziel (optional)</div>
                  <input
                    className="w-full rounded-2xl bg-[#0B1221] border border-[#1F2937] px-3 py-3 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-sky-400/50 focus:ring-1 focus:ring-sky-400/20"
                    placeholder="z.B. klar und fair, ohne Eskalation"
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    disabled={loading}
                  />
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs text-slate-400 mb-1">Gesprächsart</div>
                  <div className="text-sm font-medium text-white">Mitarbeitendengespräch</div>
                  <div className="text-xs text-slate-500 mt-1">
                    (Conversation-Type ist aktuell technisch fix, damit RAG stabil bleibt.)
                  </div>
                </div>
              </div>
            </Card>

            <Card title="Rollen im Gespräch" subtitle="Wähle die Führungskraft (Mitarbeitende wird automatisch gesetzt)">
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-slate-400 mb-2">Führungskraft (Ich)</div>
                  <div className="relative">
                    <select
                      className="w-full appearance-none rounded-2xl bg-[#0B1221] border border-[#1F2937] px-3 py-3 pr-10 text-sm text-slate-100 outline-none focus:border-sky-400/50"
                      value={leaderLabel}
                      onChange={(e) => {
                        const v = e.target.value;
                        setLeaderLabel(v);

                        // Wenn genau 2 Sprecher erkannt: Mitarbeitende automatisch setzen
                        if (detectedSpeakers.length === 2) {
                          const other = detectedSpeakers.find((s) => s !== v) ?? '';
                          setEmployeeLabel(other || '');
                        } else {
                          // Bei >2 Sprechern: falls alte Auswahl unlogisch ist, zurücksetzen
                          if (employeeLabel.trim() === v) setEmployeeLabel('');
                        }
                      }}
                      disabled={loading || detectedSpeakers.length === 0}
                    >
                      <option value="">
                        {detectedSpeakers.length === 0 ? 'Transkript einfügen…' : 'Bitte auswählen…'}
                      </option>
                      {detectedSpeakers.map((sp) => (
                        <option key={sp} value={sp}>
                          {sp} (Ich)
                        </option>
                      ))}
                    </select>
                    <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                      expand_more
                    </span>
                  </div>

                  <div className="text-xs text-slate-500 mt-2">
                    Tipp: Nach Upload/Einfügen werden Sprecher automatisch erkannt.
                  </div>
                </div>

                <div>
                  <div className="text-xs text-slate-400 mb-2">Mitarbeitende</div>

                  {detectedSpeakers.length <= 2 ? (
                    <input
                      className="w-full rounded-2xl bg-[#0B1221] border border-[#1F2937] px-3 py-3 text-sm text-slate-100 placeholder:text-slate-500 outline-none"
                      value={
                        employeeLabel ||
                        (leaderLabel.trim() && detectedSpeakers.length === 2
                          ? (detectedSpeakers.find((s) => s !== leaderLabel.trim()) ?? '')
                          : '')
                      }
                      readOnly
                      placeholder={leaderLabel.trim() ? 'wird automatisch gesetzt…' : 'wähle zuerst die Führungskraft…'}
                    />
                  ) : (
                    <div className="space-y-2">
                      <div className="relative">
                        <select
                          className="w-full appearance-none rounded-2xl bg-[#0B1221] border border-[#1F2937] px-3 py-3 pr-10 text-sm text-slate-100 outline-none focus:border-sky-400/50"
                          value={employeeLabel}
                          onChange={(e) => setEmployeeLabel(e.target.value)}
                          disabled={loading || !leaderLabel.trim()}
                        >
                          <option value="">
                            {leaderLabel.trim() ? 'Bitte auswählen…' : 'wähle zuerst die Führungskraft…'}
                          </option>
                          {detectedSpeakers
                            .filter((sp) => sp !== leaderLabel.trim())
                            .map((sp) => (
                              <option key={sp} value={sp}>
                                {sp}
                              </option>
                            ))}
                        </select>
                        <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                          expand_more
                        </span>
                      </div>

                      <div className="text-xs text-slate-500">
                        Mehr als 2 Sprecher erkannt – bitte Mitarbeitende explizit wählen.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Card>

            <Card title="Datenschutz">
              <div className="space-y-4">
                <label className="flex items-start gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-sky-400"
                    checked={privacyMode}
                    onChange={(e) => setPrivacyMode(e.target.checked)}
                    disabled={loading}
                  />
                  <div>
                    <div className="text-sm font-medium text-white">Vor Analyse anonymisieren (empfohlen)</div>
                    <div className="text-xs text-slate-400">
                      Passiert im Browser, bevor etwas an die API geht.
                    </div>
                  </div>
                </label>

                <div>
                  <div className="text-xs text-slate-400 mb-2">Zusätzliche Begriffe anonymisieren (kommagetrennt)</div>
                  <input
                    className="w-full rounded-2xl bg-[#0B1221] border border-[#1F2937] px-3 py-3 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-sky-400/50"
                    placeholder="z.B. Kundenportal, ACME GmbH, Kunde Schmidt"
                    value={extraTerms}
                    onChange={(e) => setExtraTerms(e.target.value)}
                    disabled={!privacyMode || loading}
                  />
                </div>

                {privacyMode && privacyPreview ? (
                  <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
                    <div className="text-xs text-slate-400 mb-2">Preview (erste 400 Zeichen, anonymisiert)</div>
                    <div className="text-xs text-slate-200 whitespace-pre-wrap">{privacyPreview}</div>
                  </div>
                ) : null}

                <div className="text-xs text-slate-500">
                  Hinweis: Wenn „Transkript speichern“ aktiv ist, speichern wir genau das, was an die Analyse gesendet wird
                  (bei Datenschutz also anonymisiert).
                </div>
              </div>
            </Card>

            <Card title="Speichern & Ablauf">
              <div className="space-y-3">
                <label className="flex items-center justify-between gap-3 cursor-pointer select-none">
                  <span className="text-sm text-slate-200">Auto Save nach Analyse</span>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-sky-400"
                    checked={autoSave}
                    onChange={(e) => setAutoSave(e.target.checked)}
                    disabled={loading}
                  />
                </label>

                <label className="flex items-center justify-between gap-3 cursor-pointer select-none">
                  <span className="text-sm text-slate-200">Transkript speichern</span>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-sky-400"
                    checked={saveTranscript}
                    onChange={(e) => setSaveTranscript(e.target.checked)}
                    disabled={loading}
                  />
                </label>
              </div>
            </Card>

            {error ? (
              <div className="bg-[#111826] border border-red-500/30 rounded-2xl p-5 text-red-200">
                <div className="font-semibold mb-1">Fehler</div>
                <div className="text-sm whitespace-pre-wrap">{error}</div>
              </div>
            ) : null}

            <button
              className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-sky-400 hover:bg-sky-300 text-black px-4 py-3 text-sm font-semibold shadow-lg shadow-sky-400/20 disabled:opacity-50"
              type="button"
              onClick={onAnalyze}
              disabled={
                loading ||
                !sessionId.trim() ||
                !transcriptText.trim() ||
                !leaderLabel.trim() ||
                (!employeeLabel.trim() && !(leaderLabel.trim() && detectedSpeakers.length === 2))
              }
            >
              {loading ? <span className="material-symbols-outlined animate-spin">progress_activity</span> : <span className="material-symbols-outlined">analytics</span>}
              Analyse starten
            </button>

            {step ? (
              <div className="text-xs text-slate-400 text-center">{step}</div>
            ) : null}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
