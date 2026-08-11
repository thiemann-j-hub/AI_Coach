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
import { useRouter, useSearchParams } from 'next/navigation';
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
  Mic,
  Pause,
  Play,
  Send,
  Sparkles,
  Target,
  User,
  Volume2,
  VolumeX,
  Trash2,
  X,
} from 'lucide-react';
import AppShell from '@/components/app/app-shell';
import { ExplainerVideoButton } from '@/components/app/explainer-video';
import { TranscriptDropBar } from '@/components/app/transcript-drop-bar';
import { authFetch } from '@/lib/api-client';
import { CREDITS_REFRESH_EVENT } from '@/components/app/credit-balance';
import { withBasePath } from '@/lib/base-path';
import { useAuth } from '@/providers/auth-provider';
import { useTranslation } from '@/i18n/useTranslation';
import type { FactVisual } from '@/lib/simulation/types';
import { recommendScenarios } from '@/lib/simulation/empfehlung';

/** Wirkungsrichtungen in fester Anzeige-Reihenfolge (Blueprint §2.1). */
const CATEGORY_ORDER = [
  'mitarbeiterfuehrung',
  'zusammenarbeit',
  'vertrieb',
  'stakeholder',
] as const;
type ScenarioCategory = (typeof CATEGORY_ORDER)[number];

