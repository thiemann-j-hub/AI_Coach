'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2, MessagesSquare, Send } from 'lucide-react';
import AppShell from '@/components/app/app-shell';
import { authFetch } from '@/lib/api-client';
import { CREDITS_REFRESH_EVENT } from '@/components/app/credit-balance';
import { useTranslation } from '@/i18n/useTranslation';
import { maxEurHint } from '@/lib/pricing-display';

interface Turn {
  role: 'interviewer' | 'person';
  text: string;
  frageNr: number;
  nachfrage?: boolean;
  ts: string;
}

/**
 * Welle 6 (Owner-GO 30.10.2026): Interview-Pilot „Kursfeedback“ — fünf Fragen, eine Nachfrage je Frage, Textweg.
 * Einstieg aus dem Studio-Kursende: /interview?kurs=<id>&titel=<Kurstitel>. Erst Intro mit Preis und
 * Datenschutzsatz, dann Chat, am Ende „Abschließen“ (1 Credit). Nur Workspaces im Pilot-Rahmen.
 */
export default function InterviewClient() {
  const { t, locale } = useTranslation();
  const ti = t.interview;
  const router = useRouter();
  const params = useSearchParams();
  const kursId = (params.get('kurs') ?? '').trim();
  const kursTitel = (params.get('titel') ?? '').trim() || ti.defaultCourse;

  const [view, setView] = useState<'intro' | 'chat' | 'done'>('intro');
  const [id, setId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [fertig, setFertig] = useState(false);
  const [frageNr, setFrageNr] = useState(1);
  const [gesamt, setGesamt] = useState(5);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length, busy]);

  async function start() {
    if (!kursId) {
      setError(ti.missingCourse);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch('/api/interview/start', {
        method: 'POST',
        body: JSON.stringify({ kursId, kursTitel, locale: locale === 'en' ? 'en' : 'de' }),
      });
      const json = await res.json().catch(() => null);
      if (res.status === 403 && json?.code === 'INTERVIEW_NOT_ENABLED') {
        setError(ti.notEnabled);
        return;
      }
      // A4 (31.10.2026): KI für das Unternehmen aus — die Meldung des Servers zeigen.
      if (res.status === 403 && json?.code === 'KI_AUS') {
        setError(json.error || ti.errorGeneric);
        return;
      }
      if (!res.ok || !json?.ok) throw new Error('start');
      setId(json.id);
      setTurns(json.turns ?? []);
      setFertig(Boolean(json.fertig));
      setView('chat');
    } catch {
      setError(ti.errorGeneric);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const antwort = text.trim();
    if (!id || !antwort || busy) return;
    setBusy(true);
    setError(null);
    const optimistic: Turn = { role: 'person', text: antwort, frageNr, ts: new Date().toISOString() };
    setTurns((prev) => [...prev, optimistic]);
    setText('');
    try {
      const res = await authFetch('/api/interview/turn', { method: 'POST', body: JSON.stringify({ id, text: antwort }) });
      const json = await res.json().catch(() => null);
      // A4 (31.10.2026): KI inzwischen ausgeschaltet — Antwort zurück ins Feld, Meldung des Servers zeigen.
      if (res.status === 403 && json?.code === 'KI_AUS') {
        setTurns((prev) => prev.filter((x) => x !== optimistic));
        setText(antwort);
        setError(json.error || ti.errorGeneric);
        return;
      }
      if (!res.ok || !json?.ok) throw new Error('turn');
      setTurns(json.turns ?? []);
      setFertig(Boolean(json.fertig));
      if (typeof json.frageNr === 'number') setFrageNr(json.frageNr);
      if (typeof json.gesamt === 'number') setGesamt(json.gesamt);
    } catch {
      setTurns((prev) => prev.filter((x) => x !== optimistic));
      setText(antwort);
      setError(ti.errorGeneric);
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!id || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch('/api/interview/finish', { method: 'POST', body: JSON.stringify({ id }) });
      const json = await res.json().catch(() => null);
      // A4 (31.10.2026): auch KI_AUS (Schalter beim Abbuchen) zeigt die Meldung des Servers.
      if (res.status === 402 || json?.code === 'KI_AUS') {
        setError(json?.error ?? ti.errorGeneric);
        return;
      }
      if (!res.ok || !json?.ok) throw new Error('finish');
      window.dispatchEvent(new Event(CREDITS_REFRESH_EVENT));
      setView('done');
    } catch {
      setError(ti.errorGeneric);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title={ti.title} subtitle={kursTitel}>
      <div className="max-w-2xl mx-auto space-y-4">
        {error && (
          <div className="pn-none rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-800 dark:text-rose-300" role="alert">
            {error}
          </div>
        )}

        {view === 'intro' && (
          <section className="pn-tile glass-panel rounded-2xl border border-border p-6 space-y-4">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
                <MessagesSquare className="h-5 w-5" />
              </span>
              <div>
                <h1 className="text-xl font-bold tracking-tight">{ti.introTitle.replace('{title}', kursTitel)}</h1>
                <p className="text-sm text-muted-foreground">{ti.introMeta}</p>
              </div>
            </div>
            <p className="text-sm leading-relaxed">{ti.introBody}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{ti.introPrivacy}</p>
            <p className="text-xs text-muted-foreground">{ti.introCost.replace('{eur}', maxEurHint(t.common.maxEurHint, locale))}</p>
            <div className="flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                onClick={() => router.push('/')}
                className="pn-none rounded-lg px-4 py-2 text-sm border border-border hover:bg-muted transition-colors"
              >
                {ti.notNow}
              </button>
              <button
                type="button"
                onClick={() => void start()}
                disabled={busy}
                className="btn-gradient text-white font-semibold rounded-lg px-5 py-2 text-sm flex items-center gap-2 disabled:opacity-50"
                data-testid="interview-start"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessagesSquare className="h-4 w-4" />}
                {ti.start}
              </button>
            </div>
          </section>
        )}

        {view === 'chat' && (
          <section className="pn-tile glass-panel rounded-2xl border border-border p-4 space-y-3" data-testid="interview-chat">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{ti.progress.replace('{n}', String(Math.min(frageNr, gesamt))).replace('{total}', String(gesamt))}</span>
              <span>{kursTitel}</span>
            </div>
            <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
              {turns.map((x, i) => (
                <div key={i} className={x.role === 'person' ? 'flex justify-end' : 'flex justify-start'}>
                  <div
                    className={
                      x.role === 'person'
                        ? 'pn-none max-w-[85%] rounded-2xl rounded-br-sm bg-primary/10 px-3.5 py-2 text-sm leading-relaxed'
                        : 'pn-none max-w-[85%] rounded-2xl rounded-bl-sm border border-border bg-muted/30 px-3.5 py-2 text-sm leading-relaxed'
                    }
                  >
                    {x.text}
                  </div>
                </div>
              ))}
              {busy && (
                <div className="flex justify-start">
                  <div className="pn-none rounded-2xl border border-border bg-muted/30 px-3.5 py-2 text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> {ti.thinking}
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>
            {fertig ? (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground">{ti.finishHint.replace('{eur}', maxEurHint(t.common.maxEurHint, locale))}</p>
                <button
                  type="button"
                  onClick={() => void finish()}
                  disabled={busy}
                  className="btn-gradient text-white font-semibold rounded-lg px-5 py-2 text-sm flex items-center gap-2 disabled:opacity-50"
                  data-testid="interview-finish"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {ti.finish}
                </button>
              </div>
            ) : (
              <form
                className="flex items-end gap-2 pt-2 border-t border-border"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  rows={2}
                  maxLength={1500}
                  placeholder={ti.placeholder}
                  disabled={busy}
                  className="pn-field flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <button
                  type="submit"
                  disabled={busy || !text.trim()}
                  className="btn-gradient text-white rounded-xl p-2.5 disabled:opacity-50"
                  aria-label={ti.send}
                  title={ti.send}
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
            )}
          </section>
        )}

        {view === 'done' && (
          <section className="pn-tile glass-panel rounded-2xl border border-border p-6 space-y-3 text-center" data-testid="interview-done">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-700 dark:text-emerald-400" />
            <h2 className="text-lg font-semibold">{ti.thanksTitle}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">{ti.thanksBody}</p>
            <button
              type="button"
              onClick={() => router.push('/')}
              className="btn-gradient text-white font-semibold rounded-lg px-5 py-2 text-sm"
            >
              {ti.backToStart}
            </button>
          </section>
        )}
      </div>
    </AppShell>
  );
}
