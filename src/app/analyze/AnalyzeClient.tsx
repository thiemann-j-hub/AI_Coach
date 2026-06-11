'use client';

import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppShell from '@/components/app/app-shell';
import { parsePdfToText } from '@/lib/pdf/parsePdfToText';
import { authFetch } from '@/lib/api-client';
import { STORAGE_KEY_SESSION } from '@/lib/storage-keys';
import { newSessionId, shortId } from '@/lib/session-utils';
import {
  cleanTeamsTranscript,
  detectSpeakers,
  sanitizeTranscript,
  parseExtraTerms,
} from '@/lib/transcript-utils';
import { useTranslation } from '@/i18n/useTranslation';
import Link from 'next/link';

type AnalyzeResult = any;

async function readErrorText(res: Response) {
  const txt = await res.text();
  try {
    const j = JSON.parse(txt);
    return String(j?.error || j?.message || txt || res.statusText);
  } catch {
    return String(txt || res.statusText);
  }
}

export default function AnalyzeClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslation();

  const [sessionId, setSessionId] = useState<string>('');
  const [lang, setLang] = useState<'de' | 'en'>('de');
  const [goal, setGoal] = useState<string>('');

  const [transcriptText, setTranscriptText] = useState<string>('');
  const [undoTranscript, setUndoTranscript] = useState<string | null>(null);

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
  const [saveTranscript, setSaveTranscript] = useState(false);

  // Fertige Analyse, deren Save fehlschlug — erlaubt Retry ohne erneute LLM-Calls
  const [pendingSave, setPendingSave] = useState<any | null>(null);

  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!loading) { setElapsed(0); return; }
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [loading]);

  // Synchroner Re-Entrancy-Schutz: zwei Klicks vor dem Re-Render sehen beide
  // loading=false — der Ref verhindert doppelte Gemini-Calls.
  const busyRef = useRef(false);

  useEffect(() => {
    const urlSid = searchParams.get('sessionId');
    if (urlSid && urlSid.trim()) {
      const sid = urlSid.trim();
      setSessionId(sid);
      try { localStorage.setItem(STORAGE_KEY_SESSION, sid); } catch {}
      return;
    }
    try {
      const stored = localStorage.getItem(STORAGE_KEY_SESSION);
      if (stored && stored.trim()) {
        setSessionId(stored.trim());
        router.replace(`/analyze?sessionId=${encodeURIComponent(stored.trim())}`);
        return;
      }
    } catch {}
    const sid = newSessionId();
    setSessionId(sid);
    try { localStorage.setItem(STORAGE_KEY_SESSION, sid); } catch {}
    router.replace(`/analyze?sessionId=${encodeURIComponent(sid)}`);
  }, [searchParams, router]);

  useEffect(() => {
    if (!transcriptText) return;
    if (!leaderLabel && transcriptText.includes('FK:')) setLeaderLabel('FK');
    if (!employeeLabel && transcriptText.includes('MA:')) setEmployeeLabel('MA');
  }, [transcriptText, leaderLabel, employeeLabel]);

  async function handleFile(file: File) {
    if (!file) return;
    setUploadBusy(true);
    try {
      const { text } = await parsePdfToText(file, { maxPages: 30, maxChars: 250000 });
      let out = text;
      if (cleanPdf) out = cleanTeamsTranscript(out);
      setUndoTranscript(transcriptText);
      if (uploadMode === 'append' && transcriptText.trim()) {
        setTranscriptText(`${transcriptText.trim()}\n\n${out.trim()}`);
      } else {
        setTranscriptText(out.trim());
      }
    } catch (e: any) {
      setError(e.message || t.analyze.errorPdfUpload);
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
    if (f && f.type === 'application/pdf') handleFile(f);
  }

  const privacyPreview = useMemo(() => {
    if (!privacyMode) return '';
    const l = leaderLabel.trim();
    const e = employeeLabel.trim();
    if (!l || !e) return '';
    try {
      const sanitized = sanitizeTranscript(transcriptText, {
        leaderLabel: l, employeeLabel: e,
        detectedSpeakers, extraTerms: parseExtraTerms(extraTerms),
      });
      return sanitized.slice(0, 400);
    } catch { return ''; }
  }, [privacyMode, transcriptText, leaderLabel, employeeLabel, detectedSpeakers, extraTerms]);

  async function onAnalyze() {
    setError(null);
    const sid = sessionId.trim();
    if (!sid) { setError(t.analyze.errorSessionMissing); return; }
    const txt = transcriptText.trim();
    if (!txt) { setError(t.analyze.errorTranscriptMissing); return; }
    const l = leaderLabel.trim();
    let e = employeeLabel.trim();
    if (!e && l && detectedSpeakers.length === 2) {
      const other = detectedSpeakers.find((s) => s !== l) ?? '';
      if (other) e = other;
    }
    if (!l) { setError(t.analyze.errorManagerMissing); return; }
    if (!e) { setError(t.analyze.errorEmployeeMissing); return; }
    if (l === e) { setError(t.analyze.errorSpeakersIdentical); return; }

    if (busyRef.current) return;
    busyRef.current = true;
    setPendingSave(null);
    setLoading(true);
    setStep(t.analyze.statusAnalyzing);
    try {
      const transcriptToSend = privacyMode
        ? sanitizeTranscript(transcriptText, {
            leaderLabel: l, employeeLabel: e,
            detectedSpeakers, extraTerms: parseExtraTerms(extraTerms),
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

      const res = await authFetch('/api/analyze', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await readErrorText(res));
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error || 'Analysis failed');
      const result: AnalyzeResult = j.result;

      setStep(t.analyze.statusSaving);
      const savePayload = {
        sessionId: sid,
        request: { ...payload, transcriptText: saveTranscript ? transcriptToSend : null },
        options: { storeTranscript: saveTranscript },
        result,
      };

      try {
        await doSave(savePayload);
      } catch (saveErr: any) {
        // Analyse war erfolgreich (und bezahlt) — Ergebnis behalten, nur Save wiederholen
        setPendingSave(savePayload);
        setError(`${t.analyze.saveFailed} (${saveErr?.message ?? saveErr})`);
      }
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      busyRef.current = false;
      setLoading(false);
      setStep(null);
    }
  }

  async function doSave(savePayload: any) {
    const saveRes = await authFetch('/api/runs/save', {
      method: 'POST',
      body: JSON.stringify(savePayload),
    });
    if (!saveRes.ok) throw new Error(await readErrorText(saveRes));
    const sj = await saveRes.json();
    if (!sj?.ok || !sj?.runId) throw new Error('Save failed');

    setPendingSave(null);
    setStep(t.analyze.statusOpening);
    router.push(`/runs/${encodeURIComponent(savePayload.sessionId)}/${encodeURIComponent(sj.runId)}`);
  }

  async function onRetrySave() {
    if (!pendingSave || busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setLoading(true);
    setStep(t.analyze.statusSaving);
    try {
      await doSave(pendingSave);
    } catch (err: any) {
      setError(`${t.analyze.saveFailed} (${err?.message ?? err})`);
    } finally {
      busyRef.current = false;
      setLoading(false);
      setStep(null);
    }
  }

  const headerActions = (
    <button
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card border border-border text-muted-foreground text-sm hover:border-primary/30 hover:text-foreground transition-colors"
      onClick={() => sessionId && router.push(`/runs-dashboard?sessionId=${encodeURIComponent(sessionId)}`)}
    >
      <span className="material-icons-round text-sm">history</span>
      <span>{t.nav.history}</span>
    </button>
  );

  return (
    <AppShell
      title={t.analyze.title}
      subtitle={`Session: ${shortId(sessionId)}`}
      actions={headerActions}
    >
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 max-w-8xl mx-auto">
        {/* Left Column - Transcript */}
        <div className="xl:col-span-2 flex flex-col gap-6">
          <div className="glass-panel rounded-2xl p-6 flex flex-col">
            <div className="mb-4">
              <h3 className="text-xl font-semibold text-foreground mb-1">{t.analyze.transcript}</h3>
              <p className="text-sm text-muted-foreground">{t.analyze.transcriptSubtitle}</p>
            </div>

            {/* PDF Import */}
            <div className="bg-secondary/50 rounded-xl p-5 mb-5 border border-border">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
                <div>
                  <h4 className="font-bold text-foreground">{t.analyze.pdfImport}</h4>
                  <p className="text-xs text-muted-foreground mt-1">{t.analyze.pdfHint}</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <select
                      className="appearance-none bg-card border border-border text-foreground text-sm rounded-lg px-3 py-2 pr-8 focus:ring-2 focus:ring-primary focus:border-transparent outline-none cursor-pointer"
                      value={uploadMode}
                      onChange={(e) => setUploadMode(e.target.value as any)}
                      disabled={uploadBusy || loading}
                    >
                      <option value="replace">{t.analyze.pdfReplace}</option>
                      <option value="append">{t.analyze.pdfAppend}</option>
                    </select>
                    <span className="material-icons-round absolute right-2 top-2.5 text-muted-foreground text-sm pointer-events-none">expand_more</span>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="form-checkbox text-primary rounded border-border bg-card focus:ring-offset-background focus:ring-primary h-4 w-4"
                      checked={cleanPdf}
                      onChange={(e) => setCleanPdf(e.target.checked)}
                      disabled={uploadBusy || loading}
                    />
                    <span className="text-xs font-medium text-foreground">{t.analyze.cleanTeams}</span>
                  </label>
                  <button
                    className="bg-transparent border border-primary/50 text-primary hover:bg-primary hover:text-white transition-colors text-xs font-medium py-2 px-4 rounded-lg"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadBusy || loading}
                  >
                    {uploadBusy ? t.analyze.pdfUploading : t.analyze.pdfUpload}
                  </button>
                  <input type="file" ref={fileInputRef} className="hidden" accept="application/pdf" onChange={onFileChange} />
                </div>
              </div>
              <div
                className="border-2 border-dashed border-border bg-background/50 rounded-xl p-8 flex flex-col items-center justify-center text-center transition-all hover:border-primary/30 group cursor-pointer"
                onDrop={onDrop}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onClick={() => fileInputRef.current?.click()}
              >
                <span className="material-icons-round text-3xl text-muted-foreground mb-2 group-hover:text-primary transition-colors">cloud_upload</span>
                <span className="font-semibold text-foreground">{t.analyze.dragDrop}</span>
                <span className="text-sm text-muted-foreground mt-1">{t.analyze.dragDropHint}</span>
              </div>
            </div>

            {/* Toolbar */}
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                className="flex items-center gap-2 px-3 py-2 bg-secondary hover:bg-primary/20 text-muted-foreground hover:text-primary rounded-lg text-sm transition-colors"
                onClick={() => {
                  setUndoTranscript(transcriptText);
                  setTranscriptText(cleanTeamsTranscript(transcriptText));
                }}
                disabled={!transcriptText.trim() || loading}
              >
                <span className="material-symbols-rounded text-lg text-primary">auto_fix_high</span>
                {t.analyze.cleanTeams}
              </button>
              <button
                className="flex items-center gap-2 px-3 py-2 bg-secondary hover:bg-primary/20 text-muted-foreground hover:text-primary rounded-lg text-sm transition-colors"
                onClick={() => {
                  const l = leaderLabel.trim();
                  const e = employeeLabel.trim();
                  if (!l || !e) return;
                  setUndoTranscript(transcriptText);
                  setTranscriptText(sanitizeTranscript(transcriptText, {
                    leaderLabel: l, employeeLabel: e,
                    detectedSpeakers, extraTerms: parseExtraTerms(extraTerms)
                  }));
                }}
                disabled={!transcriptText.trim() || !leaderLabel || !employeeLabel || loading}
              >
                <span className="material-symbols-rounded text-lg">security</span>
                {t.analyze.anonymize}
              </button>
              <button
                className="flex items-center gap-2 px-3 py-2 bg-secondary hover:bg-primary/20 text-muted-foreground hover:text-foreground rounded-lg text-sm transition-colors ml-auto"
                onClick={() => {
                  if (!undoTranscript) return;
                  const cur = transcriptText;
                  setTranscriptText(undoTranscript);
                  setUndoTranscript(cur);
                }}
                disabled={!undoTranscript || loading}
              >
                <span className="material-symbols-rounded text-lg">undo</span>
                {t.common.undo}
              </button>
              <button
                className="flex items-center gap-2 px-3 py-2 bg-secondary hover:bg-red-500/20 text-muted-foreground hover:text-red-400 rounded-lg text-sm transition-colors"
                onClick={() => {
                  setUndoTranscript(transcriptText);
                  setTranscriptText('');
                }}
                disabled={!transcriptText || loading}
              >
                <span className="material-symbols-rounded text-lg">delete</span>
                {t.common.clear}
              </button>
            </div>

            {/* Text Area */}
            <div className="flex-1 relative">
              <textarea
                className="w-full h-full bg-background/60 text-foreground placeholder-muted-foreground/50 border border-border rounded-xl p-4 text-base leading-relaxed focus:ring-2 focus:ring-primary focus:border-transparent outline-none resize-none min-h-[300px] custom-scrollbar"
                placeholder={t.analyze.textPlaceholder}
                value={transcriptText}
                onChange={(e) => setTranscriptText(e.target.value)}
                disabled={loading}
              />
            </div>
            {transcriptText.trim() && (
              <div className="mt-2 text-right text-xs text-muted-foreground font-mono">
                {transcriptText.trim().split(/\s+/).length.toLocaleString()} {t.common.words} · {transcriptText.length.toLocaleString()} {t.common.chars}
              </div>
            )}
          </div>
        </div>

        {/* Right Column - Settings */}
        <div className="flex flex-col gap-6">
          {/* Settings Card */}
          <div className="glass-panel rounded-2xl p-6">
            <h3 className="text-lg font-bold text-foreground mb-5">{t.analyze.settings}</h3>
            <div className="space-y-6">
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{t.analyze.language}</label>
                <div className="relative">
                  <select
                    className="w-full appearance-none bg-background border border-border text-foreground rounded-lg px-4 py-3 pr-8 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-shadow"
                    value={lang}
                    onChange={(e) => setLang(e.target.value as any)}
                    disabled={loading}
                  >
                    <option value="de">{t.analyze.german}</option>
                    <option value="en">{t.analyze.english}</option>
                  </select>
                  <span className="material-icons-round absolute right-3 top-3.5 text-muted-foreground pointer-events-none">expand_more</span>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{t.analyze.goalOptional}</label>
                <input
                  type="text"
                  className="w-full bg-background border border-border text-foreground rounded-lg px-4 py-3 placeholder-muted-foreground/50 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-shadow"
                  placeholder={t.analyze.goalPlaceholder}
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="p-4 rounded-xl border border-border bg-secondary/50">
                <span className="block text-xs font-medium text-muted-foreground mb-1">{t.analyze.conversationType}</span>
                <div className="font-bold text-foreground mb-1">{t.analyze.employeeConversation}</div>
                <p className="text-xs text-muted-foreground leading-snug">
                  {t.analyze.conversationTypeNote}
                </p>
              </div>
            </div>
          </div>

          {/* Roles Card */}
          <div className="glass-panel rounded-2xl p-6 flex-1">
            <h3 className="text-lg font-bold text-foreground mb-4">{t.analyze.roles}</h3>
            <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
              {t.analyze.rolesHint}
            </p>
            <div className="space-y-6">
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{t.analyze.manager}</label>
                <div className="relative">
                  <select
                    className="w-full appearance-none bg-background border border-border text-foreground rounded-lg px-4 py-3 pr-8 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-shadow"
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
                    <option value="">{detectedSpeakers.length > 0 ? t.analyze.pleaseSelect : t.analyze.pasteTranscript}</option>
                    {detectedSpeakers.map(sp => (
                      <option key={sp} value={sp}>{sp} {t.analyze.me}</option>
                    ))}
                  </select>
                  <span className="material-icons-round absolute right-3 top-3.5 text-muted-foreground pointer-events-none">expand_more</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">
                  {t.analyze.speakerTip}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{t.analyze.employee}</label>
                {detectedSpeakers.length <= 2 ? (
                  <div className="w-full bg-background border border-border text-muted-foreground rounded-lg px-4 py-3 opacity-70">
                    {employeeLabel || t.analyze.selectManagerFirst}
                  </div>
                ) : (
                  <div className="relative">
                    <select
                      className="w-full appearance-none bg-background border border-border text-foreground rounded-lg px-4 py-3 pr-8 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-shadow"
                      value={employeeLabel}
                      onChange={(e) => setEmployeeLabel(e.target.value)}
                      disabled={loading || !leaderLabel.trim()}
                    >
                      <option value="">{t.analyze.pleaseSelect}</option>
                      {detectedSpeakers.filter(s => s !== leaderLabel).map(sp => (
                        <option key={sp} value={sp}>{sp}</option>
                      ))}
                    </select>
                    <span className="material-icons-round absolute right-3 top-3.5 text-muted-foreground pointer-events-none">expand_more</span>
                  </div>
                )}
              </div>
            </div>

            {/* Privacy & Start */}
            <div className="mt-8 border-t border-border pt-6">
              <h4 className="text-sm font-bold text-foreground mb-4">{t.analyze.privacy}</h4>

              <label className="flex items-start gap-3 cursor-pointer select-none mb-4">
                <input
                  type="checkbox"
                  className="mt-1 form-checkbox text-primary rounded border-border bg-background"
                  checked={privacyMode}
                  onChange={(e) => setPrivacyMode(e.target.checked)}
                  disabled={loading}
                />
                <div>
                  <div className="text-sm font-medium text-foreground">{t.analyze.anonymizeRecommended}</div>
                  <div className="text-xs text-muted-foreground">
                    {t.analyze.anonymizeHint}
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer select-none mb-4">
                <input
                  type="checkbox"
                  className="mt-1 form-checkbox text-primary rounded border-border bg-background"
                  checked={saveTranscript}
                  onChange={(e) => setSaveTranscript(e.target.checked)}
                  disabled={loading}
                />
                <div>
                  <div className="text-sm font-medium text-foreground">{t.analyze.saveTranscript}</div>
                  <div className="text-xs text-muted-foreground">
                    {t.analyze.saveTranscriptHint}
                  </div>
                </div>
              </label>

              {privacyMode && (
                <div className="mb-4">
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{t.analyze.extraTerms}</label>
                  <input
                    type="text"
                    className="w-full bg-background border border-border text-foreground rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-shadow"
                    placeholder={t.analyze.extraTermsPlaceholder}
                    value={extraTerms}
                    onChange={(e) => setExtraTerms(e.target.value)}
                    disabled={loading}
                  />
                </div>
              )}

              {privacyMode && privacyPreview && (
                <details className="mb-4 rounded-lg border border-border bg-background/60">
                  <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5">
                    <span className="material-icons-round text-sm">visibility</span>
                    {t.analyze.previewTitle}
                  </summary>
                  <div className="px-3 pb-3">
                    <p className="text-[11px] text-muted-foreground mb-2">{t.analyze.previewHint}</p>
                    <pre className="whitespace-pre-wrap text-xs text-foreground font-mono bg-secondary/50 rounded-lg p-3 border border-border max-h-40 overflow-auto custom-scrollbar">{privacyPreview}…</pre>
                  </div>
                </details>
              )}

              {error && (
                <div className="p-3 mb-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  {error}
                </div>
              )}

              {pendingSave && !loading && (
                <button
                  className="w-full mb-4 py-3 rounded-xl text-sm font-semibold border border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors flex items-center justify-center gap-2"
                  onClick={onRetrySave}
                >
                  <span className="material-icons-round text-base">save</span>
                  {t.analyze.retrySave}
                </button>
              )}

              {!loading && (!transcriptText.trim() || !leaderLabel || !employeeLabel) && (
                <div className="mb-4 rounded-lg border border-border bg-background/60 p-3">
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t.analyze.readyChecklist}</div>
                  <ul className="space-y-1.5">
                    {([
                      [Boolean(transcriptText.trim()), t.analyze.checkTranscript],
                      [Boolean(leaderLabel), t.analyze.checkManager],
                      [Boolean(employeeLabel), t.analyze.checkEmployee],
                    ] as Array<[boolean, string]>).map(([done, label], i) => (
                      <li key={i} className={`flex items-center gap-2 text-xs ${done ? 'text-emerald-500' : 'text-muted-foreground'}`}>
                        <span className="material-icons-round text-sm">{done ? 'check_circle' : 'radio_button_unchecked'}</span>
                        {label}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <button
                className="w-full btn-gradient text-white font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-2 shadow-neon hover:shadow-neon-hover hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none"
                onClick={onAnalyze}
                disabled={loading || !transcriptText || !leaderLabel || !employeeLabel}
              >
                {loading ? (
                  <span className="material-icons-round animate-spin">refresh</span>
                ) : (
                  <span className="material-icons-round">analytics</span>
                )}
                {loading ? t.analyze.analyzing : t.analyze.startAnalysis}
              </button>

              {loading && (
                <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-center" aria-live="polite">
                  <div className="text-sm font-medium text-foreground flex items-center justify-center gap-2">
                    <span className="material-icons-round animate-spin text-base text-primary">progress_activity</span>
                    {step}
                    <span className="font-mono text-xs text-muted-foreground">{elapsed}s</span>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">{t.analyze.durationHint}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
