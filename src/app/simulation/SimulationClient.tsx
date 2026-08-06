'use client';

/**
 * Gesprächssimulation — Debrief 2.0 (Blueprint COACH-DEBRIEF-BLUEPRINT.md).
 *
 * Ablauf: Szenario-Auswahl → Kontext-Treppe (Situation → Ziele → So gelingt es)
 * → Chat mit der KI-Rolle (inkl. Time-out-Coach) → kostenpflichtige Auswertung
 * mit deterministischem Gesamtscore, Erwartungslabels, Zitat-Belegen, Delta zum
 * Vorversuch und Fokus-Retry. Grundsatz: »Kein Score ohne Zitat« — und
 * »nicht beobachtbar« ist ehrlicher als 0 %.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Clock,
  Compass,
  Flag,
  Lightbulb,
  Loader2,
  MessagesSquare,
  Mic,
  Pause,
  Play,
  RotateCcw,
  Send,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  User,
  Volume2,
  VolumeX,
  XCircle,
  Trash2,
  X,
} from 'lucide-react';
import AppShell from '@/components/app/app-shell';
import { ExplainerVideoButton } from '@/components/app/explainer-video';
import { authFetch } from '@/lib/api-client';
import { CREDITS_REFRESH_EVENT } from '@/components/app/credit-balance';
import { withBasePath } from '@/lib/base-path';
import { useTranslation } from '@/i18n/useTranslation';
import type { FactVisual } from '@/lib/simulation/types';

interface PublicScenario {
  id: string;
  title: string;
  teaser: string;
  difficulty: 1 | 2 | 3;
  durationMin: number;
  locale?: 'de' | 'en';
  persona: { name: string; role: string };
  candidateBriefing: {
    yourRole: string;
    relationship: string;
    incidents: string[];
    factSheet?: string[];
    goals: string[];
    timeboxMin: number;
    approachHints?: string[];
    expectation?: string;
    factVisuals?: FactVisual[];
  };
  competencies: { key: string; label: string }[];
}

/** Gesprächssprache (Synthesia-Muster): Auswahl per Flaggen-Pills im Briefing. */
type ConvoLocale = 'de' | 'en' | 'es' | 'fr';

/** Genau die vier Synthesia-Sprachen, in Synthesia-Reihenfolge, mit nativen Namen. */
const CONVO_LANGS: Array<{ code: ConvoLocale; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
];

/** Echte Mini-Flaggen als Inline-SVG (Emoji-Flaggen rendert Windows nicht —
 *  dort erschienen nur Buchstabenkürzel; Owner-Vorgabe: Optik wie Synthesia). */
