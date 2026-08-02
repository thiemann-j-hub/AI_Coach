'use client';

/**
 * Gesprächssimulation (SIM-3): Szenario-Auswahl → Briefing → Chat mit der
 * KI-Rolle → kostenpflichtige Auswertung (1 Credit) mit Rubrik, Schlüssel-
 * momenten und C1–C10-Anschluss. Szenario-Inhalte V1 bewusst Deutsch.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Clock,
  Flag,
  Loader2,
  MessagesSquare,
  Play,
  Send,
  Sparkles,
  Target,
  User,
  XCircle,
} from 'lucide-react';
import AppShell from '@/components/app/app-shell';
import { authFetch } from '@/lib/api-client';
import { useTranslation } from '@/i18n/useTranslation';

interface PublicScenario {
  id: string;
  title: string;
  teaser: string;
  difficulty: 1 | 2 | 3;
  durationMin: number;
  locale?: "de" | "en";
  persona: { name: string; role: string };
  candidateBriefing: {
    yourRole: string;
    relationship: string;
    incidents: string[];
    factSheet?: string[];
    goals: string[];
    timeboxMin: number;
  };
  competencies: { key: string; label: string }[];
}

interface Turn {
  role: 'user' | 'persona';
  text: string;
  ts: string;
}

interface RecentSim {
  id: string;
  scenarioId: string;
  status: 'active' | 'finished';
  createdAt: string;
  updatedAt: string;
  turnCount: number;
}

interface Feedback {
  summary: string;
  rubric: { key: string; label: string; evidence: string[]; why: string; score: number | null }[];
  checkpoints: { id: string; hit: boolean; comment: string }[];
  nextStep: string;
}

interface CompetencyRating {
  id: string;
  name: string;
  score: number | null;
  why: string;
  evidence: string[];
}

type View = 'loading' | 'disabled' | 'list' | 'briefing' | 'chat' | 'feedback';

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

const LEVEL_STYLES: Record<number, string> = {
  1: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  2: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  3: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
};

function ScoreBadge({ score }: { score: number | null }) {
  const { t } = useTranslation();
  if (score == null) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full border border-border text-muted-foreground">
        {t.simulation.notObservable}
      </span>
    );
  }
  const color =
    score >= 3.5
      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
      : score >= 2.5
        ? 'bg-sky-500/15 text-sky-400 border-sky-500/30'
        : score >= 1.5
          ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
          : 'bg-rose-500/15 text-rose-400 border-rose-500/30';
  return (
    <span className={cx('text-xs font-bold px-2 py-0.5 rounded-full border', color)}>
      {score} / 4
    </span>
  );
}

export default function SimulationClient() {
  const { t } = useTranslation();
  const ts = t.simulation;

  const [view, setView] = useState<View>('loading');
  const [scenarios, setScenarios] = useState<PublicScenario[]>([]);
  const [recent, setRecent] = useState<RecentSim[]>([]);
  const [scenario, setScenario] = useState<PublicScenario | null>(null);
  const [simId, setSimId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [starting, setStarting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [ratings, setRatings] = useState<CompetencyRating[] | null>(null);
  const [showC10, setShowC10] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [topUpUrl, setTopUpUrl] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const scenarioById = useMemo(() => {
    const m = new Map<string, PublicScenario>();
    for (const s of scenarios) m.set(s.id, s);
    return m;
  }, [scenarios]);

  const levelLabel = useCallback(
    (d: 1 | 2 | 3) =>
      `${ts.levelPrefix} ${d} · ${d === 1 ? ts.level1 : d === 2 ? ts.level2 : ts.level3}`,
    [ts]
  );

  const loadCatalog = useCallback(async () => {
    try {
      const res = await authFetch('/api/simulation/scenarios');
      if (res.status === 503) {
        setView('disabled');
        return;
      }
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error('catalog');
      setScenarios(json.scenarios ?? []);
      setRecent(json.recent ?? []);
      setView('list');
    } catch {
      setError(ts.genericError);
      setView('list');
    }
  }, [ts]);

  useEffect(() => {
    void loadCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, sending]);

  async function handleApiFailure(res: Response) {
    let code = '';
    let body: { code?: string; topUpUrl?: string } = {};
    try {
      body = await res.json();
      code = body.code ?? '';
    } catch {
      /* kein JSON */
    }
    if (res.status === 402 || code === 'INSUFFICIENT_CREDITS') {
      setTopUpUrl(body.topUpUrl ?? null);
      setError(ts.paywall);
    } else if (code === 'CENTRAL_REAUTH') {
      setError(ts.reauth);
    } else if (code === 'CENTRAL_UNAVAILABLE' || res.status === 503) {
      setError(ts.unavailable);
    } else if (code === 'NOT_ENOUGH_TURNS') {
      setError(ts.notEnoughTurns);
    } else if (code === 'TURN_LIMIT') {
      setError(ts.turnLimit);
    } else {
      setError(ts.genericError);
    }
  }

  async function startSimulation(s: PublicScenario) {
    setStarting(true);
    setError(null);
    try {
      const res = await authFetch('/api/simulation/start', {
        method: 'POST',
        body: JSON.stringify({ scenarioId: s.id }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        await handleApiFailure(res);
        return;
      }
      setSimId(json.simulation.id);
      setTurns(json.simulation.turns);
      setFeedback(null);
      setRatings(null);
      setBriefingOpen(false);
      setView('chat');
    } catch {
      setError(ts.genericError);
    } finally {
      setStarting(false);
    }
  }

  async function resumeSimulation(item: RecentSim) {
    const s = scenarioById.get(item.scenarioId);
    if (!s) return;
    setError(null);
    try {
      const res = await authFetch(`/api/simulation/get?simId=${encodeURIComponent(item.id)}`);
      const json = await res.json();
      if (!res.ok || !json.ok) {
        await handleApiFailure(res);
        return;
      }
      setScenario(s);
      setSimId(json.simulation.id);
      setTurns(json.simulation.turns);
      if (json.simulation.status === 'finished' && json.simulation.feedback) {
        setFeedback(json.simulation.feedback);
        setRatings(json.simulation.competencyRatings ?? null);
        setView('feedback');
      } else {
        setFeedback(null);
        setRatings(null);
        setBriefingOpen(false);
        setView('chat');
      }
    } catch {
      setError(ts.genericError);
    }
  }

  async function sendTurn() {
    const message = input.trim();
    if (!message || !simId || sending) return;
    setSending(true);
    setError(null);
    const optimistic: Turn = { role: 'user', text: message, ts: new Date().toISOString() };
    setTurns((prev) => [...prev, optimistic]);
    setInput('');
    try {
      const res = await authFetch('/api/simulation/turn', {
        method: 'POST',
        body: JSON.stringify({ simId, message }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setTurns((prev) => prev.filter((x) => x !== optimistic));
        setInput(message);
        await handleApiFailure(res);
        return;
      }
      setTurns((prev) => [
        ...prev,
        { role: 'persona', text: json.reply, ts: new Date().toISOString() },
      ]);
    } catch {
      setTurns((prev) => prev.filter((x) => x !== optimistic));
      setInput(message);
      setError(ts.genericError);
    } finally {
      setSending(false);
    }
  }

  async function finishSimulation() {
    if (!simId || finishing) return;
    setFinishing(true);
    setError(null);
    try {
      const res = await authFetch('/api/simulation/finish', {
        method: 'POST',
        body: JSON.stringify({ simId }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        await handleApiFailure(res);
        return;
      }
      setFeedback(json.feedback);
      setRatings(json.competencyRatings ?? null);
      setConfirmOpen(false);
      setView('feedback');
    } catch {
      setError(ts.genericError);
    } finally {
      setFinishing(false);
    }
  }

  function backToList() {
    setScenario(null);
    setSimId(null);
    setTurns([]);
    setFeedback(null);
    setRatings(null);
    setError(null);
    setConfirmOpen(false);
    setView('loading');
    void loadCatalog();
  }

  const userTurnCount = turns.filter((x) => x.role === 'user').length;

  /* ---------- Teil-Ansichten ---------- */

  const errorBanner = error && (
    <div className="glass-panel rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 flex items-start gap-2 text-sm">
      <AlertTriangle className="h-4 w-4 text-rose-400 mt-0.5 shrink-0" />
      <div>
        <span>{error}</span>
        {topUpUrl && (
          <a href={topUpUrl} className="ml-2 underline text-primary" target="_blank" rel="noreferrer">
            {ts.topUp}
          </a>
        )}
      </div>
    </div>
  );

  const briefingBlock = (s: PublicScenario) => (
    <div className="space-y-4">
      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-1">
          {ts.yourRole}
        </h3>
        <p className="text-sm leading-relaxed">{s.candidateBriefing.yourRole}</p>
      </section>
      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-1">
          {ts.relationship}
        </h3>
        <p className="text-sm leading-relaxed">{s.candidateBriefing.relationship}</p>
      </section>
      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-1">
          {ts.incidents}
        </h3>
        <ul className="space-y-2">
          {s.candidateBriefing.incidents.map((i, idx) => (
            <li key={idx} className="text-sm leading-relaxed flex gap-2">
              <span className="text-primary font-bold shrink-0">{idx + 1}.</span>
              <span>{i}</span>
            </li>
          ))}
        </ul>
      </section>
      {s.candidateBriefing.factSheet && s.candidateBriefing.factSheet.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            {ts.factSheet}
          </h3>
          <ul className="space-y-1 rounded-lg border border-border bg-muted/40 p-3">
            {s.candidateBriefing.factSheet.map((f, idx) => (
              <li key={idx} className="text-xs font-mono leading-relaxed">
                {f}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
          <Target className="h-4 w-4 text-primary" /> {ts.goals}
        </h3>
        <ol className="space-y-2">
          {s.candidateBriefing.goals.map((g, idx) => (
            <li key={idx} className="text-sm leading-relaxed flex gap-2">
              <span className="text-primary font-bold shrink-0">{idx + 1}.</span>
              <span>{g}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );

  /* ---------- Render ---------- */

  if (view === 'loading') {
    return (
      <AppShell title={ts.title} subtitle={ts.subtitle}>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t.common.loading}
        </div>
      </AppShell>
    );
  }

  if (view === 'disabled') {
    return (
      <AppShell title={ts.title} subtitle={ts.subtitle}>
        <div className="glass-panel rounded-xl p-6 max-w-xl text-sm text-muted-foreground">
          {ts.disabled}
        </div>
      </AppShell>
    );
  }

  if (view === 'list') {
    return (
      <AppShell title={ts.title} subtitle={ts.subtitle}>
        <div className="space-y-6 max-w-5xl">
          {errorBanner}
          {recent.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {ts.resumeTitle}
              </h2>
              <div className="space-y-2">
                {recent.map((r) => {
                  const s = scenarioById.get(r.scenarioId);
                  if (!s) return null;
                  return (
                    <button
                      key={r.id}
                      onClick={() => void resumeSimulation(r)}
                      className="w-full glass-panel rounded-xl p-3 flex items-center justify-between gap-3 text-left hover:border-primary/40 border border-border transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{s.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(r.createdAt).toLocaleString()} · {r.turnCount}{' '}
                          {ts.turnsLabel}
                        </div>
                      </div>
                      <span
                        className={cx(
                          'text-xs px-2 py-0.5 rounded-full border shrink-0',
                          r.status === 'active'
                            ? 'bg-sky-500/15 text-sky-400 border-sky-500/30'
                            : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                        )}
                      >
                        {r.status === 'active' ? ts.statusActive : ts.statusFinished}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {scenarios.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setScenario(s);
                  setError(null);
                  setView('briefing');
                }}
                className="glass-panel rounded-2xl p-5 text-left border border-border hover:border-primary/40 transition-colors flex flex-col gap-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cx(
                      'text-xs font-semibold px-2 py-0.5 rounded-full border',
                      LEVEL_STYLES[s.difficulty]
                    )}
                  >
                    {levelLabel(s.difficulty)}
                  </span>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" /> ~{s.durationMin} {ts.minutesShort}
                  </span>
                </div>
                <h3 className="font-semibold leading-snug">{s.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed flex-1">{s.teaser}</p>
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5" />
                  {ts.withLabel} {s.persona.name} — {s.persona.role}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                  {s.locale === "en" ? ts.englishOnly : ts.germanOnly}
                </div>
              </button>
            ))}
          </section>
        </div>
      </AppShell>
    );
  }

  if (view === 'briefing' && scenario) {
    return (
      <AppShell title={scenario.title} subtitle={levelLabel(scenario.difficulty)}>
        <div className="max-w-3xl space-y-4">
          {errorBanner}
          <button
            onClick={backToList}
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <ArrowLeft className="h-4 w-4" /> {ts.backToList}
          </button>
          <div className="glass-panel rounded-2xl p-6">{briefingBlock(scenario)}</div>
          <button
            onClick={() => void startSimulation(scenario)}
            disabled={starting}
            className="btn-gradient text-white font-semibold rounded-xl px-6 py-3 flex items-center gap-2 shadow-neon disabled:opacity-60"
          >
            {starting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
            {ts.startCta}
          </button>
        </div>
      </AppShell>
    );
  }

  if (view === 'chat' && scenario) {
    return (
      <AppShell
        title={scenario.title}
        subtitle={`${ts.withLabel} ${scenario.persona.name} — ${scenario.persona.role}`}
        noPadding
        actions={
          <button
            onClick={() => setConfirmOpen(true)}
            disabled={finishing || userTurnCount < 1}
            className="text-sm font-semibold rounded-lg px-3 py-2 border border-primary/40 text-primary hover:bg-primary/10 transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            <Flag className="h-4 w-4" /> {ts.finishCta}
          </button>
        }
      >
        <div className="flex flex-col h-full">
          {/* Briefing-Aufklapper */}
          <div className="border-b border-border">
            <button
              onClick={() => setBriefingOpen((o) => !o)}
              className="w-full px-4 py-2 text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1"
            >
              <ChevronDown
                className={cx('h-4 w-4 transition-transform', briefingOpen && 'rotate-180')}
              />
              {briefingOpen ? ts.briefingHide : ts.briefingShow}
            </button>
            {briefingOpen && (
              <div className="px-4 pb-4 max-h-72 overflow-y-auto custom-scrollbar max-w-3xl mx-auto">
                {briefingBlock(scenario)}
              </div>
            )}
          </div>

          {/* Nachrichten */}
          <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4">
            <div className="max-w-3xl mx-auto space-y-3">
              {error && errorBanner}
              {turns.map((turn, idx) => (
                <div
                  key={idx}
                  className={cx('flex', turn.role === 'user' ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cx(
                      'rounded-2xl px-4 py-2.5 text-sm leading-relaxed max-w-[85%] whitespace-pre-wrap',
                      turn.role === 'user'
                        ? 'bg-primary text-primary-foreground rounded-br-sm'
                        : 'glass-panel border border-border rounded-bl-sm'
                    )}
                  >
                    {turn.role === 'persona' && (
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                        {scenario.persona.name}
                      </div>
                    )}
                    {turn.text}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="glass-panel border border-border rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {scenario.persona.name} {ts.personaTyping}
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          </div>

          {/* Eingabe */}
          <div className="border-t border-border p-3">
            <div className="max-w-3xl mx-auto flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void sendTurn();
                  }
                }}
                rows={2}
                placeholder={ts.inputPlaceholder}
                className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <button
                onClick={() => void sendTurn()}
                disabled={sending || !input.trim()}
                className="btn-gradient text-white rounded-xl p-3 shadow-neon disabled:opacity-50"
                aria-label={ts.send}
              >
                <Send className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Auswerten-Bestätigung (Kostenhinweis) */}
        {confirmOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="glass-panel rounded-2xl border border-border p-6 max-w-md w-full space-y-4 bg-card">
              <h3 className="font-semibold text-lg">{ts.confirmTitle}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{ts.confirmBody}</p>
              {userTurnCount < 3 && (
                <p className="text-sm text-amber-400">{ts.notEnoughTurns}</p>
              )}
              {error && errorBanner}
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setConfirmOpen(false)}
                  className="rounded-lg px-4 py-2 text-sm border border-border hover:bg-muted transition-colors"
                >
                  {t.common.cancel}
                </button>
                <button
                  onClick={() => void finishSimulation()}
                  disabled={finishing || userTurnCount < 3}
                  className="btn-gradient text-white font-semibold rounded-lg px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-50"
                >
                  {finishing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {ts.confirmCta}
                </button>
              </div>
            </div>
          </div>
        )}
      </AppShell>
    );
  }

  if (view === 'feedback' && scenario && feedback) {
    return (
      <AppShell title={ts.feedbackTitle} subtitle={scenario.title}>
        <div className="max-w-3xl space-y-6">
          {errorBanner}

          <section className="glass-panel rounded-2xl p-6 space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {ts.summaryTitle}
            </h2>
            <p className="text-sm leading-relaxed">{feedback.summary}</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {ts.rubricTitle}
            </h2>
            {feedback.rubric.map((r) => (
              <div key={r.key} className="glass-panel rounded-xl border border-border p-4 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">{r.label}</h3>
                  <ScoreBadge score={r.score} />
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{r.why}</p>
                {r.evidence.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {ts.evidenceLabel}
                    </div>
                    {r.evidence.map((e, idx) => (
                      <blockquote
                        key={idx}
                        className="text-xs italic border-l-2 border-primary/40 pl-2 text-muted-foreground"
                      >
                        {e}
                      </blockquote>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {ts.checkpointsTitle}
            </h2>
            <div className="space-y-2">
              {feedback.checkpoints.map((c) => (
                <div key={c.id} className="glass-panel rounded-xl border border-border p-3 flex gap-3">
                  {c.hit ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {c.hit ? ts.hit : ts.missed}
                    </div>
                    <p className="text-sm leading-relaxed">{c.comment}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="glass-panel rounded-2xl p-6 border border-primary/30 space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-primary flex items-center gap-1">
              <Sparkles className="h-4 w-4" /> {ts.nextStepTitle}
            </h2>
            <p className="text-sm leading-relaxed">{feedback.nextStep}</p>
          </section>

          {ratings && (
            <section className="space-y-2">
              <button
                onClick={() => setShowC10((v) => !v)}
                className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <ChevronDown
                  className={cx('h-4 w-4 transition-transform', showC10 && 'rotate-180')}
                />
                {ts.c10Title}
              </button>
              {showC10 && (
                <div className="glass-panel rounded-xl border border-border p-4 space-y-2">
                  <p className="text-xs text-muted-foreground">{ts.c10Hint}</p>
                  {ratings.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 py-1 border-b border-border/50 last:border-0">
                      <span className="text-sm">
                        <span className="font-mono text-xs text-muted-foreground mr-2">{r.id}</span>
                        {r.name}
                      </span>
                      <ScoreBadge score={r.score} />
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          <button
            onClick={backToList}
            className="btn-gradient text-white font-semibold rounded-xl px-6 py-3 flex items-center gap-2 shadow-neon"
          >
            <MessagesSquare className="h-5 w-5" /> {ts.newSimulation}
          </button>
        </div>
      </AppShell>
    );
  }

  return null;
}