interface PublicScenario {
  id: string;
  title: string;
  teaser: string;
  difficulty: 1 | 2 | 3;
  durationMin: number;
  locale?: 'de' | 'en';
  category: ScenarioCategory;
  competencyFocus?: string[];
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

/** Einstiegs-Insight des Katalog-Endpunkts (W1-4): schwächste beobachtete C. */
interface EntryInsight {
  weakestC: string;
  weakestName: string | null;
  source: 'sim' | 'run';
}

type View = 'loading' | 'disabled' | 'list' | 'briefing' | 'chat';

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

export default function SimulationClient() {
  const { t, locale } = useTranslation();
  const ts = t.simulation;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

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
  const [attempt, setAttempt] = useState(1);
  const [focus, setFocus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ── Einstieg (COACH-UX-BLUEPRINT §1) ──
  /** Empfehlungs-Insight des Katalogs (W1-4); null = Cold Start. */
  const [insight, setInsight] = useState<EntryInsight | null>(null);
  /** Filterzeile: »Alle« oder eine nicht-leere Kategorie (W1-5). */
  const [categoryFilter, setCategoryFilter] = useState<'all' | ScenarioCategory>('all');
  // Geister-Karte → Szenario-Wunsch (W1-5)
  const [wishOpen, setWishOpen] = useState(false);
  const [wishText, setWishText] = useState('');
  const [wishBusy, setWishBusy] = useState(false);
  const [wishDone, setWishDone] = useState(false);
  /** Fokus aus dem Deep-Link (?szenario=&fokus= — Retry von der Auswertungsseite). */
  const pendingFocusRef = useRef<string | null>(null);
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
  // ── W2-1 sichtbare Uhr: Client-Anzeige ab createdAt; Server bleibt Wahrheit. ──
  const [simStartedAt, setSimStartedAt] = useState<string | null>(null);
  const [nowTs, setNowTs] = useState(() => Date.now());
  // ── W2-3: Verlassen-Dialog (Lauf bleibt offen) ──
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [aborting, setAborting] = useState(false);
  // ── W2-5: Ziel-Streifen (mobil einklappbar, Zustand gemerkt) ──
  const [goalsOpen, setGoalsOpen] = useState(true);
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

  // W2-1: Uhr tickt nur im Chat (1 s Auflösung genügt für mm:ss).
  useEffect(() => {
    if (view !== 'chat' || !simStartedAt || timeUp) return;
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [view, simStartedAt, timeUp]);

  // W2-5: Einklapp-Zustand des Ziel-Streifens merken (mobil relevant).
  useEffect(() => {
    try {
      setGoalsOpen(localStorage.getItem('coach_sim-goals-open') !== '0');
    } catch {
      /* localStorage optional */
    }
  }, []);
  function toggleGoals() {
    setGoalsOpen((v) => {
      try {
        localStorage.setItem('coach_sim-goals-open', v ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !v;
    });
  }

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
      setInsight(json.insight ?? null);
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

  // Deep-Link von der Auswertungsseite (W1-7): /?szenario=<id>&fokus=<text>
  // öffnet direkt das Briefing des Szenarios; der Fokus geht beim Start mit.
  useEffect(() => {
    if (view !== 'list' || scenarios.length === 0) return;
    const wanted = searchParams.get('szenario');
    if (!wanted) return;
    const s = scenarios.find((x) => x.id === wanted);
    if (!s) return;
    pendingFocusRef.current = searchParams.get('fokus');
    setScenario(s);
    setError(null);
    setBriefStep(0);
    setConvoLocale(s.locale ?? 'de');
    setView('briefing');
    // Query-Parameter verbrauchen — Reload soll wieder am Einstieg landen.
    router.replace('/', { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, scenarios]);

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
    // Deep-Link-Fokus (Retry von der Auswertungsseite) — einmalig verbrauchen.
    const focusToSend = withFocus ?? pendingFocusRef.current ?? undefined;
    pendingFocusRef.current = null;
    try {
      const res = await authFetch('/api/simulation/start', {
        method: 'POST',
        body: JSON.stringify({
          scenarioId: s.id,
          locale: convoLocale,
          ...(focusToSend ? { focus: focusToSend } : {}),
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
      setSimStartedAt(json.simulation.createdAt ?? new Date().toISOString());
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
    // Fertige Auswertungen haben eine eigene Adresse (W1-7).
    if (item.status === 'finished') {
      router.push(`/simulation/${encodeURIComponent(item.id)}`);
      return;
    }
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
      if (json.simulation.status === 'finished') {
        router.push(`/simulation/${encodeURIComponent(item.id)}`);
        return;
      }
      setScenario(s);
      setSimId(json.simulation.id);
      setTurns(json.simulation.turns);
      setAttempt(json.simulation.attempt ?? 1);
      setFocus(json.simulation.focus ?? null);
      setSimStartedAt(json.simulation.createdAt ?? item.createdAt);
      setCoachNotes(json.simulation.coachNotes ?? []);
      setConvoLocale(json.simulation.convoLocale ?? s.locale ?? 'de');
      setTimeUp(json.simulation.timeUp === true);
      setBriefingOpen(false);
      setView('chat');
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
      // Header-Saldo nachladen — die Auswertung hat gerade 1 Credit gekostet.
      window.dispatchEvent(new Event(CREDITS_REFRESH_EVENT));
      // W1-7: Auswertung hat eine eigene Adresse — Reload-fest, verlinkbar.
      router.push(`/simulation/${encodeURIComponent(simId)}`);
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
    setFocus(null);
    setAttempt(1);
    setCoachNotes([]);
    setError(null);
    setConfirmOpen(false);
    setTimeoutOpen(false);
    setLeaveOpen(false);
    setSimStartedAt(null);
    setBriefStep(0);
    setView('loading');
    void loadCatalog();
  }

  /**
   * W2-2 (§2.4): Lauf abbrechen — kein Credit, kein Debrief-Dokument, keine
   * Karteileiche in der Historie. Idempotent; Fehler degradieren auf backToList.
   */
  async function abortSimulation() {
    if (!simId || aborting) return;
    setAborting(true);
    try {
      await authFetch('/api/simulation/abort', {
        method: 'POST',
        body: JSON.stringify({ simId }),
      });
    } catch {
      /* Abort ist best effort — die Übersicht ist nie blockiert. */
    } finally {
      setAborting(false);
      backToList();
    }
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
    const firstName = (user?.displayName ?? '').trim().split(/\s+/)[0] || '';
    const activeSims = recent.filter((r) => r.status === 'active');
    const nonEmptyCategories = CATEGORY_ORDER.filter((c) =>
      scenarios.some((s) => s.category === c)
    );
    const visibleScenarios =
      categoryFilter === 'all'
        ? scenarios
        : scenarios.filter((s) => s.category === categoryFilter);
    const recommended = recommendScenarios(scenarios, insight?.weakestC ?? null, 3);
    const catLabel = (c: ScenarioCategory) =>
      c === 'mitarbeiterfuehrung'
        ? t.entry.catMitarbeiterfuehrung
        : c === 'zusammenarbeit'
          ? t.entry.catZusammenarbeit
          : c === 'vertrieb'
            ? t.entry.catVertrieb
            : t.entry.catStakeholder;

    const openBriefing = (s: PublicScenario) => {
      setScenario(s);
      setError(null);
      setBriefStep(0);
      setConvoLocale(s.locale ?? 'de');
      setView('briefing');
    };

    const scenarioCard = (s: PublicScenario, highlighted = false) => (
      <button
        key={s.id}
        onClick={() => openBriefing(s)}
        className={cx(
          'glass-panel rounded-2xl p-5 text-left border transition-colors flex flex-col gap-3',
          highlighted
            ? 'border-primary/40 hover:border-primary/70'
            : 'border-border hover:border-primary/40'
        )}
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
    );

    async function submitWish() {
      const text = wishText.trim();
      if (text.length < 3 || wishBusy) return;
      setWishBusy(true);
      setError(null);
      try {
        const res = await authFetch('/api/scenario-wish', {
          method: 'POST',
          body: JSON.stringify({
            wishText: text.slice(0, 500),
            category: categoryFilter === 'all' ? null : categoryFilter,
            weakestC: insight?.weakestC ?? null,
            locale,
          }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) throw new Error('wish');
        setWishDone(true);
        setWishText('');
      } catch {
        setError(ts.genericError);
        setWishOpen(false);
      } finally {
        setWishBusy(false);
      }
    }

    return (
      <AppShell title={t.entry.title}>
        {/* mx-auto: der Einstieg klebte auf breiten Bildschirmen am linken
            Rand (Test-Fund 11.08.) — Verlauf/Chat zentrieren bereits. */}
        <div className="space-y-6 max-w-6xl mx-auto">
          {errorBanner}

          {/* ── Kopf: EIN Einstieg, zwei Zuflüsse (§1) ── */}
          <section className="space-y-1.5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="text-2xl font-bold tracking-tight">
                {firstName ? t.entry.h1.replace('{name}', firstName) : t.entry.h1NoName}
              </h1>
              {/* Erklärvideo (Synthesia-Muster »Watch preview«) */}
              <ExplainerVideoButton />
            </div>
            <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
              {t.entry.sub}
            </p>
          </section>

          {/* ── Fortsetzen-Streifen: nur bei offener Simulation ── */}
          {activeSims.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t.entry.resumeTitle}
              </h2>
              <div className="space-y-2">
                {activeSims.map((r) => {
                  const s = scenarioById.get(r.scenarioId);
                  if (!s) return null;
                  const confirming = pendingDeleteId === r.id;
                  // W2-1: Restzeit im Fortsetzen-Streifen — die Zeitbox läuft
                  // ab Start in Echtzeit, auch außerhalb der Seite.
                  const remainMs =
                    new Date(r.createdAt).getTime() + s.durationMin * 60_000 - Date.now();
                  const remainMin = Math.max(0, Math.ceil(remainMs / 60_000));
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
                        <span
                          className={cx(
                            'text-xs px-2 py-0.5 rounded-full border tabular-nums',
                            remainMs > 0
                              ? 'bg-sky-500/15 text-sky-400 border-sky-500/30'
                              : 'bg-amber-500/15 text-amber-500 border-amber-500/30'
                          )}
                        >
                          {remainMs > 0
                            ? t.entry.resumeTimeLeft.replace('{min}', String(remainMin))
                            : t.entry.resumeTimeUp}
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

          {/* ── Ablage-Leiste: der zweite Zufluss, einzeilig (W1-2) ── */}
          <TranscriptDropBar />

          {/* ── Empfehlungs-Streifen (W1-4) — mit Begründung oder Cold Start ── */}
          {recommended.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" /> {t.entry.recoTitle}
              </h2>
              <p className="text-xs text-muted-foreground">
                {insight
                  ? t.entry.recoReason.replace(
                      '{c}',
                      insight.weakestName ?? insight.weakestC
                    )
                  : t.entry.coldStartFrame}
              </p>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {recommended.map((s) => scenarioCard(s, true))}
              </div>
            </section>
          )}

          {/* ── Filterzeile: Alle · nicht-leere Kategorien (W1-5) ── */}
          {nonEmptyCategories.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setCategoryFilter('all')}
                aria-pressed={categoryFilter === 'all'}
                className={cx(
                  'rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors',
                  categoryFilter === 'all'
                    ? 'border-primary/60 bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground'
                )}
              >
                {t.entry.filterAll}
              </button>
              {nonEmptyCategories.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategoryFilter(c)}
                  aria-pressed={categoryFilter === c}
                  className={cx(
                    'rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors',
                    categoryFilter === c
                      ? 'border-primary/60 bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  )}
                >
                  {catLabel(c)}
                </button>
              ))}
            </div>
          )}

          {/* ── Szenario-Raster + Geister-Karte ── */}
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleScenarios.map((s) => scenarioCard(s))}
            {/* Geister-Karte (W1-5): der Wunsch wird Nachfrage-Statistik. */}
            <button
              onClick={() => {
                setWishDone(false);
                setWishOpen(true);
              }}
              className="rounded-2xl p-5 text-left border-2 border-dashed border-border hover:border-primary/50 transition-colors flex flex-col items-start justify-center gap-2 min-h-[200px] text-muted-foreground hover:text-foreground"
            >
              <Lightbulb className="h-6 w-6 text-primary" />
              <h3 className="font-semibold leading-snug text-foreground">
                {t.entry.ghostTitle}
              </h3>
              <p className="text-sm leading-relaxed">{t.entry.ghostBody}</p>
              <span className="mt-1 text-xs font-semibold text-primary">
                {t.entry.ghostCta} →
              </span>
            </button>
          </section>

          {/* Preiszeile — EINMAL unter dem Raster, nicht je Karte (W2-4-Vorgriff). */}
          <p className="text-xs text-muted-foreground text-center">{t.entry.priceNote}</p>
        </div>

        {/* ── Wunsch-Dialog (Geister-Karte) ── */}
        {wishOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="glass-panel rounded-2xl border border-border p-6 max-w-md w-full space-y-4 bg-card">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-primary" /> {t.entry.wishTitle}
              </h3>
              {wishDone ? (
                <>
                  <p className="text-sm leading-relaxed flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                    {t.entry.wishThanks}
                  </p>
                  <div className="flex justify-end">
                    <button
                      onClick={() => setWishOpen(false)}
                      className="btn-gradient text-white font-semibold rounded-lg px-4 py-2 text-sm"
                    >
                      {t.common.close}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <textarea
                    value={wishText}
                    onChange={(e) => setWishText(e.target.value)}
                    rows={4}
                    maxLength={500}
                    placeholder={t.entry.wishPlaceholder}
                    className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => setWishOpen(false)}
                      className="rounded-lg px-4 py-2 text-sm border border-border hover:bg-muted transition-colors"
                    >
                      {t.common.cancel}
                    </button>
                    <button
                      onClick={() => void submitWish()}
                      disabled={wishBusy || wishText.trim().length < 3}
                      className="btn-gradient text-white font-semibold rounded-lg px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-50"
                    >
                      {wishBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      {t.entry.wishSend}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
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
                  {/* W2-1: ehrliche Zeitbox — die Uhr läuft ab Start in Echtzeit. */}
                  <div className="text-xs text-white/80 leading-snug">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {ts.timeboxHonest.replace('{min}', String(scenario.durationMin))}
                    </span>
                  </div>
                  {/* W2-4: Preis VOR der Entscheidung, nicht erst im Dialog. */}
                  <div className="text-[11px] text-white/65">{t.entry.priceNote}</div>
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
    // ── W2-1: sichtbare Uhr (Client-Anzeige; Server-Zeitregie bleibt Wahrheit) ──
    const limitMs = scenario.durationMin * 60_000;
    const startedMs = simStartedAt ? new Date(simStartedAt).getTime() : null;
    const elapsedMs = startedMs != null ? Math.max(0, nowTs - startedMs) : 0;
    const remainingMs = startedMs != null ? Math.max(0, limitMs - elapsedMs) : null;
    // Amber ab 80 % — deckungsgleich mit SIM_TIME_WARN_FRACTION der Turn-Route.
    const clockWarn = startedMs != null && elapsedMs >= limitMs * 0.8;
    const clockText =
      remainingMs != null
        ? `${Math.floor(remainingMs / 60_000)}:${String(Math.floor((remainingMs % 60_000) / 1000)).padStart(2, '0')}`
        : null;
    const remainingMin = remainingMs != null ? Math.ceil(remainingMs / 60_000) : null;
    /**
     * Zeit ist um — ODER die sichtbare Uhr steht auf 0:00 (Test-Fund 11.08.):
     * Das Server-Flag entsteht erst beim NÄCHSTEN Beitrag. Ohne diese Zeile
     * zeigt ein zwischenzeitlich abgelaufener Lauf eine rote 0:00 UND eine
     * offene Eingabe — der Nutzer tippt ins Leere und bekommt erst danach die
     * Verabschiedung. Der Server bleibt die Wahrheit, der Client läuft ihm
     * nur nicht mehr hinterher.
     */
    const effTimeUp = timeUp || (startedMs != null && remainingMs === 0);
    // ── W2-2: Totsackgasse — Zeit um, aber kein auswertbares Gespräch ──
    const deadEnd = effTimeUp && userTurnCount < 3;
    const b = scenario.candidateBriefing;
    return (
      <AppShell
        title={splitTitle(scenario.title).heroTitle}
        subtitle={`${ts.withLabel} ${scenario.persona.name} — ${scenario.persona.role}`}
        noPadding
        actions={
          <div className="flex items-center gap-2">
            {/* W2-3: Ausgang aus dem Chat — der Lauf bleibt offen. */}
            <button
              onClick={() => setLeaveOpen(true)}
              className="text-sm font-semibold rounded-lg px-3 py-2 border border-border text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
              title={ts.backToList}
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">{ts.backToList}</span>
            </button>
            {/* W2-1: Countdown — passiv, keine Bewertung. */}
            {clockText && (
              <span
                className={cx(
                  'text-sm font-semibold rounded-lg px-3 py-2 border tabular-nums flex items-center gap-1.5',
                  timeUp || remainingMs === 0
                    ? 'border-rose-500/40 text-rose-400 bg-rose-500/10'
                    : clockWarn
                      ? 'border-amber-500/40 text-amber-500 bg-amber-500/10'
                      : 'border-border text-muted-foreground'
                )}
                title={ts.timeboxHonest.replace('{min}', String(scenario.durationMin))}
              >
                <Clock className="h-4 w-4" /> {effTimeUp ? '0:00' : clockText}
              </span>
            )}
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
              {/* W2-4: Zähler mit Legende statt nacktem 0/3 */}
              <span className="text-[10px] tabular-nums opacity-70" title={ts.timeoutCounterLegend}>
                {coachNotes.length}/{timeoutsMax}
              </span>
            </button>
            {/* W2-3: erst ab 3 eigenen Beiträgen aktiv (Dialog verlangte es
                schon immer — jetzt sagt es auch der Button). Nach Zeitablauf
                übernimmt das Banner/Modal — kein doppelter Auswerten-Knopf. */}
            {!effTimeUp && (
              <button
                onClick={() => setConfirmOpen(true)}
                disabled={finishing || userTurnCount < 3}
                className="text-sm font-semibold rounded-lg px-3 py-2 border border-primary/40 text-primary hover:bg-primary/10 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                title={userTurnCount < 3 ? ts.finishNeedsTurns : undefined}
              >
                <Flag className="h-4 w-4" /> {ts.finishCta}
              </button>
            )}
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

          {/* W2-5: passive Ziel-Erinnerung — die drei Ziele DAUERHAFT sichtbar
              als schlanker Streifen (KEINE Häkchen, KEIN Fortschritt, KEINE
              Bewertung — Sparring-Entscheid). Mobil einklappbar, Zustand
              gemerkt. Dahinter aufklappbar: das VOLLSTÄNDIGE Briefing inkl.
              Faktenblatt (fehlte bisher im Chat, Systembericht 3.3). */}
          <div className="border-b border-border bg-muted/20">
            <div className="max-w-3xl mx-auto px-4 py-2">
              <div className="flex items-start justify-between gap-2">
                <button
                  onClick={toggleGoals}
                  className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground sm:pointer-events-none"
                  aria-expanded={goalsOpen}
                >
                  <Target className="h-3.5 w-3.5 text-primary" /> {ts.goalsStripTitle}
                  <ChevronDown
                    className={cx('h-3.5 w-3.5 transition-transform sm:hidden', goalsOpen && 'rotate-180')}
                  />
                </button>
                <button
                  onClick={() => setBriefingOpen((o) => !o)}
                  className="text-[10px] font-semibold uppercase tracking-wide text-primary flex items-center gap-1"
                >
                  <ChevronDown
                    className={cx('h-3.5 w-3.5 transition-transform', briefingOpen && 'rotate-180')}
                  />
                  {briefingOpen ? ts.briefingHide : ts.briefingShow}
                </button>
              </div>
              <ol className={cx('mt-1 space-y-0.5 text-xs leading-snug', !goalsOpen && 'hidden sm:block')}>
                {b.goals.map((g, idx) => (
                  <li key={idx} className="flex gap-1.5">
                    <span className="text-primary font-bold shrink-0">{idx + 1}.</span>
                    <span>{g}</span>
                  </li>
                ))}
              </ol>
            </div>
            {briefingOpen && (
              <div className="border-t border-border/60 px-4 py-3 max-h-80 overflow-y-auto custom-scrollbar">
                <div className="max-w-3xl mx-auto space-y-3 text-sm">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{ts.yourRole}</div>
                    <p className="leading-relaxed">{b.yourRole}</p>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{ts.relationship}</div>
                    <p className="leading-relaxed">{b.relationship}</p>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{ts.incidents}</div>
                    <ul className="space-y-1">
                      {b.incidents.map((i, idx) => (
                        <li key={idx} className="flex gap-2">
                          <span className="text-primary font-bold shrink-0">{idx + 1}.</span>
                          <span>{i}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {b.factVisuals && b.factVisuals.length > 0 ? (
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{ts.factSheet}</div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {b.factVisuals.map((v, idx) => (
                          <FactChart key={idx} v={v} />
                        ))}
                      </div>
                    </div>
                  ) : b.factSheet && b.factSheet.length > 0 ? (
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{ts.factSheet}</div>
                      <ul className="space-y-1 rounded-lg border border-border bg-muted/40 p-3">
                        {b.factSheet.map((f, idx) => (
                          <li key={idx} className="text-xs font-mono leading-relaxed">
                            {f}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {b.approachHints && b.approachHints.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{ts.stepApproach}</div>
                      <ul className="space-y-1">
                        {b.approachHints.map((h, idx) => (
                          <li key={idx} className="flex gap-2">
                            <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                            <span>{h}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {b.expectation && (
                    <div className="rounded-xl border border-accent/30 bg-accent/5 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-accent mb-1">{ts.expectationTitle}</div>
                      <p className="leading-relaxed">{b.expectation}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Nachrichten */}
          <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4">
            <div className="max-w-3xl mx-auto space-y-3">
              {/* W2-3: kein doppelter Fehlerbanner — im offenen Dialog zeigt der Dialog. */}
              {error && !confirmOpen && errorBanner}
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
            {effTimeUp && !deadEnd && (
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
            {micActive && !effTimeUp && (
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
                placeholder={effTimeUp ? ts.timeUpPlaceholder : ts.inputPlaceholder}
                disabled={effTimeUp}
                className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
              />
              {speechSupported && !effTimeUp && (
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
                disabled={sending || !input.trim() || effTimeUp}
                className="btn-gradient text-white rounded-xl p-3 shadow-neon disabled:opacity-50"
                aria-label={ts.send}
              >
                <Send className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        {/* W2-2: Totsackgasse auflösen — Zeit um, unter 3 Beiträgen: weder
            weiterreden noch auswerten. Neustart-Angebot ist Pflicht (Owner),
            keine Historien-Karteileiche (Abort statt Debrief). */}
        {deadEnd && !leaveOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="glass-panel rounded-2xl border border-amber-500/40 p-6 max-w-md w-full space-y-4 bg-card">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Clock className="h-5 w-5 text-amber-500" /> {ts.deadEndTitle}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{ts.deadEndBody}</p>
              {error && errorBanner}
              <div className="flex flex-wrap gap-2 justify-end">
                <button
                  onClick={() => void abortSimulation()}
                  disabled={aborting || starting}
                  className="rounded-lg px-4 py-2 text-sm border border-border hover:bg-muted transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {aborting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeft className="h-4 w-4" />}
                  {ts.deadEndToList}
                </button>
                <button
                  onClick={() => {
                    // Direkter Neustart: gleiches Szenario, gleicher Fokus.
                    const held = focus;
                    void (async () => {
                      if (simId) {
                        try {
                          await authFetch('/api/simulation/abort', {
                            method: 'POST',
                            body: JSON.stringify({ simId }),
                          });
                        } catch {
                          /* Abort best effort — der Neustart zählt. */
                        }
                      }
                      await startSimulation(scenario, held);
                    })();
                  }}
                  disabled={starting || aborting}
                  className="btn-gradient text-white font-semibold rounded-lg px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-50"
                >
                  {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  {ts.deadEndRestart}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* W2-3: Verlassen-Dialog — der Lauf bleibt offen, die Uhr läuft weiter. */}
        {leaveOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="glass-panel rounded-2xl border border-border p-6 max-w-md w-full space-y-4 bg-card">
              <h3 className="font-semibold text-lg">{ts.leaveTitle}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {ts.leaveBody}
                {effTimeUp ? (
                  <> {t.entry.resumeTimeUp}</>
                ) : remainingMin != null ? (
                  <> {ts.leaveTimeLeft.replace('{min}', String(remainingMin))}</>
                ) : null}
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setLeaveOpen(false)}
                  className="rounded-lg px-4 py-2 text-sm border border-border hover:bg-muted transition-colors"
                >
                  {ts.leaveStay}
                </button>
                <button
                  onClick={backToList}
                  className="btn-gradient text-white font-semibold rounded-lg px-4 py-2 text-sm flex items-center gap-2"
                >
                  <ArrowLeft className="h-4 w-4" /> {ts.leaveGo}
                </button>
              </div>
            </div>
          </div>
        )}

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

  return null;
}