function FlagIcon({ code, className }: { code: ConvoLocale; className?: string }) {
  const common = cx('inline-block h-3.5 w-5 rounded-[3px] shrink-0', className);
  if (code === 'en') {
    return (
      <svg viewBox="0 0 60 40" className={common} aria-hidden preserveAspectRatio="none">
        <rect width="60" height="40" fill="#012169" />
        <path d="M0,0 L60,40 M60,0 L0,40" stroke="#fff" strokeWidth="8" />
        <path d="M0,0 L60,40 M60,0 L0,40" stroke="#C8102E" strokeWidth="4" />
        <path d="M30,0 V40 M0,20 H60" stroke="#fff" strokeWidth="13" />
        <path d="M30,0 V40 M0,20 H60" stroke="#C8102E" strokeWidth="7" />
      </svg>
    );
  }
  if (code === 'es') {
    return (
      <svg viewBox="0 0 60 40" className={common} aria-hidden preserveAspectRatio="none">
        <rect width="60" height="40" fill="#AA151B" />
        <rect y="10" width="60" height="20" fill="#F1BF00" />
      </svg>
    );
  }
  if (code === 'fr') {
    return (
      <svg viewBox="0 0 60 40" className={common} aria-hidden preserveAspectRatio="none">
        <rect width="20" height="40" fill="#002395" />
        <rect x="20" width="20" height="40" fill="#fff" />
        <rect x="40" width="20" height="40" fill="#ED2939" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 60 40" className={common} aria-hidden preserveAspectRatio="none">
      <rect width="60" height="13.4" fill="#000" />
      <rect y="13.3" width="60" height="13.4" fill="#DD0000" />
      <rect y="26.6" width="60" height="13.4" fill="#FFCE00" />
    </svg>
  );
}

const SPEECH_LANG: Record<ConvoLocale, string> = {
  de: 'de-DE',
  en: 'en-GB',
  es: 'es-ES',
  fr: 'fr-FR',
};

/**
 * Titel-Aufteilung (Owner-Vorgabe 04.08.): »Motto — Gesprächstyp mit Name«.
 * Das Motto gehört in den Text links, der Gesprächstyp aufs Hero-Bild —
 * und keiner von beiden in die Fenster-Kopfzeile.
 */
function splitTitle(title: string): { motto: string; heroTitle: string } {
  const idx = title.indexOf('—');
  if (idx < 0) return { motto: title, heroTitle: title };
  return {
    motto: title.slice(0, idx).trim(),
    heroTitle: title.slice(idx + 1).trim(),
  };
}

interface Turn {
  role: 'user' | 'persona';
  text: string;
  ts: string;
}

/* ── Faktenblatt-Visualisierung (Owner-Vorgabe 04.08.: beschriftete Grafiken) ──
   Ein-Farb-Magnitude (primary), Werte/Labels in Text-Tokens, jede Zahl direkt
   beschriftet — Mini-Datengrafiken, keine Analyse-Charts (keine Legende nötig,
   Einzelserie). */

function fmtDe(n: number): string {
  return n.toLocaleString('de-DE');
}

function TrendChart({ v }: { v: Extract<FactVisual, { kind: 'trend' }> }) {
  const W = 300;
  const H = 116;
  const padX = 30;
  const padTop = 28;
  const padBottom = 24;
  const vals = v.points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => padX + (i * (W - 2 * padX)) / Math.max(1, v.points.length - 1);
  const y = (val: number) => padTop + (1 - (val - min) / span) * (H - padTop - padBottom);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={v.title}>
      <line
        x1={padX - 8}
        x2={W - padX + 8}
        y1={H - padBottom}
        y2={H - padBottom}
        stroke="currentColor"
        className="text-border"
        strokeWidth="1"
      />
      <polyline
        points={v.points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')}
        fill="none"
        stroke="currentColor"
        className="text-primary"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {v.points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.value)} r="4" fill="currentColor" className="text-primary" />
          <text
            x={x(i)}
            y={y(p.value) - 9}
            textAnchor="middle"
            fontSize="10.5"
            fontWeight="600"
            fill="currentColor"
            className="text-foreground tabular-nums"
          >
            {p.approx ? '~' : ''}
            {fmtDe(p.value)}
            {v.unit ?? ''}
          </text>
          <text
            x={x(i)}
            y={H - 7}
            textAnchor="middle"
            fontSize="9"
            fill="currentColor"
            className="text-muted-foreground"
          >
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function ScaleBars({ v }: { v: Extract<FactVisual, { kind: 'bars' }> }) {
  const min = v.min ?? 0;
  return (
    <div className="space-y-2.5">
      {v.items.map((it, i) => {
        const pct = Math.max(0, Math.min(100, ((it.value - min) / (v.max - min)) * 100));
        return (
          <div key={i}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
              <span className="truncate text-muted-foreground">{it.label}</span>
              <span className="shrink-0 font-semibold tabular-nums text-foreground">
                {fmtDe(it.value)}
                {v.unit ?? ''}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted/70">
              <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KpiTiles({ v }: { v: Extract<FactVisual, { kind: 'kpis' }> }) {
  return (
    <div className="flex flex-wrap gap-3">
      {v.items.map((it, i) => (
        <div key={i} className="min-w-[110px] flex-1 rounded-lg border border-border bg-background/40 px-3 py-2.5">
          <div className="text-xl font-bold tabular-nums leading-tight">{it.value}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{it.label}</div>
          {it.sub && <div className="text-[10px] text-muted-foreground/70">{it.sub}</div>}
        </div>
      ))}
    </div>
  );
}

function FactChart({ v }: { v: FactVisual }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {v.title}
      </div>
      {v.kind === 'trend' ? <TrendChart v={v} /> : v.kind === 'bars' ? <ScaleBars v={v} /> : <KpiTiles v={v} />}
      {v.note && <div className="mt-2 text-[10px] leading-snug text-muted-foreground">{v.note}</div>}
    </div>
  );
}

interface CoachNote {
  question: string;
  answer: string;
  ts: string;
}

interface RecentSim {
  id: string;
  scenarioId: string;
  status: 'active' | 'finished';
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  attempt: number;
  overall: number | null;
  verdict: 'passed' | 'failed' | 'unrated' | null;
}

interface Feedback {
  summary: string;
  rubric: { key: string; label: string; evidence: string[]; why: string; score: number | null }[];
  checkpoints: { id: string; hit: boolean; comment: string }[];
  nextStep: string;
  focusReview?: { addressed: boolean; comment: string } | null;
}

interface DebriefAnchor {
  key: string;
  label: string;
  score: number | null;
  pct: number | null;
  expectation: 'not-observable' | 'below' | 'approaching' | 'meets' | 'exceeds';
}

interface Debrief {
  overall: number | null;
  verdict: 'passed' | 'failed' | 'unrated';
  passMarkPct: number;
  coverage: number;
  anchors: DebriefAnchor[];
  checkpointsHit: number;
  checkpointsTotal: number;
}

interface Delta {
  overall: number | null;
  anchors: Array<{ key: string; delta: number | null }>;
  prevOverall: number | null;
  prevAttempt: number;
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

/**
 * Persona-Avatar — D4: fotorealistisches Porträt (fal, erfundene Person) aus
 * public/personas/<scenarioId>.jpg mit Initialen-Fallback, falls das Bild
 * fehlt oder (noch) nicht geladen ist.
 */
function PersonaAvatar({
  name,
  scenarioId,
  size = 'md',
}: {
  name: string;
  scenarioId?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const cls =
    size === 'lg'
      ? 'h-16 w-16 text-xl'
      : size === 'sm'
        ? 'h-7 w-7 text-[10px]'
        : 'h-10 w-10 text-sm';
  const showImage = scenarioId && !imgFailed;
  return (
    <span
      className={cx(
        cls,
        'shrink-0 rounded-full grid place-items-center font-bold text-white overflow-hidden',
        'bg-gradient-to-br from-primary to-accent shadow-neon ring-1 ring-white/20'
      )}
      aria-hidden
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={withBasePath(`/personas/${scenarioId}.jpg`)}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setImgFailed(true)}
        />
      ) : (
        initials
      )}
    </span>
  );
}

/** Animierter Gesamtscore-Ring (Debrief-Held). */
function ScoreRing({
  value,
  verdict,
  passMark,
  labelUnrated,
}: {
  value: number | null;
  verdict: Debrief['verdict'];
  passMark: number;
  labelUnrated: string;
}) {
  const [animated, setAnimated] = useState(0);
  useEffect(() => {
    const target = value ?? 0;
    const id = requestAnimationFrame(() => setAnimated(target));
    return () => cancelAnimationFrame(id);
  }, [value]);

  const R = 52;
  const C = 2 * Math.PI * R;
  const pct = Math.min(100, Math.max(0, animated));
  const stroke =
    verdict === 'passed' ? '#34d399' : verdict === 'failed' ? '#fb7185' : '#94a3b8';
  // Bestehensmarke als kleiner Punkt auf dem Ring.
  const markAngle = (passMark / 100) * 2 * Math.PI - Math.PI / 2;
  const markX = 60 + R * Math.cos(markAngle);
  const markY = 60 + R * Math.sin(markAngle);

  return (
    <div className="relative h-[120px] w-[120px] shrink-0" role="img" aria-label={value != null ? `${value} %` : labelUnrated}>
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={R} fill="none" strokeWidth="10" className="stroke-border" />
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          stroke={stroke}
          strokeDasharray={C}
          strokeDashoffset={C - (pct / 100) * C}
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      <svg viewBox="0 0 120 120" className="absolute inset-0 h-full w-full pointer-events-none">
        <circle cx={markX} cy={markY} r="3.5" className="fill-foreground/60" />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        {value != null ? (
          <div className="text-center leading-none">
            <div className="text-3xl font-bold tabular-nums">{value}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">%</div>
          </div>
        ) : (
          <div className="text-[11px] text-muted-foreground text-center px-3 leading-tight">{labelUnrated}</div>
        )}
      </div>
    </div>
  );
}

function DeltaTag({ delta }: { delta: number | null }) {
  if (delta == null || delta === 0) return null;
  const up = delta > 0;
  return (
    <span
      className={cx(
        'inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full',
        up ? 'text-emerald-400 bg-emerald-500/10' : 'text-rose-400 bg-rose-500/10'
      )}
    >
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? '+' : ''}
      {delta}
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
  const [briefStep, setBriefStep] = useState(0);
  const [simId, setSimId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [starting, setStarting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [debrief, setDebrief] = useState<Debrief | null>(null);
  const [delta, setDelta] = useState<Delta | null>(null);
  const [attempt, setAttempt] = useState(1);
  const [focus, setFocus] = useState<string | null>(null);
  const [ratings, setRatings] = useState<CompetencyRating[] | null>(null);
  const [showC10, setShowC10] = useState(false);
  const [openEvidence, setOpenEvidence] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [topUpUrl, setTopUpUrl] = useState<string | null>(null);
  // Time-out-Coach (D3)
  const [timeoutOpen, setTimeoutOpen] = useState(false);
  const [coachNotes, setCoachNotes] = useState<CoachNote[]>([]);
  const [timeoutQuestion, setTimeoutQuestion] = useState('');
  const [timeoutBusy, setTimeoutBusy] = useState(false);
  const [timeoutsMax, setTimeoutsMax] = useState(3);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  // ── D4: Sprach-Schleife (Web Speech API — lokal im Browser, keine Server-Kosten) ──
  const [micActive, setMicActive] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(false);
  // ── Synthesia-Angleich (Owner-Vorgabe 04.08.) ──
  /** Gewählte Gesprächssprache (Flaggen-Pills im Briefing). */
  const [convoLocale, setConvoLocale] = useState<ConvoLocale>('de');
  // Mülleimer in der Simulationsliste (endgültig, inkl. DB): zweistufig.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /** Zeit-Regie: Persona hat sich verabschiedet — Eingabe zu, nur noch Auswertung. */
  const [timeUp, setTimeUp] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const speechSupported =
    typeof window !== 'undefined' &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  // Diktat/Vorlesen folgen der GEWÄHLTEN Gesprächssprache (nicht der Autorensprache).
  const speechLang = SPEECH_LANG[convoLocale];

  // Gewollt-an-Merker: Browser beenden die Erkennung nach Stille von selbst —
  // solange der Nutzer das Mikro nicht ausgeschaltet hat, starten wir neu
  // (Synthesia-Verhalten: das Mikro bleibt im Gespräch einfach an).
  const wantMicRef = useRef(false);

  const stopMic = useCallback(() => {
    wantMicRef.current = false;
    try {
      recognitionRef.current?.stop();
    } catch {
      /* schon gestoppt */
    }
    recognitionRef.current = null;
    setMicActive(false);
  }, []);

  /** Diktat: erkannter Text wird ans Eingabefeld ANGEHÄNGT (nichts überschreiben). */
  const startMic = useCallback(() => {
    if (!speechSupported || micActive) return;
    wantMicRef.current = true;
    // Sprich-Modus: wer ins Mikro spricht, bekommt die Antwort auch zu hören.
    if (ttsSupported) setSpeakReplies(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new Ctor();
    rec.lang = speechLang;
    rec.continuous = true;
    rec.interimResults = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let text = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) text += e.results[i][0].transcript;
      }
      if (text.trim()) {
        setInput((prev) => (prev ? prev.replace(/\s+$/, '') + ' ' : '') + text.trim());
      }
    };
    rec.onend = () => {
      // Stille-Timeout des Browsers: neu starten, solange das Mikro gewollt an ist.
      if (wantMicRef.current) {
        try {
          rec.start();
          return;
        } catch {
          /* Neustart nicht möglich → sauber aus */
        }
      }
      setMicActive(false);
    };
    rec.onerror = () => {
      wantMicRef.current = false;
      setMicActive(false);
    };
    recognitionRef.current = rec;
    setMicActive(true);
    rec.start();
  }, [speechSupported, micActive, speechLang, ttsSupported]);

  /** Persona-Antwort vorlesen (Anruf-Anmutung) — Stimme passend zur Szenario-Sprache. */
  const speak = useCallback(
    (text: string) => {
      if (!ttsSupported) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = speechLang;
      const voices = window.speechSynthesis.getVoices();
      const match =
        voices.find((v) => v.lang === speechLang) ??
        voices.find((v) => v.lang.startsWith(speechLang.slice(0, 2)));
      if (match) u.voice = match;
      u.rate = 1.04;
      window.speechSynthesis.speak(u);
    },
    [ttsSupported, speechLang]
  );

  // Aufraeumen: beim Verlassen des Chats Mikro und Vorlesen stoppen.
  useEffect(() => {
    if (view !== 'chat') {
      stopMic();
      if (ttsSupported) window.speechSynthesis.cancel();
    }
  }, [view, stopMic, ttsSupported]);

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

  const expectationLabel = useCallback(
    (e: DebriefAnchor['expectation']) =>
      e === 'exceeds'
        ? ts.expExceeds
        : e === 'meets'
          ? ts.expMeets
          : e === 'approaching'
            ? ts.expApproaching
            : e === 'below'
              ? ts.expBelow
              : ts.notObservable,
    [ts]
  );

  const EXPECTATION_STYLES: Record<DebriefAnchor['expectation'], string> = {
    exceeds: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    meets: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
    approaching: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    below: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
    'not-observable': 'bg-muted text-muted-foreground border-border',
  };

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
    } else if (code === 'TIME_UP') {
      // Kein Fehler: die Zeit ist um — Banner statt roter Meldung.
      setTimeUp(true);
    } else if (code === 'TIMEOUT_LIMIT') {
      setError(ts.timeoutLimit);
    } else {
      setError(ts.genericError);
    }
  }

  async function deleteSim(simId: string) {
    setDeletingId(simId);
    setError(null);
    try {
      const res = await authFetch('/api/simulation/delete', {
        method: 'POST',
        body: JSON.stringify({ simId }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        await handleApiFailure(res);
        return;
      }
      setRecent((prev) => prev.filter((x) => x.id !== simId));
    } catch {
      setError(ts.genericError);
    } finally {
      setDeletingId(null);
      setPendingDeleteId(null);
    }
  }

  async function startSimulation(s: PublicScenario, withFocus?: string | null) {
    setStarting(true);
    setError(null);
    try {
      const res = await authFetch('/api/simulation/start', {
        method: 'POST',
        body: JSON.stringify({
          scenarioId: s.id,
          locale: convoLocale,
          ...(withFocus ? { focus: withFocus } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        await handleApiFailure(res);
        return;
      }
      setScenario(s);
      setSimId(json.simulation.id);
      setTurns(json.simulation.turns);
      setAttempt(json.simulation.attempt ?? 1);
      setFocus(json.simulation.focus ?? null);
      setFeedback(null);
      setDebrief(null);
      setDelta(null);
      setRatings(null);
      setCoachNotes([]);
      setBriefingOpen(false);
      setTimeoutOpen(false);
      setTimeUp(false);
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
      setAttempt(json.simulation.attempt ?? 1);
      setFocus(json.simulation.focus ?? null);
      setCoachNotes(json.simulation.coachNotes ?? []);
      setConvoLocale(json.simulation.convoLocale ?? s.locale ?? 'de');
      setTimeUp(json.simulation.timeUp === true);
      if (json.simulation.status === 'finished' && json.simulation.feedback) {
        setFeedback(json.simulation.feedback);
        setDebrief(json.simulation.debrief ?? null);
        setDelta(json.simulation.delta ?? null);
        setRatings(json.simulation.competencyRatings ?? null);
        setView('feedback');
      } else {
        setFeedback(null);
        setDebrief(null);
        setDelta(null);
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
      // Zeit-Regie: die Persona hat sich verabschiedet → Eingabe schließen.
      if (json.timeUp === true) {
        setTimeUp(true);
        stopMic();
      }
      if (speakReplies) speak(json.reply);
    } catch {
      setTurns((prev) => prev.filter((x) => x !== optimistic));
      setInput(message);
      setError(ts.genericError);
    } finally {
      setSending(false);
    }
  }

  async function requestTimeout() {
    if (!simId || timeoutBusy) return;
    setTimeoutBusy(true);
    setError(null);
    try {
      const res = await authFetch('/api/simulation/timeout', {
        method: 'POST',
        body: JSON.stringify({
          simId,
          ...(timeoutQuestion.trim() ? { question: timeoutQuestion.trim() } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        await handleApiFailure(res);
        return;
      }
      setCoachNotes((prev) => [
        ...prev,
        { question: timeoutQuestion.trim(), answer: json.tip, ts: new Date().toISOString() },
      ]);
      setTimeoutsMax(json.timeoutsMax ?? 3);
      setTimeoutQuestion('');
    } catch {
      setError(ts.genericError);
    } finally {
      setTimeoutBusy(false);
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
      setDebrief(json.debrief ?? null);
      setDelta(json.delta ?? null);
      setAttempt(json.attempt ?? 1);
      setFocus(json.focus ?? null);
      setRatings(json.competencyRatings ?? null);
      setConfirmOpen(false);
      setTimeoutOpen(false);
      setView('feedback');
      // Header-Saldo nachladen — die Auswertung hat gerade 1 Credit gekostet.
      window.dispatchEvent(new Event(CREDITS_REFRESH_EVENT));
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
    setDebrief(null);
    setDelta(null);
    setRatings(null);
    setFocus(null);
    setAttempt(1);
    setCoachNotes([]);
    setError(null);
    setConfirmOpen(false);
    setTimeoutOpen(false);
    setBriefStep(0);
    setOpenEvidence({});
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
          {/* Erklärvideo (Synthesia-Muster »Watch preview«) */}
          <ExplainerVideoButton />
          {recent.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {ts.resumeTitle}
              </h2>
              <div className="space-y-2">
                {recent.map((r) => {
                  const s = scenarioById.get(r.scenarioId);
                  if (!s) return null;
                  const confirming = pendingDeleteId === r.id;
                  return (
                    // Kein <button> im <button>: Zeile ist ein div, der
                    // Weiter-Bereich und der Mülleimer sind Geschwister.
                    <div
                      key={r.id}
                      className="w-full glass-panel rounded-xl p-3 flex items-center justify-between gap-3 hover:border-primary/40 border border-border transition-colors"
                    >
                      <button
                        onClick={() => void resumeSimulation(r)}
                        className="flex items-center gap-3 min-w-0 flex-1 text-left"
                      >
                        <PersonaAvatar name={s.persona.name} scenarioId={s.id} size="sm" />
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{s.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {ts.attemptLabel} {r.attempt} · {new Date(r.createdAt).toLocaleString()} · {r.turnCount} {ts.turnsLabel}
                          </div>
                        </div>
                      </button>
                      <div className="flex items-center gap-2 shrink-0">
                        {r.overall != null && (
                          <span
                            className={cx(
                              'text-xs font-bold tabular-nums px-2 py-0.5 rounded-full border',
                              r.verdict === 'passed'
                                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                : r.verdict === 'failed'
                                  ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                                  : 'bg-muted text-muted-foreground border-border'
                            )}
                          >
                            {r.overall} %
                          </span>
                        )}
                        <span
                          className={cx(
                            'text-xs px-2 py-0.5 rounded-full border',
                            r.status === 'active'
                              ? 'bg-sky-500/15 text-sky-400 border-sky-500/30'
                              : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                          )}
                        >
                          {r.status === 'active' ? ts.statusActive : ts.statusFinished}
                        </span>
                        {/* Mülleimer mit zweistufiger Bestätigung (endgültig, inkl. DB) */}
                        {confirming ? (
                          <span className="flex items-center gap-1.5">
                            <span className="text-xs text-rose-400 font-medium hidden sm:inline">
                              {ts.deleteConfirm}
                            </span>
                            <button
                              onClick={() => void deleteSim(r.id)}
                              disabled={deletingId === r.id}
                              title={ts.deleteSim}
                              aria-label={ts.deleteSim}
                              className="rounded-lg border border-rose-500/50 bg-rose-500/15 p-1.5 text-rose-400 transition-colors hover:bg-rose-500/25 disabled:opacity-50"
                            >
                              {deletingId === r.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </button>
                            <button
                              onClick={() => setPendingDeleteId(null)}
                              title={t.common.cancel}
                              aria-label={t.common.cancel}
                              className="rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setPendingDeleteId(r.id)}
                            title={ts.deleteSim}
                            aria-label={ts.deleteSim}
                            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
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
                  setBriefStep(0);
                  setConvoLocale(s.locale ?? 'de');
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
                <div className="flex items-center gap-2">
                  <PersonaAvatar name={s.persona.name} scenarioId={s.id} size="sm" />
                  <div className="text-xs text-muted-foreground min-w-0">
                    <div className="font-medium text-foreground truncate">{s.persona.name}</div>
                    <div className="truncate">{s.persona.role}</div>
                  </div>
                </div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                  {s.locale === 'en' ? ts.englishOnly : ts.germanOnly}
                </div>
              </button>
            ))}
          </section>
        </div>
      </AppShell>
    );
  }

  if (view === 'briefing' && scenario) {
    const b = scenario.candidateBriefing;
    const steps = [
      { icon: User, label: ts.stepSituation },
      { icon: Target, label: ts.stepGoals },
      { icon: Compass, label: ts.stepApproach },
    ];
    const isLast = briefStep === steps.length - 1;
    const { motto, heroTitle } = splitTitle(scenario.title);
    const selectedLang = CONVO_LANGS.find((l) => l.code === convoLocale) ?? CONVO_LANGS[3];
    return (
      // Synthesia-Angleich (Owner-Vorgabe 04.08.): Szenariotitel NICHT in der
      // Fenster-Kopfzeile — links Text + Kontext-Treppe, rechts das große
      // Porträt mit Titel-Overlay und Start-Button.
      <AppShell title={ts.title} subtitle={ts.subtitle}>
        <div className="max-w-6xl space-y-4">
          {errorBanner}
          <button
            onClick={backToList}
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <ArrowLeft className="h-4 w-4" /> {ts.backToList}
          </button>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px] items-start">
            {/* ── Linke Spalte: Motto, Teaser, Kontext-Treppe, Sprachwahl ── */}
            <div className="space-y-4 order-2 lg:order-1">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">{motto}</h2>
                <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{scenario.teaser}</p>
              </div>

              {renderBriefSteps()}

              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={() => setBriefStep((s) => Math.max(0, s - 1))}
                  disabled={briefStep === 0}
                  className="rounded-xl px-4 py-2.5 text-sm border border-border hover:bg-muted transition-colors disabled:opacity-40 flex items-center gap-1"
                >
                  <ArrowLeft className="h-4 w-4" /> {ts.stepBack}
                </button>
                {!isLast && (
                  <button
                    onClick={() => setBriefStep((s) => Math.min(steps.length - 1, s + 1))}
                    className="btn-gradient text-white font-semibold rounded-xl px-6 py-2.5 flex items-center gap-2 shadow-neon"
                  >
                    {ts.stepNext} <ArrowRight className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Sprachwahl (Synthesia-Optik: Flaggen-Pills, genau EN/ES/FR/DE) */}
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  {ts.languageLabel}
                </div>
                <div className="flex flex-wrap gap-2">
                  {CONVO_LANGS.map((l) => (
                    <button
                      key={l.code}
                      onClick={() => setConvoLocale(l.code)}
                      aria-pressed={convoLocale === l.code}
                      className={cx(
                        'inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors',
                        convoLocale === l.code
                          ? 'border-primary/60 bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/30'
                      )}
                    >
                      <FlagIcon code={l.code} />
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Rechte Spalte: Hero-Porträt mit Overlay (Synthesia-Muster) ── */}
            <div className="order-1 lg:order-2 lg:sticky lg:top-4">
              <div className="relative overflow-hidden rounded-3xl border border-border shadow-neon aspect-[4/5] bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={withBasePath(`/personas/${scenario.id}.jpg`)}
                  alt={scenario.persona.name}
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/10" />
                {/* Badges oben (Stufe + Sprache) */}
                <div className="absolute left-4 top-4 flex flex-wrap gap-2">
                  <span className="rounded-full bg-black/55 px-3 py-1 text-xs font-semibold text-white backdrop-blur">
                    {levelLabel(scenario.difficulty)}
                  </span>
                  <span className="rounded-full bg-black/55 px-3 py-1 text-xs font-semibold text-white backdrop-blur inline-flex items-center gap-1.5">
                    <FlagIcon code={selectedLang.code} /> {selectedLang.label}
                  </span>
                </div>
                {/* Overlay unten: Gesprächstyp + Rolle + Start */}
                <div className="absolute inset-x-0 bottom-0 p-5 text-center space-y-3">
                  <div>
                    <div className="text-2xl font-bold leading-tight text-white drop-shadow">
                      {heroTitle}
                    </div>
                    <div className="mt-1 text-sm text-white/85">{scenario.persona.role}</div>
                  </div>
                  <button
                    onClick={() => void startSimulation(scenario)}
                    disabled={starting}
                    className="w-full btn-gradient text-white font-semibold rounded-xl px-6 py-3 flex items-center justify-center gap-2 shadow-neon disabled:opacity-60"
                  >
                    {starting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
                    {ts.startCta}
                  </button>
                  <div className="text-xs text-white/75 flex items-center justify-center gap-1">
                    <Clock className="h-3.5 w-3.5" /> ~{scenario.durationMin} {ts.minutesShort}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </AppShell>
    );

    /* Kontext-Treppe (Tabs + Inhalt) — unverändert, nur in die linke Spalte gezogen. */
    function renderBriefSteps() {
      return (
        <>
          {/* Treppen-Navigation */}
          <div className="flex items-center gap-2">
            {steps.map((st, i) => (
              <button
                key={i}
                onClick={() => setBriefStep(i)}
                className={cx(
                  'flex-1 flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors',
                  i === briefStep
                    ? 'border-primary/50 bg-primary/10 text-primary'
                    : i < briefStep
                      ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400'
                      : 'border-border text-muted-foreground hover:text-foreground'
                )}
              >
                <st.icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{st.label}</span>
                <span className="sm:hidden">{i + 1}</span>
              </button>
            ))}
          </div>

          <div className="glass-panel rounded-2xl p-6 min-h-[280px]">
            {briefStep === 0 && (
              <div className="space-y-4">
                <section>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                    {ts.yourRole}
                  </h3>
                  <p className="text-sm leading-relaxed">{b.yourRole}</p>
                </section>
                <section>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                    {ts.relationship}
                  </h3>
                  <p className="text-sm leading-relaxed">{b.relationship}</p>
                </section>
                <section>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                    {ts.incidents}
                  </h3>
                  <ul className="space-y-2">
                    {b.incidents.map((i, idx) => (
                      <li key={idx} className="text-sm leading-relaxed flex gap-2">
                        <span className="text-primary font-bold shrink-0">{idx + 1}.</span>
                        <span>{i}</span>
                      </li>
                    ))}
                  </ul>
                </section>
                {b.factVisuals && b.factVisuals.length > 0 ? (
                  <section>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                      {ts.factSheet}
                    </h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {b.factVisuals.map((v, idx) => (
                        <FactChart key={idx} v={v} />
                      ))}
                    </div>
                  </section>
                ) : b.factSheet && b.factSheet.length > 0 ? (
                  <section>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                      {ts.factSheet}
                    </h3>
                    <ul className="space-y-1 rounded-lg border border-border bg-muted/40 p-3">
                      {b.factSheet.map((f, idx) => (
                        <li key={idx} className="text-xs font-mono leading-relaxed">
                          {f}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
            )}
            {briefStep === 1 && (
              <section>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-1">
                  <Target className="h-4 w-4 text-primary" /> {ts.goals}
                </h3>
                <ol className="space-y-3">
                  {b.goals.map((g, idx) => (
                    <li key={idx} className="text-sm leading-relaxed flex gap-3 rounded-xl border border-border bg-muted/30 p-3">
                      <span className="text-primary font-bold shrink-0">{idx + 1}.</span>
                      <span>{g}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
            {briefStep === 2 && (
              <div className="space-y-4">
                {b.approachHints && b.approachHints.length > 0 && (
                  <section>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-1">
                      <Compass className="h-4 w-4 text-primary" /> {ts.stepApproach}
                    </h3>
                    <ul className="space-y-2">
                      {b.approachHints.map((h, idx) => (
                        <li key={idx} className="text-sm leading-relaxed flex gap-2">
                          <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                          <span>{h}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {b.expectation && (
                  <section className="rounded-xl border border-accent/30 bg-accent/5 p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-accent mb-1 flex items-center gap-1">
                      <Lightbulb className="h-3.5 w-3.5" /> {ts.expectationTitle}
                    </h3>
                    <p className="text-sm leading-relaxed">{b.expectation}</p>
                  </section>
                )}
              </div>
            )}
          </div>

        </>
      );
    }
  }

  if (view === 'chat' && scenario) {
    const timeoutsLeft = Math.max(0, timeoutsMax - coachNotes.length);
    return (
      <AppShell
        title={splitTitle(scenario.title).heroTitle}
        subtitle={`${ts.withLabel} ${scenario.persona.name} — ${scenario.persona.role}`}
        noPadding
        actions={
          <div className="flex items-center gap-2">
            {ttsSupported && (
              <button
                onClick={() => {
                  if (speakReplies && ttsSupported) window.speechSynthesis.cancel();
                  setSpeakReplies((v) => !v);
                }}
                className={cx(
                  'text-sm font-semibold rounded-lg px-3 py-2 border transition-colors flex items-center gap-1.5',
                  speakReplies
                    ? 'border-primary/40 text-primary bg-primary/10'
                    : 'border-border text-muted-foreground hover:text-foreground'
                )}
                title={speakReplies ? ts.ttsOff : ts.ttsOn}
              >
                {speakReplies ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </button>
            )}
            <button
              onClick={() => setTimeoutOpen(true)}
              disabled={userTurnCount < 1 || timeoutsLeft === 0}
              className="text-sm font-semibold rounded-lg px-3 py-2 border border-accent/40 text-accent hover:bg-accent/10 transition-colors flex items-center gap-1.5 disabled:opacity-50"
              title={ts.timeoutHint}
            >
              <Pause className="h-4 w-4" /> {ts.timeoutCta}
              <span className="text-[10px] tabular-nums opacity-70">{coachNotes.length}/{timeoutsMax}</span>
            </button>
            <button
              onClick={() => setConfirmOpen(true)}
              disabled={finishing || userTurnCount < 1}
              className="text-sm font-semibold rounded-lg px-3 py-2 border border-primary/40 text-primary hover:bg-primary/10 transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <Flag className="h-4 w-4" /> {ts.finishCta}
            </button>
          </div>
        }
      >
        <div className="flex flex-col h-full">
          {/* Fokus-Banner (D2) */}
          {focus && (
            <div className="border-b border-border bg-accent/5">
              <div className="max-w-3xl mx-auto px-4 py-2 flex items-start gap-2 text-xs">
                <Sparkles className="h-3.5 w-3.5 text-accent shrink-0 mt-0.5" />
                <span>
                  <span className="font-semibold text-accent">{ts.focusBanner}: </span>
                  {focus}
                </span>
              </div>
            </div>
          )}

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
              <div className="px-4 pb-4 max-h-72 overflow-y-auto custom-scrollbar max-w-3xl mx-auto space-y-3 text-sm">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{ts.goals}</div>
                  <ol className="space-y-1">
                    {scenario.candidateBriefing.goals.map((g, idx) => (
                      <li key={idx} className="flex gap-2">
                        <span className="text-primary font-bold shrink-0">{idx + 1}.</span>
                        <span>{g}</span>
                      </li>
                    ))}
                  </ol>
                </div>
                {scenario.candidateBriefing.approachHints && (
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{ts.stepApproach}</div>
                    <ul className="space-y-1">
                      {scenario.candidateBriefing.approachHints.map((h, idx) => (
                        <li key={idx} className="flex gap-2">
                          <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                          <span>{h}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
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
                  className={cx('flex items-end gap-2', turn.role === 'user' ? 'justify-end' : 'justify-start')}
                >
                  {turn.role === 'persona' && <PersonaAvatar name={scenario.persona.name} scenarioId={scenario.id} size="sm" />}
                  <div
                    className={cx(
                      'rounded-2xl px-4 py-2.5 text-sm leading-relaxed max-w-[85%] whitespace-pre-wrap',
                      turn.role === 'user'
                        ? 'bg-primary text-primary-foreground rounded-br-sm'
                        : 'glass-panel border border-border rounded-bl-sm'
                    )}
                  >
                    {turn.text}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex items-end gap-2 justify-start">
                  <PersonaAvatar name={scenario.persona.name} scenarioId={scenario.id} size="sm" />
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
            {/* Zeit-Regie (Owner-Vorgabe 04.08.): nach der Verabschiedung der
                Persona ist die Eingabe zu — es bleibt nur die Auswertung. */}
            {timeUp && (
              <div className="max-w-3xl mx-auto mb-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 text-amber-500 dark:text-amber-400">
                  <Clock className="h-4 w-4 shrink-0" /> {ts.timeUpBanner}
                </span>
                <button
                  onClick={() => setConfirmOpen(true)}
                  disabled={finishing}
                  className="btn-gradient text-white font-semibold rounded-lg px-4 py-2 text-sm flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" /> {ts.finishCta}
                </button>
              </div>
            )}
            {micActive && !timeUp && (
              <div className="max-w-3xl mx-auto mb-2 flex items-center gap-2 text-xs text-primary">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
                {ts.micLive}
              </div>
            )}
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
                placeholder={timeUp ? ts.timeUpPlaceholder : ts.inputPlaceholder}
                disabled={timeUp}
                className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
              />
              {speechSupported && !timeUp && (
                <button
                  onClick={() => (micActive ? stopMic() : startMic())}
                  className={cx(
                    'relative rounded-xl p-3 border transition-colors',
                    micActive
                      ? 'border-primary/60 text-primary bg-primary/15 shadow-neon'
                      : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
                  )}
                  aria-label={micActive ? ts.micStop : ts.micStart}
                  title={micActive ? ts.micStop : ts.micStart}
                >
                  {micActive && (
                    <span className="absolute inset-0 rounded-xl border-2 border-primary/50 animate-ping pointer-events-none" aria-hidden />
                  )}
                  <Mic className="h-5 w-5" />
                </button>
              )}
              <button
                onClick={() => void sendTurn()}
                disabled={sending || !input.trim() || timeUp}
                className="btn-gradient text-white rounded-xl p-3 shadow-neon disabled:opacity-50"
                aria-label={ts.send}
              >
                <Send className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Time-out-Coach (D3) — Szene angehalten */}
        {timeoutOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="glass-panel rounded-2xl border border-accent/40 p-6 max-w-lg w-full space-y-4 bg-card max-h-[85vh] overflow-y-auto custom-scrollbar">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold text-lg flex items-center gap-2">
                  <Pause className="h-5 w-5 text-accent" /> {ts.timeoutTitle}
                </h3>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {coachNotes.length}/{timeoutsMax}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{ts.timeoutHint}</p>

              {coachNotes.map((n, idx) => (
                <div key={idx} className="space-y-2">
                  {n.question && (
                    <div className="text-sm rounded-xl bg-primary/10 border border-primary/20 px-3 py-2">
                      {n.question}
                    </div>
                  )}
                  <div className="text-sm rounded-xl border border-accent/30 bg-accent/5 px-3 py-2 leading-relaxed whitespace-pre-wrap">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-accent mb-1">
                      Coach
                    </div>
                    {n.answer}
                  </div>
                </div>
              ))}
              {timeoutBusy && (
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> {ts.timeoutThinking}
                </div>
              )}

              {coachNotes.length < timeoutsMax && (
                <div className="flex items-end gap-2">
                  <textarea
                    value={timeoutQuestion}
                    onChange={(e) => setTimeoutQuestion(e.target.value)}
                    rows={2}
                    placeholder={ts.timeoutPlaceholder}
                    className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                  <button
                    onClick={() => void requestTimeout()}
                    disabled={timeoutBusy}
                    className="rounded-xl px-4 py-2.5 text-sm font-semibold border border-accent/40 text-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
                  >
                    {ts.timeoutAsk}
                  </button>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  onClick={() => setTimeoutOpen(false)}
                  className="btn-gradient text-white font-semibold rounded-xl px-5 py-2.5 text-sm flex items-center gap-2"
                >
                  <Play className="h-4 w-4" /> {ts.timeoutResume}
                </button>
              </div>
            </div>
          </div>
        )}

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
    const deltaByKey = new Map((delta?.anchors ?? []).map((a) => [a.key, a.delta]));
    const verdict = debrief?.verdict ?? 'unrated';
    const observedCount = debrief?.anchors.filter((a) => a.pct != null).length ?? 0;
    return (
      <AppShell title={ts.feedbackTitle} subtitle={splitTitle(scenario.title).heroTitle}>
        <div className="max-w-3xl space-y-6">
          {errorBanner}

          {/* ── Debrief-Held: Score, Urteil, größter Hebel ── */}
          {debrief && (
            <section className="glass-panel rounded-2xl p-6 border border-border">
              <div className="flex flex-col sm:flex-row items-center gap-6">
                <ScoreRing
                  value={debrief.overall}
                  verdict={verdict}
                  passMark={debrief.passMarkPct}
                  labelUnrated={ts.unrated}
                />
                <div className="flex-1 min-w-0 text-center sm:text-left space-y-2">
                  <div className="flex items-center justify-center sm:justify-start gap-2 flex-wrap">
                    <span
                      className={cx(
                        'text-sm font-bold px-3 py-1 rounded-full border',
                        verdict === 'passed'
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                          : verdict === 'failed'
                            ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                            : 'bg-muted text-muted-foreground border-border'
                      )}
                    >
                      {verdict === 'passed' ? ts.passed : verdict === 'failed' ? ts.failed : ts.unrated}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {ts.passMark}: {debrief.passMarkPct} %
                    </span>
                    <span className="text-xs text-muted-foreground">
                      · {ts.attemptLabel} {attempt}
                    </span>
                    {delta?.overall != null && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        · <DeltaTag delta={delta.overall} /> {ts.deltaVsPrev} {delta.prevAttempt}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {observedCount}/{debrief.anchors.length} {ts.coverageNote} · {debrief.checkpointsHit}/{debrief.checkpointsTotal} {ts.checkpointsTitle}
                  </p>
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-left">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-primary mb-1 flex items-center gap-1">
                      <Sparkles className="h-3.5 w-3.5" /> {ts.biggestLever}
                    </div>
                    <p className="text-sm leading-relaxed">{feedback.nextStep}</p>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Fokus-Review (D2) */}
          {feedback.focusReview && focus && (
            <section
              className={cx(
                'glass-panel rounded-2xl p-4 border flex items-start gap-3',
                feedback.focusReview.addressed
                  ? 'border-emerald-500/30 bg-emerald-500/5'
                  : 'border-amber-500/30 bg-amber-500/5'
              )}
            >
              {feedback.focusReview.addressed ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <RotateCcw className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {ts.focusReviewTitle} — {feedback.focusReview.addressed ? ts.focusYes : ts.focusNo}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 italic">»{focus}«</p>
                <p className="text-sm leading-relaxed mt-1">{feedback.focusReview.comment}</p>
              </div>
            </section>
          )}

          <section className="glass-panel rounded-2xl p-6 space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {ts.summaryTitle}
            </h2>
            <p className="text-sm leading-relaxed">{feedback.summary}</p>
          </section>

          {/* Kompetenz-Anker mit Erwartungslabel, Balken, Delta und Belegen */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {ts.rubricTitle}
            </h2>
            {feedback.rubric.map((r) => {
              const anchor = debrief?.anchors.find((a) => a.key === r.key);
              const pct = anchor?.pct ?? null;
              const exp = anchor?.expectation ?? (r.score == null ? 'not-observable' : 'meets');
              const anchorDelta = deltaByKey.get(r.key) ?? null;
              const isOpen = openEvidence[r.key] ?? false;
              return (
                <div key={r.key} className="glass-panel rounded-xl border border-border p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <h3 className="text-sm font-semibold">{r.label}</h3>
                    <div className="flex items-center gap-2">
                      <DeltaTag delta={anchorDelta} />
                      <span
                        className={cx(
                          'text-xs font-semibold px-2 py-0.5 rounded-full border',
                          EXPECTATION_STYLES[exp]
                        )}
                      >
                        {expectationLabel(exp)}
                      </span>
                    </div>
                  </div>
                  {pct != null && (
                    <div className="h-1.5 rounded-full bg-border overflow-hidden">
                      <div
                        className={cx(
                          'h-full rounded-full transition-all duration-700',
                          exp === 'exceeds' || exp === 'meets'
                            ? 'bg-gradient-to-r from-primary to-accent'
                            : exp === 'approaching'
                              ? 'bg-amber-400'
                              : 'bg-rose-400'
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                  <p className="text-sm text-muted-foreground leading-relaxed">{r.why}</p>
                  {r.evidence.length > 0 && (
                    <div>
                      <button
                        onClick={() => setOpenEvidence((m) => ({ ...m, [r.key]: !isOpen }))}
                        className="text-[11px] font-semibold uppercase tracking-wide text-primary flex items-center gap-1"
                      >
                        <ChevronDown className={cx('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-180')} />
                        {isOpen ? ts.hideEvidence : ts.showEvidence} ({r.evidence.length})
                      </button>
                      {isOpen && (
                        <div className="space-y-1.5 mt-2">
                          {r.evidence.map((e, idx) => (
                            <blockquote
                              key={idx}
                              className="text-xs italic border-l-2 border-primary/40 pl-2.5 py-0.5 text-muted-foreground leading-relaxed"
                            >
                              {e}
                            </blockquote>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
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
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {r.score == null ? ts.notObservable : `${r.score} / 4`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* CTA-Zeile: Fokus-Retry zuerst — die Schleife ist das Produkt. */}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => void startSimulation(scenario, feedback.nextStep.slice(0, 280))}
              disabled={starting}
              className="btn-gradient text-white font-semibold rounded-xl px-6 py-3 flex items-center gap-2 shadow-neon disabled:opacity-60"
            >
              {starting ? <Loader2 className="h-5 w-5 animate-spin" /> : <RotateCcw className="h-5 w-5" />}
              {ts.retryFocusCta}
            </button>
            <button
              onClick={backToList}
              className="rounded-xl px-6 py-3 text-sm font-semibold border border-border hover:bg-muted transition-colors flex items-center gap-2"
            >
              <MessagesSquare className="h-5 w-5" /> {ts.newSimulation}
            </button>
          </div>
        </div>
      </AppShell>
    );
  }

  return null;
}
