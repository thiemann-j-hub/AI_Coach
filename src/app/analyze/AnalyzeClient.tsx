'use client';

import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppShell from '@/components/app/app-shell';
import { parsePdfToText } from '@/lib/pdf/parsePdfToText';
import { useTheme } from 'next-themes';
import Link from 'next/link';

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
  const { theme, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  const [sessionId, setSessionId] = useState<string>('');

  const [lang, setLang] = useState<'de' | 'en'>('de');
  const [goal, setGoal] = useState<string>('');

  const [transcriptText, setTranscriptText] = useState<string>('');
  const [undoTranscript, setUndoTranscript] = useState<string | null>(null);

  // Upload State
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadMode, setUploadMode] = useState<'replace' | 'append'>('replace');
  const [cleanPdf, setCleanPdf] = useState(true);
  const [uploadBusy, setUploadBusy] = useState(false);

  const detectedSpeakers = useMemo(() => {
    const raw = detectSpeakers(transcriptText);
    const blocked = new Set(['datum', 'dauer', 'date', 'duration']);
    return raw.filter((sp) => !blocked.has(String(sp ?? '').trim().toLowerCase()));
  }, [transcriptText]);

  const [leaderLabel, setLeaderLabel] = useState<string>('');
  const [employeeLabel, setEmployeeLabel] = useState<string>('');

  const [privacyMode, setPrivacyMode] = useState(true);
  const [extraTerms, setExtraTerms] = useState('');
  const [autoSave, setAutoSave] = useState(true);
  const [saveTranscript, setSaveTranscript] = useState(false);

  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // sessionId sync
  useEffect(() => {
    const urlSid = searchParams.get('sessionId');
    if (urlSid && urlSid.trim()) {
      const sid = urlSid.trim();
      setSessionId(sid);
      try { localStorage.setItem(STORAGE_KEY, sid); } catch {}
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
    try { localStorage.setItem(STORAGE_KEY, sid); } catch {}
    router.replace(`/analyze?sessionId=${encodeURIComponent(sid)}`);
  }, [searchParams, router]);

  // Prefill labels
  useEffect(() => {
    if (!transcriptText) return;
    if (!leaderLabel && transcriptText.includes('FK:')) setLeaderLabel('FK');
    if (!employeeLabel && transcriptText.includes('MA:')) setEmployeeLabel('MA');
  }, [transcriptText, leaderLabel, employeeLabel]);

  // File Upload Logic
  async function handleFile(file: File) {
    if (!file) return;
    setUploadBusy(true);
    try {
      // 30 pages, 250k chars max (hardcoded here to match UI hint)
      const { text } = await parsePdfToText(file, { maxPages: 30, maxChars: 250000 });
      let out = text;
      if (cleanPdf) {
        out = cleanTeamsTranscript(out);
      }
      
      setUndoTranscript(transcriptText);
      if (uploadMode === 'append' && transcriptText.trim()) {
        setTranscriptText(`${transcriptText.trim()}\n\n${out.trim()}`);
      } else {
        setTranscriptText(out.trim());
      }
    } catch (e: any) {
      setError(e.message || 'Fehler beim PDF-Upload');
    } finally {
      setUploadBusy(false);
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = '';
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer.files?.[0];
    if (f && f.type === 'application/pdf') {
      handleFile(f);
    }
  }

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

  // Analyze Logic
  async function onAnalyze() {
    setError(null);
    const sid = sessionId.trim();
    if (!sid) { setError('SessionId fehlt.'); return; }
    
    const t = transcriptText.trim();
    if (!t) { setError('Bitte Transkript einfügen.'); return; }

    const l = leaderLabel.trim();
    let e = employeeLabel.trim();

    // Auto-detect employee if exactly 2 speakers
    if (!e && l && detectedSpeakers.length === 2) {
      const other = detectedSpeakers.find((s) => s !== l) ?? '';
      if (other) e = other;
    }

    if (!l) { setError('Bitte Führungskraft wählen.'); return; }
    if (!e) { setError('Bitte Mitarbeitende wählen.'); return; }
    if (l === e) { setError('Sprecher identisch.'); return; }

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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(await readErrorText(res));
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error || 'Analyse fehlgeschlagen');

      const result: AnalyzeResult = j.result;

      if (!autoSave) {
        setStep('Fertig (nicht gespeichert).');
        setLoading(false);
        return;
      }

      setStep('Speichere Run…');
      const savePayload = {
        sessionId: sid,
        request: { ...payload, transcriptText: saveTranscript ? transcriptToSend : null },
        options: { storeTranscript: saveTranscript },
        result,
      };

      const saveRes = await fetch('/api/runs/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(savePayload),
      });

      if (!saveRes.ok) throw new Error(await readErrorText(saveRes));
      const sj = await saveRes.json();
      if (!sj?.ok || !sj?.runId) throw new Error('Speichern fehlgeschlagen');

      setStep('Öffne Bericht…');
      router.push(`/runs/${encodeURIComponent(sid)}/${encodeURIComponent(sj.runId)}`);

    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
      setStep(null);
    }
  }

  // Header Actions
  const actions = (
    <button
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark text-text-muted-light dark:text-text-muted-dark text-sm hover:border-primary transition-colors"
      onClick={() => sessionId && router.push(`/runs-dashboard?sessionId=${encodeURIComponent(sessionId)}`)}
    >
      <span className="material-icons-round text-sm">history</span>
      <span>Verlauf</span>
    </button>
  );

  return (
    <div className="bg-background-light dark:bg-background-dark text-text-main-light dark:text-text-main-dark font-body antialiased selection:bg-primary selection:text-white transition-colors duration-300 h-screen overflow-hidden flex flex-col md:flex-row">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 bg-surface-light dark:bg-surface-dark border-b border-border-light dark:border-border-dark">
        <div className="font-bold text-xl text-primary">PulseCraft AI</div>
        <button className="text-text-main-light dark:text-text-main-dark" onClick={() => setMobileOpen(!mobileOpen)}>
          <span className="material-icons-round">menu</span>
        </button>
      </div>

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-surface-light dark:bg-surface-dark border-r border-border-light dark:border-border-dark flex-col transition-transform duration-300 md:translate-x-0 md:static md:flex ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-6">
            <h1 className="font-display font-bold text-2xl tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-400">
                PulseCraft AI
            </h1>
        </div>
        <nav className="flex-1 px-4 space-y-2 overflow-y-auto">
            <Link href="/analyze" className="flex items-center px-4 py-3 bg-primary/10 text-primary rounded-lg border-l-4 border-primary transition-all duration-200 group">
                <span className="material-icons-round mr-3">analytics</span>
                <span className="font-medium">Analyse</span>
            </Link>
            <Link href="/runs-dashboard" className="flex items-center px-4 py-3 text-text-muted-light dark:text-text-muted-dark hover:text-text-main-light dark:hover:text-text-main-dark hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg transition-all duration-200 group">
                <span className="material-icons-round mr-3 group-hover:scale-110 transition-transform">history</span>
                <span className="font-medium">Verlauf</span>
            </Link>
            <Link href="/design-preview" className="flex items-center px-4 py-3 text-text-muted-light dark:text-text-muted-dark hover:text-text-main-light dark:hover:text-text-main-dark hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg transition-all duration-200 group">
                <span className="material-icons-round mr-3 group-hover:scale-110 transition-transform">grid_view</span>
                <span className="font-medium">Design-Preview</span>
            </Link>
        </nav>
        <div className="p-4 mt-auto">
            <button className="w-full btn-gradient text-white font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-2 shadow-glow" onClick={() => window.location.reload()}>
                <span className="material-icons-round text-xl">add_circle_outline</span>
                Neue Analyse
            </button>
        </div>
        <div className="px-4 pb-4">
            <button className="flex items-center justify-center w-full py-2 text-xs text-text-muted-light dark:text-text-muted-dark hover:bg-gray-100 dark:hover:bg-white/5 rounded transition-colors" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                <span className="material-icons-round text-base mr-2">brightness_6</span> Toggle Theme
            </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        <header className="h-16 flex items-center justify-between px-6 bg-background-light dark:bg-background-dark border-b border-border-light dark:border-border-dark flex-shrink-0">
            <div className="flex flex-col">
                <h2 className="text-lg font-bold text-text-main-light dark:text-text-main-dark leading-tight">Analyse</h2>
                <span className="text-xs text-text-muted-light dark:text-text-muted-dark font-mono">Session: {shortId(sessionId)}</span>
            </div>
            <div className="flex items-center space-x-4">
                {actions}
                <button className="relative p-2 text-text-muted-light dark:text-text-muted-dark hover:text-primary transition-colors">
                    <span className="material-icons-round">notifications</span>
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full border-2 border-background-light dark:border-background-dark"></span>
                </button>
                <div className="flex items-center pl-4 border-l border-border-light dark:border-border-dark">
                    <div className="text-right mr-3 hidden sm:block">
                        <div className="text-sm font-semibold text-text-main-light dark:text-text-main-dark">Jürgen Thiemann</div>
                        <div className="text-xs text-text-muted-light dark:text-text-muted-dark cursor-pointer hover:text-primary">Logout</div>
                    </div>
                    <div className="relative">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center text-white font-bold shadow-md">
                            J
                        </div>
                        <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-background-light dark:border-background-dark rounded-full"></div>
                    </div>
                </div>
            </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 max-w-8xl mx-auto h-full">
        {/* Left Column */}
        <div className="xl:col-span-2 flex flex-col gap-6">
          <div className="bg-surface-light dark:bg-surface-dark rounded-DEFAULT shadow-card-light dark:shadow-card-dark p-6 border border-border-light dark:border-border-dark h-full flex flex-col">
            <div className="mb-4">
              <h3 className="text-xl font-semibold text-text-main-light dark:text-text-main-dark mb-1">Transkript</h3>
              <p className="text-sm text-text-muted-light dark:text-text-muted-dark">PDF hochladen oder Text einfügen</p>
            </div>
            
            {/* PDF Import Box */}
            <div className="bg-background-light dark:bg-[#0d1f38] rounded-xl p-5 mb-5 border border-border-light dark:border-border-dark">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
                <div>
                  <h4 className="font-bold text-text-main-light dark:text-text-main-dark">PDF importieren</h4>
                  <p className="text-xs text-text-muted-light dark:text-text-muted-dark mt-1">max. 30 Seiten · max. 250k Zeichen</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <select 
                      className="appearance-none bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark text-text-main-light dark:text-text-main-dark text-sm rounded-lg px-3 py-2 pr-8 focus:ring-2 focus:ring-primary focus:border-transparent outline-none cursor-pointer"
                      value={uploadMode}
                      onChange={(e) => setUploadMode(e.target.value as any)}
                      disabled={uploadBusy || loading}
                    >
                      <option value="replace">Ersetzen</option>
                      <option value="append">Anhängen</option>
                    </select>
                    <span className="material-icons-round absolute right-2 top-2.5 text-text-muted-light dark:text-text-muted-dark text-sm pointer-events-none">expand_more</span>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input 
                      type="checkbox" 
                      className="form-checkbox text-primary rounded border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark focus:ring-offset-background-dark focus:ring-primary h-4 w-4" 
                      checked={cleanPdf}
                      onChange={(e) => setCleanPdf(e.target.checked)}
                      disabled={uploadBusy || loading}
                    />
                    <span className="text-xs font-medium text-text-main-light dark:text-text-main-dark">Teams bereinigen</span>
                  </label>
                  <button 
                    className="bg-transparent border border-primary text-primary hover:bg-primary hover:text-white transition-colors text-xs font-medium py-2 px-4 rounded-lg"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadBusy || loading}
                  >
                    {uploadBusy ? 'Lädt...' : 'PDF hochladen'}
                  </button>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    accept="application/pdf" 
                    onChange={onFileChange} 
                  />
                </div>
              </div>
              <div 
                className="border-2 border-dashed border-border-light dark:border-[#233554] bg-surface-light/50 dark:bg-white/5 rounded-xl p-8 flex flex-col items-center justify-center text-center transition-all hover:border-primary/50 group cursor-pointer"
                onDrop={onDrop}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onClick={() => fileInputRef.current?.click()}
              >
                <span className="material-icons-round text-3xl text-text-muted-light dark:text-text-muted-dark mb-2 group-hover:text-primary transition-colors">cloud_upload</span>
                <span className="font-semibold text-text-main-light dark:text-text-main-dark">Drag & Drop</span>
                <span className="text-sm text-text-muted-light dark:text-text-muted-dark mt-1">Ziehe eine Teams-PDF hier rein oder nutze den Button.</span>
              </div>
            </div>

            {/* Toolbar */}
            <div className="flex flex-wrap gap-2 mb-4">
              <button 
                className="flex items-center gap-2 px-3 py-2 bg-surface-light dark:bg-[#1C2C4E] hover:bg-gray-200 dark:hover:bg-[#253961] text-text-muted-light dark:text-text-muted-dark rounded-lg text-sm transition-colors"
                onClick={() => {
                  setUndoTranscript(transcriptText);
                  setTranscriptText(cleanTeamsTranscript(transcriptText));
                }}
                disabled={!transcriptText.trim() || loading}
              >
                <span className="material-symbols-rounded text-lg text-primary">auto_fix_high</span>
                Teams bereinigen
              </button>
              <button 
                className="flex items-center gap-2 px-3 py-2 bg-surface-light dark:bg-[#1C2C4E] hover:bg-gray-200 dark:hover:bg-[#253961] text-text-muted-light dark:text-text-muted-dark rounded-lg text-sm transition-colors"
                onClick={() => {
                   const l = leaderLabel.trim();
                   const e = employeeLabel.trim();
                   if (!l || !e) return;
                   setUndoTranscript(transcriptText);
                   setTranscriptText(sanitizeTranscript(transcriptText, {
                     leaderLabel: l, 
                     employeeLabel: e,
                     detectedSpeakers, 
                     extraTerms: parseExtraTerms(extraTerms)
                   }));
                }}
                disabled={!transcriptText.trim() || !leaderLabel || !employeeLabel || loading}
              >
                <span className="material-symbols-rounded text-lg">security</span>
                Anonymisieren
              </button>
              <button 
                className="flex items-center gap-2 px-3 py-2 bg-surface-light dark:bg-[#1C2C4E] hover:bg-gray-200 dark:hover:bg-[#253961] text-text-muted-light dark:text-text-muted-dark rounded-lg text-sm transition-colors ml-auto"
                onClick={() => {
                  if (!undoTranscript) return;
                  const cur = transcriptText;
                  setTranscriptText(undoTranscript);
                  setUndoTranscript(cur);
                }}
                disabled={!undoTranscript || loading}
              >
                <span className="material-symbols-rounded text-lg">undo</span>
                Undo
              </button>
              <button 
                className="flex items-center gap-2 px-3 py-2 bg-surface-light dark:bg-[#1C2C4E] hover:bg-gray-200 dark:hover:bg-[#253961] text-text-muted-light dark:text-text-muted-dark rounded-lg text-sm transition-colors hover:text-red-400"
                onClick={() => {
                  setUndoTranscript(transcriptText);
                  setTranscriptText('');
                }}
                disabled={!transcriptText || loading}
              >
                <span className="material-symbols-rounded text-lg">delete</span>
                Clear
              </button>
            </div>

            {/* Text Area */}
            <div className="flex-1 relative">
              <textarea 
                className="w-full h-full bg-background-light dark:bg-[#0A192F] text-text-main-light dark:text-text-main-dark placeholder-text-muted-light dark:placeholder-text-muted-dark/50 border border-border-light dark:border-border-dark rounded-xl p-4 text-base leading-relaxed focus:ring-2 focus:ring-primary focus:border-transparent outline-none resize-none min-h-[300px]" 
                placeholder="Hier steht nach dem PDF-Upload der Text... oder du fügst ihn manuell ein."
                value={transcriptText}
                onChange={(e) => setTranscriptText(e.target.value)}
                disabled={loading}
              ></textarea>
              <div className="absolute bottom-2 right-2 text-text-muted-light dark:text-text-muted-dark opacity-50">
                <span className="material-icons-round text-sm transform rotate-45">open_in_full</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - Settings */}
        <div className="flex flex-col gap-6">
          <div className="bg-surface-light dark:bg-surface-dark rounded-DEFAULT shadow-card-light dark:shadow-card-dark p-6 border border-border-light dark:border-border-dark">
            <h3 className="text-lg font-bold text-text-main-light dark:text-text-main-dark mb-5">Einstellungen</h3>
            <div className="space-y-6">
              <div>
                <label className="block text-xs font-medium text-text-muted-light dark:text-text-muted-dark uppercase tracking-wide mb-2">Sprache</label>
                <div className="relative">
                  <select 
                    className="w-full appearance-none bg-background-light dark:bg-[#0d1f38] border border-border-light dark:border-border-dark text-text-main-light dark:text-text-main-dark rounded-lg px-4 py-3 pr-8 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-shadow"
                    value={lang}
                    onChange={(e) => setLang(e.target.value as any)}
                    disabled={loading}
                  >
                    <option value="de">Deutsch</option>
                    <option value="en">English</option>
                  </select>
                  <span className="material-icons-round absolute right-3 top-3.5 text-text-muted-light dark:text-text-muted-dark pointer-events-none">expand_more</span>
                </div>
                <p className="text-[11px] text-text-muted-light dark:text-text-muted-dark mt-2 leading-tight">
                  (Deutsch/Englisch ist vorbereitet – Logik kann später erweitert werden.)
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted-light dark:text-text-muted-dark uppercase tracking-wide mb-2">Ziel (optional)</label>
                <input 
                  type="text" 
                  className="w-full bg-background-light dark:bg-[#0d1f38] border border-border-light dark:border-border-dark text-text-main-light dark:text-text-main-dark rounded-lg px-4 py-3 placeholder-text-muted-light dark:placeholder-text-muted-dark focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-shadow" 
                  placeholder="z.B. klar und fair, ohne Eskalation" 
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="p-4 rounded-xl border border-border-light dark:border-border-dark bg-background-light/50 dark:bg-[#0d1f38]/50">
                <span className="block text-xs font-medium text-text-muted-light dark:text-text-muted-dark mb-1">Gesprächsart</span>
                <div className="font-bold text-text-main-light dark:text-text-main-dark mb-1">Mitarbeitendengespräch</div>
                <p className="text-xs text-text-muted-light dark:text-text-muted-dark leading-snug">
                  (Conversation-Type ist aktuell technisch fix, damit RAG stabil bleibt.)
                </p>
              </div>
            </div>
          </div>

          <div className="bg-surface-light dark:bg-surface-dark rounded-DEFAULT shadow-card-light dark:shadow-card-dark p-6 border border-border-light dark:border-border-dark flex-1">
            <div className="flex items-center gap-2 mb-4">
              <h3 className="text-lg font-bold text-text-main-light dark:text-text-main-dark">Rollen im Gespräch</h3>
            </div>
            <p className="text-sm text-text-muted-light dark:text-text-muted-dark mb-5 leading-relaxed">
              Wähle die Führungskraft (Mitarbeitende wird automatisch gesetzt)
            </p>
            <div className="space-y-6">
              <div>
                <label className="block text-xs font-medium text-text-muted-light dark:text-text-muted-dark uppercase tracking-wide mb-2">Führungskraft (Ich)</label>
                <div className="relative">
                  <select 
                    className="w-full appearance-none bg-background-light dark:bg-[#0d1f38] border border-border-light dark:border-border-dark text-text-main-light dark:text-text-main-dark rounded-lg px-4 py-3 pr-8 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-shadow"
                    value={leaderLabel}
                    onChange={(e) => {
                      const v = e.target.value;
                      setLeaderLabel(v);
                      if (detectedSpeakers.length === 2) {
                        const other = detectedSpeakers.find(s => s !== v);
                        if (other) setEmployeeLabel(other);
                      }
                    }}
                    disabled={loading}
                  >
                    <option value="">{detectedSpeakers.length > 0 ? 'Bitte wählen...' : 'Transkript einfügen...'}</option>
                    {detectedSpeakers.map(sp => (
                      <option key={sp} value={sp}>{sp} (Ich)</option>
                    ))}
                  </select>
                  <span className="material-icons-round absolute right-3 top-3.5 text-text-muted-light dark:text-text-muted-dark pointer-events-none">expand_more</span>
                </div>
                <p className="text-[11px] text-text-muted-light dark:text-text-muted-dark mt-2">
                  Tipp: Nach Upload/Einfügen werden Sprecher automatisch erkannt.
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted-light dark:text-text-muted-dark uppercase tracking-wide mb-2">Mitarbeitende</label>
                {detectedSpeakers.length <= 2 ? (
                   <div className="w-full bg-background-light dark:bg-[#0d1f38] border border-border-light dark:border-border-dark text-text-muted-light dark:text-text-muted-dark rounded-lg px-4 py-3 opacity-70">
                     {employeeLabel || 'wähle zuerst die Führungskraft...'}
                   </div>
                ) : (
                  <div className="relative">
                    <select 
                      className="w-full appearance-none bg-background-light dark:bg-[#0d1f38] border border-border-light dark:border-border-dark text-text-main-light dark:text-text-main-dark rounded-lg px-4 py-3 pr-8 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-shadow"
                      value={employeeLabel}
                      onChange={(e) => setEmployeeLabel(e.target.value)}
                      disabled={loading || !leaderLabel.trim()}
                    >
                      <option value="">Bitte wählen...</option>
                      {detectedSpeakers.filter(s => s !== leaderLabel).map(sp => (
                        <option key={sp} value={sp}>{sp}</option>
                      ))}
                    </select>
                    <span className="material-icons-round absolute right-3 top-3.5 text-text-muted-light dark:text-text-muted-dark pointer-events-none">expand_more</span>
                  </div>
                )}
              </div>
            </div>
            
            <div className="mt-8 border-t border-border-light dark:border-border-dark pt-6">
              <h4 className="text-sm font-bold text-text-main-light dark:text-text-main-dark mb-4">Datenschutz & Start</h4>
              
               <label className="flex items-start gap-3 cursor-pointer select-none mb-4">
                  <input
                    type="checkbox"
                    className="mt-1 form-checkbox text-primary rounded border-border-light dark:border-border-dark bg-background-light dark:bg-[#0d1f38]"
                    checked={privacyMode}
                    onChange={(e) => setPrivacyMode(e.target.checked)}
                    disabled={loading}
                  />
                  <div>
                    <div className="text-sm font-medium text-text-main-light dark:text-text-main-dark">Vor Analyse anonymisieren (empfohlen)</div>
                    <div className="text-xs text-text-muted-light dark:text-text-muted-dark">
                      Passiert im Browser, bevor etwas an die API geht.
                    </div>
                  </div>
                </label>
                
                {privacyMode && (
                   <div className="mb-4">
                     <label className="block text-xs font-medium text-text-muted-light dark:text-text-muted-dark uppercase tracking-wide mb-2">Zusätzliche Begriffe (kommagetrennt)</label>
                      <input 
                        type="text" 
                        className="w-full bg-background-light dark:bg-[#0d1f38] border border-border-light dark:border-border-dark text-text-main-light dark:text-text-main-dark rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-shadow" 
                        placeholder="z.B. Firma XY, Projekt Z" 
                        value={extraTerms}
                        onChange={(e) => setExtraTerms(e.target.value)}
                        disabled={loading}
                      />
                   </div>
                )}

               {error && (
                 <div className="p-3 mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 text-sm">
                   {error}
                 </div>
               )}

               <button 
                 className="w-full btn-gradient text-white font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-2 shadow-glow hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none"
                 onClick={onAnalyze}
                 disabled={loading || !transcriptText || !leaderLabel || !employeeLabel}
               >
                 {loading ? (
                    <span className="material-icons-round animate-spin">refresh</span>
                 ) : (
                    <span className="material-icons-round">analytics</span>
                 )}
                 {loading ? 'Analyse läuft...' : 'Analyse starten'}
               </button>
               
               {step && (
                 <div className="mt-2 text-center text-xs text-text-muted-light dark:text-text-muted-dark">{step}</div>
               )}
            </div>
          </div>
        </div>
          </div>
        </div>
      </main>

      {/* Mobile Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setMobileOpen(false)}></div>
      )}
    </div>
  );
}
