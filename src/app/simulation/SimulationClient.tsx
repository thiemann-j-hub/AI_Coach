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
  ListChecks,
  Flag,
  GraduationCap,
  MessagesSquare,
  Lightbulb,
  Loader2,
  Mic,
  Pause,
  Play,
  Radio,
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
import { aiErrorMessage } from '@/lib/api-error-text';
import { withBasePath } from '@/lib/base-path';
import { createLiveAudio, liveAudioSupported, type LiveAudio } from '@/lib/live-audio';
import { openLiveConnection, type LiveConnection } from '@/lib/live-client';
import { useAuth } from '@/providers/auth-provider';
import { useTranslation } from '@/i18n/useTranslation';
import { faehigkeit, faehigkeitText } from '@/lib/simulation/faehigkeiten';
import { AiWaitSteps } from '@/components/ui/ai-wait-steps';
import { maxEurHint } from '@/lib/pricing-display';
import type { FactVisual, PersonaVoice } from '@/lib/simulation/types';
import { recommendScenarios } from '@/lib/simulation/empfehlung';
import { decideApiFailure, type ApiFailureBody } from '@/lib/simulation/api-failure';
import { decideLiveEnd, dictationEndMessage, type LiveEndCause, type VoiceMessage } from '@/lib/simulation/live-failure';

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
  checkDurationMin?: number;
  locale?: 'de' | 'en';
  category: ScenarioCategory;
  competencyFocus?: string[];
  persona: { name: string; role: string; voice?: PersonaVoice };
  /** Welle 3: Persönlichkeits-Variante eines Grundszenarios (Porträt und Karte kommen vom Grundszenario). */
  variante?: { von: string; name: { de: string; en: string } };
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
  competencies: { key: string; label: string; weight?: number }[];
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
        <div key={i} className="pn-none min-w-[110px] flex-1 rounded-lg border border-border bg-background/40 px-3 py-2.5">
          <div className="text-xl font-bold tabular-nums leading-tight">{it.value}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{it.label}</div>
          {it.sub && <div className="text-[10px] text-muted-foreground">{it.sub}</div>}
        </div>
      ))}
    </div>
  );
}

function FactChart({ v }: { v: FactVisual }) {
  return (
    <div className="pn-tile rounded-xl border border-border bg-muted/30 p-4">
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
  /** V3: Merkkarte aus der Coaching-Bibliothek, auf der der Impuls aufbaut. */
  card?: { id: string; title: string; hint: string } | null;
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

/** O2: die eine Nachfrage beim Login — Vorsatz aus dem letzten Debrief. */
interface TransferItem {
  simId: string;
  scenarioId: string;
  scenarioTitle: string;
  personaName: string | null;
  text: string;
  dueHint: string | null;
  finishedAt: string;
}

type View = 'loading' | 'disabled' | 'list' | 'briefing' | 'chat';

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

/** Welle 4: private, selbst vorbereitete Gespräche tragen die Id-Klasse ws-mein-. */
function isMein(s: { id: string }): boolean {
  return s.id.startsWith('ws-mein-');
}

/** Welle 3: Varianten teilen das Porträt ihres Grundszenarios. */
function portraitOf(s: { id: string; variante?: { von: string } }): string {
  return s.variante?.von ?? s.id;
}

// UX-W3 (01.10., Status-Wörterbuch): Schwierigkeit ist kein Status — eine Farbe, Punkte statt Ampel.
const LEVEL_STYLES: Record<number, string> = {
  1: 'bg-primary/10 text-primary border-primary/20',
  2: 'bg-primary/10 text-primary border-primary/20',
  3: 'bg-primary/10 text-primary border-primary/20',
};
const LEVEL_DOTS: Record<number, string> = { 1: '●○○', 2: '●●○', 3: '●●●' };

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
  /**
   * Coaching-Check-in (Welle A1, Synthesia-Vergleich §7): EINE statische
   * Reflexionsfrage zwischen »Beenden« und Auswertung. Das Eingabefeld teilt
   * sich den `input`-State mit dem Chat — so diktiert das Mikrofon ohne
   * Umbau auch hier hinein. Überspringen ist gleichwertig (kein Zwang).
   */
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [attempt, setAttempt] = useState(1);
  const [focus, setFocus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ── Einstieg (COACH-UX-BLUEPRINT §1) ──
  /** Empfehlungs-Insight des Katalogs (W1-4); null = Cold Start. */
  const [insight, setInsight] = useState<EntryInsight | null>(null);
  // O2 Micro-Transfer: anstehende Nachfrage (null = keine) + Dank nach Antwort.
  const [transfer, setTransfer] = useState<TransferItem | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferThanks, setTransferThanks] = useState(false);
  /** Filterzeile: »Alle« oder eine nicht-leere Kategorie (W1-5). */
  const [categoryFilter, setCategoryFilter] = useState<'all' | ScenarioCategory>('all');
  // Welle C: Builder-Karte nur für Workspace-Admins (Rolle aus dem Profil).
  const [isWorkspaceAdmin, setIsWorkspaceAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await authFetch('/api/users/profile');
        const j = await res.json().catch(() => null);
        if (!cancelled && j?.profile?.workspaceRole === 'admin') setIsWorkspaceAdmin(true);
      } catch {
        /* ohne Rolle keine Builder-Karte — fail-soft */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  // Geister-Karte → Szenario-Wunsch (W1-5)
  const [wishOpen, setWishOpen] = useState(false);
  const [wishText, setWishText] = useState('');
  const [wishBusy, setWishBusy] = useState(false);
  const [wishDone, setWishDone] = useState(false);
  // Welle 4: „Mein echtes Gespräch vorbereiten“ — drei Sätze → privates Szenario (nur diese Person, 30 Tage).
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [vorbOpen, setVorbOpen] = useState(false);
  const [vorbAnlass, setVorbAnlass] = useState('');
  const [vorbGegen, setVorbGegen] = useState('');
  const [vorbZiel, setVorbZiel] = useState('');
  const [vorbBusy, setVorbBusy] = useState(false);
  const [vorbError, setVorbError] = useState<string | null>(null);
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
  // B2 (Welle B): Übungs- vs. Prüfungsmodus + Härtegrad — gewählt im Briefing.
  const [simMode, setSimMode] = useState<'practice' | 'check'>('practice');
  const [simHardness, setSimHardness] = useState<'mild' | 'standard' | 'hart'>('standard');
  // Mülleimer in der Simulationsliste (endgültig, inkl. DB): zweistufig.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /** Zeit-Regie: Persona hat sich verabschiedet — Eingabe zu, nur noch Auswertung. */
  const [timeUp, setTimeUp] = useState(false);
  // Welle 2: die Rolle hat das Gespräch selbst beendet (Grund in der Autorensprache, Art).
  const [personaEnded, setPersonaEnded] = useState<{ grund: string; ergebnis: string; at?: string } | null>(null);
  // Welle 2: Statuszeile im Live-Modus (Stille-Vorwarnung, Wiederverbindung).
  const [liveNotice, setLiveNotice] = useState<{ kind: 'idle' | 'reconnecting' | 'reconnected'; seconds?: number } | null>(null);
  const liveRetryRef = useRef(0);
  // Paket 1, C12 (12.11.2026): Der Neuverbinden-Timer wird gemerkt, damit „Mikro aus“ und der Abbau ihn löschen.
  const liveRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Paket 1, C11 (12.11.2026): „Das Mikrofon startet“ gilt ab dem Klick — Refs für die Logik, State für den Knopf.
  const micStartingRef = useRef(false);
  const liveStartingRef = useRef(false);
  const [micStarting, setMicStarting] = useState(false);
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
  // EU-Hosting Weg B (11.10.2026): Spracheingabe zuerst über Azure Speech (West-Europa, Token von
  // /api/speech-token), die Browser-Erkennung (Chrome: Google) nur noch als Notnagel.
  const browserSpeechSupported =
    typeof window !== 'undefined' &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const speechSupported =
    typeof window !== 'undefined' &&
    (browserSpeechSupported || Boolean(navigator.mediaDevices?.getUserMedia));
  // Owner-GO 19.09.: Persona-Antworten spricht der Server (Azure-HD, /api/tts);
  // die Browserstimme („Microsoft Hedda") ist nur noch der Notnagel bei 503/Netzfehler.
  const browserTtsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const ttsSupported = typeof window !== 'undefined' && (browserTtsSupported || 'Audio' in window);

  // Diktat/Vorlesen folgen der GEWÄHLTEN Gesprächssprache (nicht der Autorensprache).
  const speechLang = SPEECH_LANG[convoLocale];

  // Gewollt-an-Merker: Browser beenden die Erkennung nach Stille von selbst —
  // solange der Nutzer das Mikro nicht ausgeschaltet hat, starten wir neu
  // (Synthesia-Verhalten: das Mikro bleibt im Gespräch einfach an).
  const wantMicRef = useRef(false);

  // Sprachmodus Live (Owner-GO 28.10.2026, N4-231): Die Persona hört und spricht selbst (Gemini Live,
  // EU), die Mitschrift beider Seiten läuft mit. Zweiter Weg NEBEN der Kaskade: gibt es für das
  // Szenario keine Karte (Schalter COACH_LIVE aus), läuft alles wie bisher (Diktat + Azure-Stimme).
  const liveRef = useRef<{ conn: LiveConnection; audio: LiveAudio } | null>(null);
  const [liveState, setLiveState] = useState<'off' | 'connecting' | 'on'>('off');
  const [liveYou, setLiveYou] = useState('');
  const [livePersona, setLivePersona] = useState('');

  const stopLive = useCallback(() => {
    // Paket 1, C12 (12.11.2026): Ein geplanter Neuversuch startet nach „Mikro aus“ oder dem Verlassen nicht mehr.
    if (liveRetryTimerRef.current) {
      clearTimeout(liveRetryTimerRef.current);
      liveRetryTimerRef.current = null;
      setLiveNotice((n) => (n?.kind === 'reconnecting' ? null : n));
    }
    const l = liveRef.current;
    liveRef.current = null;
    if (l) {
      try {
        l.conn.end();
      } catch {
        /* schon zu */
      }
      l.audio.close();
    }
    setLiveState('off');
    setLiveYou('');
    setLivePersona('');
  }, []);

  const stopMic = useCallback(() => {
    wantMicRef.current = false;
    stopLive();
    try {
      recognitionRef.current?.stop();
    } catch {
      /* schon gestoppt */
    }
    recognitionRef.current = null;
    setMicActive(false);
  }, [stopLive]);

  /**
   * Paket 1, C1 (12.11.2026): Fehlerantwort einer Route → Satz und Verhalten. Der Aufrufer übergibt den schon
   * gelesenen Körper. Vorher wurde die Antwort hier ein zweites Mal gelesen; das scheiterte still, und es blieb
   * fast immer bei der allgemeinen Meldung. Die Entscheidung steht getestet in src/lib/simulation/api-failure.ts.
   */
  const handleApiFailure = useCallback(
    (res: Response, body: ApiFailureBody | null) => {
      const d = decideApiFailure(res.status, body, res.headers.get('retry-after'));
      // Der Kauf-Link gehört nur zur Guthaben-Meldung.
      setTopUpUrl(d.kind === 'credits' ? d.topUpUrl : null);
      switch (d.kind) {
        case 'credits':
          setError(d.text === 'member' ? t.common.balanceEmptyMember : ts[d.text]);
          break;
        case 'ai':
          // W1-1/W1-2: Du-Text je KI-Fehlerart + Fehler-Nr.
          setError(aiErrorMessage(t.aiErrors, body, res, ts.genericError) ?? ts.genericError);
          break;
        case 'kiAus':
          // A4 (31.10.2026): Das Unternehmen hat die KI ausgeschaltet — die Meldung des Servers zeigen, Mikro aus.
          setError(d.text ?? ts.genericError);
          stopMic();
          break;
        case 'server':
          setError(d.text);
          break;
        case 'wait':
          // Paket 1, C5: eigener Satz für 429.
          setError(ts.rateLimited.replace('{n}', String(d.seconds)));
          break;
        case 'timeUp':
          // Kein Fehler: die Zeit ist um — Banner statt roter Meldung.
          setTimeUp(true);
          stopMic();
          break;
        case 'ended':
          // Welle 2: die Rolle hat das Gespräch beendet — Karte statt Fehler.
          setPersonaEnded(d.ende);
          stopMic();
          break;
        case 'text':
          setError(ts[d.key]);
          break;
      }
    },
    [t, ts, stopMic]
  );

  /** Paket 1, C10 (12.11.2026): der Satz, warum das Mikrofon aus ist. */
  const voiceText = useCallback(
    (m: VoiceMessage): string =>
      m.type === 'server'
        ? m.text
        : m.type === 'ai'
          ? aiErrorMessage(t.aiErrors, { aiCode: m.aiCode }, null, ts.genericError) ?? ts.genericError
          : ts[m.key],
    [t, ts]
  );

  /**
   * Azure-Diktat (EU): Token holen, SDK laden, erkennen. false NUR, wenn der Server die Browser-Erkennung ausdrücklich
   * wählt (Rückweg SPEECH_INPUT=browser → mode "browser"). 01.11.2026 (Bewertung Teil 1, Owner-Ja): Bei jedem anderen
   * Fehler (502/503/429/Netz) kein Browser-Notnagel mehr — Chrome schickte die Aufnahme an Google, das deckt die
   * Einwilligung nicht; stattdessen „nicht erreichbar“, Mikro aus, Tippen geht weiter.
   */
  const startAzureMic = useCallback(async (): Promise<boolean> => {
    const micAus = () => { setMicActive(false); wantMicRef.current = false; return true; };
    const ausfall = () => { setError(ts.unavailable); return micAus(); };
    try {
      const res = await authFetch('/api/speech-token');
      // Paket 1, C1 (12.11.2026): den Körper genau einmal lesen.
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; token?: string; region?: string; code?: string; url?: string; error?: string; mode?: string };
      if (res.status === 403) {
        // Stufe C / W5-4 (20.10.2026): Einwilligung „Sprachaufnahme“ fehlt → Hinweis statt Browser-Notnagel.
        if (j.code === 'EINWILLIGUNG') { setConsentUrl(j.url || '/einwilligung?typ=sprachaufnahme'); return micAus(); }
        // A4 (31.10.2026): KI für das Unternehmen aus → Meldung des Servers statt Browser-Notnagel.
        if (j.code === 'KI_AUS') { setError(j.error || ts.genericError); return micAus(); }
      }
      if (!res.ok) {
        if (j.mode === 'browser') return false;
        // Paket 1, C5: Limit erreicht → der Warte-Satz statt „nicht erreichbar“.
        if (res.status === 429) { handleApiFailure(res, j); return micAus(); }
        return ausfall();
      }
      if (!j.ok || !j.token || !j.region) return ausfall();
      const { startAzureDictation } = await import('@/lib/azure-stt');
      // Paket 1, C12: inzwischen ausgeschaltet oder die Seite verlassen → kein Mikrofon mehr öffnen.
      if (!wantMicRef.current) return true;
      const d = startAzureDictation({
        token: j.token,
        region: j.region,
        lang: speechLang,
        onText: (text) => setInput((prev) => (prev ? prev.replace(/\s+$/, '') + ' ' : '') + text),
        // Paket 1, C26: Das Token gilt rund zehn Minuten — die laufende Erkennung holt rechtzeitig ein frisches.
        refreshToken: async () => {
          const r = await authFetch('/api/speech-token');
          const x = (await r.json().catch(() => null)) as { ok?: boolean; token?: string } | null;
          return r.ok && x?.ok && x.token ? x.token : null;
        },
        onEnd: (error) => {
          if (recognitionRef.current === d) recognitionRef.current = null;
          // Paket 1, C26: Bricht das Diktat ab, steht der Grund da (nicht, wenn die Person selbst ausschaltet).
          const grund = dictationEndMessage(error, !wantMicRef.current);
          if (grund) setError(voiceText(grund));
          setMicActive(false);
          wantMicRef.current = false;
        },
      });
      recognitionRef.current = d;
      setMicActive(true);
      return true;
    } catch {
      return ausfall();
    }
  }, [speechLang, ts.genericError, ts.unavailable, handleApiFailure, voiceText]);

  /**
   * Sprachmodus Live: Karte holen, Verbindung öffnen, Mikrofon streamen. false = für dieses Szenario
   * aus (404 LIVE_OFF) oder nicht konfiguriert (503) → der Aufrufer nimmt die Kaskade wie bisher.
   * true = Live läuft oder baut sich auf — oder der Grund steht schon da (Einwilligung fehlt, KI aus, Lauf zu, Limit).
   */
  const startLiveMic = useCallback(async (): Promise<boolean> => {
    if (!simId || !liveAudioSupported()) return false;
    // Paket 1, C11 (12.11.2026): Die Sperre gilt ab dem Klick, nicht erst nach dem Ticket-Abruf. Läuft schon ein
    // Aufbau oder eine Verbindung, gibt es keine zweite und kein Diktat daneben.
    if (liveRef.current || liveStartingRef.current) return true;
    liveStartingRef.current = true;
    const micAus = () => {
      setMicActive(false);
      wantMicRef.current = false;
      return true;
    };
    let karte: { ticket: string; path: string } | null = null;
    try {
      const res = await authFetch('/api/simulation/live/ticket', {
        method: 'POST',
        body: JSON.stringify({ simId }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; ticket?: string; path?: string; code?: string; url?: string; error?: string };
      if (res.status === 403 && j.code === 'EINWILLIGUNG') {
        setConsentUrl(j.url || '/einwilligung?typ=sprachaufnahme');
        return micAus();
      }
      // A4 (31.10.2026): KI für das Unternehmen aus → Meldung, keine Kaskade (Diktat und Stimme sind ebenfalls KI).
      if (res.status === 403 && j.code === 'KI_AUS') {
        setError(j.error || ts.genericError);
        return micAus();
      }
      // Paket 1, C10: Der Lauf ist zu (Zeit um, Zuggrenze, Szenario fehlt) oder ein Limit greift → der passende
      // Satz oder das Banner, kein stilles Diktat stattdessen.
      if (res.status === 409 || res.status === 410 || res.status === 429) {
        handleApiFailure(res, j);
        return micAus();
      }
      if (!res.ok || !j.ok || !j.ticket || !j.path) return false;
      karte = { ticket: j.ticket, path: j.path };
    } catch {
      return false;
    } finally {
      // Ab hier läuft alles ohne Warten bis `liveRef.current` gesetzt ist — die Sperre geht nahtlos über.
      liveStartingRef.current = false;
    }
    // Paket 1, C12: inzwischen ausgeschaltet oder die Seite verlassen → keine Verbindung mehr öffnen.
    if (!wantMicRef.current) return true;
    setLiveState('connecting');
    setLiveYou('');
    setLivePersona('');
    setError(null);
    // Paket 1, C10: der erste Grund, den diese Verbindung für ihr Ende nennt (Mikrofon, Fehler, Abschied).
    let cause: LiveEndCause | null = null;
    const audio = createLiveAudio();
    const conn = openLiveConnection(karte.path, karte.ticket, {
      onReady: () => {
        void audio
          .startMic((pcm) => conn.sendAudio(pcm))
          .then(() => {
            if (liveRef.current?.conn !== conn) {
              // Paket 1, C11: verwaiste Verbindung → ihr Mikrofon freigeben und sie schließen.
              audio.close();
              conn.close();
              return;
            }
            setLiveState('on');
            setMicActive(true);
            if (liveRetryRef.current > 0) {
              // Wieder da nach einem Abriss: kurz melden, dann Zähler zurück.
              setLiveNotice({ kind: 'reconnected' });
              setTimeout(() => setLiveNotice((n) => (n?.kind === 'reconnected' ? null : n)), 3000);
              liveRetryRef.current = 0;
            }
          })
          .catch((e: unknown) => {
            // Paket 1, C10: Ein verweigertes oder nicht startbares Mikrofon ist kein Abriss. Verbindung zu,
            // der Satz folgt in onClose, es wird nicht neu verbunden.
            if (!cause) cause = { art: 'mic', error: e };
            conn.end();
          });
      },
      onYou: (text) => {
        setLiveYou(text);
        setLiveNotice((n) => (n?.kind === 'idle' ? null : n));
      },
      onEnded: (p) => setPersonaEnded({ grund: p.grund, ergebnis: p.ergebnis }),
      onIdleWarn: (seconds) => setLiveNotice({ kind: 'idle', seconds }),
      onPersona: (text) => setLivePersona(text),
      onInterrupted: () => audio.interrupt(),
      onAudio: (pcm) => audio.play(pcm),
      onTurn: (turn) => {
        const at = new Date().toISOString();
        setTurns((prev) => [
          ...prev,
          ...(turn.user ? [{ role: 'user' as const, text: turn.user, ts: at }] : []),
          ...(turn.persona ? [{ role: 'persona' as const, text: turn.persona, ts: at }] : []),
        ]);
        setLiveYou('');
        setLivePersona('');
        if (turn.timeUp) setTimeUp(true);
        if (turn.ended) setPersonaEnded((cur) => cur ?? { grund: '', ergebnis: 'verabschiedung' });
      },
      // Paket 1, C10: Fehler und Abschied merken; was daraus folgt, entscheidet onClose für alle Gründe an einer Stelle.
      onError: (code, message) => {
        if (!cause) cause = { art: 'error', code, message };
      },
      onBye: (reason) => {
        if (!cause) cause = { art: 'bye', reason };
      },
      onClose: (wsCode) => {
        if (liveRef.current?.conn !== conn) {
          // Schon über stopMic abgeräumt oder verwaist (Paket 1, C11): das Mikrofon dieser Verbindung freigeben.
          audio.close();
          return;
        }
        liveRef.current = null;
        audio.finish(); // die letzte Antwort (z. B. die Verabschiedung) noch zu Ende spielen
        setLiveState('off');
        setLiveYou('');
        setLivePersona('');
        setMicActive(false);
        // Paket 1, C10: je Grund ein Satz oder ein Banner (src/lib/simulation/live-failure.ts). Neu verbunden wird
        // nur beim Abriss ohne Grund (Netz, Schlaf), einmal und nur, solange das Mikro gewollt ist.
        const d = decideLiveEnd(cause ?? { art: 'close', wsCode }, liveRetryRef.current >= 1);
        if (d.banner === 'timeUp') setTimeUp(true);
        if (d.banner === 'ended') setPersonaEnded((cur) => cur ?? { grund: '', ergebnis: 'verabschiedung' });
        if (d.reconnect && wantMicRef.current) {
          liveRetryRef.current += 1;
          setLiveNotice({ kind: 'reconnecting' });
          // Paket 1, C12: Timer merken (stopLive löscht ihn) und vor dem Neustart prüfen, ob das Mikro noch gewollt ist.
          liveRetryTimerRef.current = setTimeout(() => {
            liveRetryTimerRef.current = null;
            if (!wantMicRef.current) {
              setLiveNotice(null);
              return;
            }
            void startLiveMic().then((ok) => {
              if (liveRef.current) return; // die neue Verbindung baut sich auf
              setLiveNotice(null);
              if (!ok) {
                wantMicRef.current = false;
                setError(ts.voiceLost);
              }
            });
          }, 1000);
          return;
        }
        wantMicRef.current = false;
        setLiveNotice(null);
        if (d.message) setError(voiceText(d.message));
      },
    });
    liveRef.current = { conn, audio };
    return true;
  }, [simId, ts.genericError, ts.voiceLost, handleApiFailure, voiceText]);

  // CP-3.4 (M21 Option 1, Compliance-Blueprint 31.08.): Aufklärung vor der
  // ERSTEN Mikrofon-Nutzung je Gerät. Die Browser-Spracherkennung überträgt
  // die Aufnahme an den Browser-Hersteller (Chrome: Google) — vom Arbeitsplatz
  // aus, außerhalb unserer Auftragsverarbeitung. Das Modal macht den Datenfluss
  // transparent; die Bestätigung landet in localStorage (try/catch, Vorgabe
  // Browser-Storage). Funktionsumfang des Mikros unverändert.
  const MIC_ACK_KEY = "pn-mic-notice-ack";
  const [micNoticeOpen, setMicNoticeOpen] = useState(false);
  // W5-4: Link zur Einwilligungs-Seite im Hub, wenn das Unternehmen die Zustimmung „Sprachaufnahme“ verlangt.
  const [consentUrl, setConsentUrl] = useState<string | null>(null);
  // Sitzungs-Fallback, falls localStorage blockiert ist (Privatmodus): die
  // Bestätigung gilt dann für die laufende Sitzung, ohne Endlos-Modal.
  const micAckRef = useRef(false);

  /** Diktat: erkannter Text wird ans Eingabefeld ANGEHÄNGT (nichts überschreiben). */
  const startMic = useCallback(() => {
    // Paket 1, C11 (12.11.2026): Läuft schon ein Start, eine Live-Verbindung oder ein Neuversuch, tut ein zweiter Klick nichts.
    if (!speechSupported || micActive || micStartingRef.current || liveStartingRef.current || liveRef.current || liveRetryTimerRef.current) return;
    if (!micAckRef.current) {
      let acked = false;
      try {
        acked = localStorage.getItem(MIC_ACK_KEY) === "1";
      } catch {
        acked = false;
      }
      if (!acked) {
        setMicNoticeOpen(true);
        return;
      }
      micAckRef.current = true;
    }
    wantMicRef.current = true;
    liveRetryRef.current = 0;
    micStartingRef.current = true;
    setMicStarting(true);
    // Sprich-Modus: wer ins Mikro spricht, bekommt die Antwort auch zu hören.
    if (ttsSupported) setSpeakReplies(true);
    void (async () => {
      try {
        // Reihenfolge: Live (wenn für das Szenario an) → Azure-Diktat → Browser-Notnagel.
        if (await startLiveMic()) return;
        if (!wantMicRef.current) return;
        if (await startAzureMic()) return;
        if (!wantMicRef.current) return;
        if (!browserSpeechSupported) {
          wantMicRef.current = false;
          setMicActive(false);
          setError(ts.unavailable);
          return;
        }
        startBrowserMic();
      } finally {
        micStartingRef.current = false;
        setMicStarting(false);
      }
    })();
  }, [speechSupported, micActive, ttsSupported, startLiveMic, startAzureMic, browserSpeechSupported, startBrowserMic, ts.unavailable]);

  /**
   * Check-in nach dem Gespräch (Owner-Befund 01.11.2026): hier wird nur diktiert, nie das Live-Gespräch gestartet —
   * sonst verband sich die Rolle erneut und sprach weiter („Auf Wiederhören“), während die Person ihre Einschätzung
   * einsprechen wollte. Reihenfolge: Azure-Diktat → Browser-Notnagel.
   */
  const startDictation = useCallback(() => {
    if (!speechSupported || micActive || micStartingRef.current) return;
    if (!micAckRef.current) {
      let acked = false;
      try {
        acked = localStorage.getItem(MIC_ACK_KEY) === "1";
      } catch {
        acked = false;
      }
      if (!acked) {
        setMicNoticeOpen(true);
        return;
      }
      micAckRef.current = true;
    }
    wantMicRef.current = true;
    micStartingRef.current = true;
    setMicStarting(true);
    void (async () => {
      try {
        if (await startAzureMic()) return;
        if (!wantMicRef.current) return;
        if (!browserSpeechSupported) {
          wantMicRef.current = false;
          setMicActive(false);
          setError(ts.unavailable);
          return;
        }
        startBrowserMic();
      } finally {
        micStartingRef.current = false;
        setMicStarting(false);
      }
    })();
  }, [speechSupported, micActive, startAzureMic, browserSpeechSupported, ts.unavailable]);

  /** Browser-Spracherkennung (Chrome: Google) — nur, wenn der Server sie ausdrücklich wählt (Rückweg SPEECH_INPUT=browser). */
  function startBrowserMic() {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onerror = (e: any) => {
      // Paket 1, C10 (12.11.2026): Auch hier steht der Grund da, wenn das Mikrofon ausgeht.
      const grund = dictationEndMessage(typeof e?.error === 'string' ? e.error : undefined, !wantMicRef.current);
      if (grund) setError(voiceText(grund));
      wantMicRef.current = false;
      setMicActive(false);
    };
    recognitionRef.current = rec;
    setMicActive(true);
    rec.start();
  }

  /** Laufende Sprachausgabe (Azure-Audio UND Browserstimme) stoppen. */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopSpeaking = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      if (a.src.startsWith('blob:')) URL.revokeObjectURL(a.src);
      a.removeAttribute('src');
      audioRef.current = null;
    }
    if (browserTtsSupported) window.speechSynthesis.cancel();
  }, [browserTtsSupported]);

  /** Notnagel: Browserstimme (erste Stimme der Gesprächssprache). */
  const speakBrowser = useCallback(
    (text: string) => {
      if (!browserTtsSupported) return;
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
    [browserTtsSupported, speechLang]
  );

  /**
   * Persona-Antwort vorlesen — Azure-HD-Stimme der Persona (Server), Browserstimme
   * nur wenn der Server nicht kann (503 nicht konfiguriert, Netz, Autoplay-Sperre).
   */
  const speak = useCallback(
    async (text: string) => {
      if (!ttsSupported) return;
      stopSpeaking();
      try {
        const res = await authFetch('/api/tts', {
          method: 'POST',
          body: JSON.stringify({ text, voice: scenario?.persona.voice, locale: convoLocale }),
        });
        if (res.status === 403) {
          // A4 (31.10.2026): KI für das Unternehmen aus → keine Ersatzstimme des Browsers, sondern die Meldung.
          const j = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
          if (j.code === 'KI_AUS') {
            setError(j.error || ts.genericError);
            return;
          }
        }
        if (!res.ok) throw new Error(`tts ${res.status}`);
        const url = URL.createObjectURL(await res.blob());
        const a = new Audio(url);
        audioRef.current = a;
        a.onended = () => {
          URL.revokeObjectURL(url);
          if (audioRef.current === a) audioRef.current = null;
        };
        await a.play();
      } catch {
        speakBrowser(text);
      }
    },
    [ttsSupported, stopSpeaking, speakBrowser, scenario, convoLocale, ts.genericError]
  );

  // Aufraeumen: beim Verlassen des Chats Mikro und Vorlesen stoppen.
  useEffect(() => {
    if (view !== 'chat') {
      stopMic();
      stopSpeaking();
    }
  }, [view, stopMic, stopSpeaking]);
  // Paket 1, C12 (12.11.2026): Beim Abbau der Seite alles freigeben — Live-Verbindung, Diktat, Neuverbinden-Timer
  // und Sprachausgabe. Vorher endete nur die Live-Verbindung; ein laufendes Diktat hielt das Mikrofon offen.
  useEffect(
    () => () => {
      stopMic();
      stopSpeaking();
    },
    [stopMic, stopSpeaking]
  );

  // W2-1: Uhr tickt nur im Chat (1 s Auflösung genügt für mm:ss).
  // U11 (Paket 1, 12.11.2026): Hat die Rolle das Gespräch beendet, bleibt die Uhr stehen.
  useEffect(() => {
    if (view !== 'chat' || !simStartedAt || timeUp || personaEnded) return;
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [view, simStartedAt, timeUp, personaEnded]);
  // U11: Sie zeigt den Stand beim Ende (Zeitpunkt vom Server, sonst jetzt).
  useEffect(() => {
    if (!personaEnded) return;
    const at = personaEnded.at ? Date.parse(personaEnded.at) : NaN;
    setNowTs(Number.isFinite(at) ? at : Date.now());
  }, [personaEnded]);

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
      `${LEVEL_DOTS[d]} ${ts.levelPrefix} ${d} · ${d === 1 ? ts.level1 : d === 2 ? ts.level2 : ts.level3}`,
    [ts]
  );

  const loadCatalog = useCallback(async () => {
    try {
      const res = await authFetch('/api/simulation/scenarios');
      if (res.status === 503) {
        // 503 heißt hier zweierlei: Simulation nicht freigeschaltet — oder (PulseNorth-
        // Konto, 02.10.2026) das Register gibt gerade keine Auskunft. Das zweite ist eine
        // Störung: Meldung „nicht erreichbar" statt „noch nicht freigeschaltet".
        const refusal = await res.clone().json().catch(() => null);
        if (refusal?.code === 'CENTRAL_UNAVAILABLE') {
          setError(ts.unavailable);
          setView('list');
          return;
        }
        setView('disabled');
        return;
      }
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error('catalog');
      setScenarios(json.scenarios ?? []);
      setRecent(json.recent ?? []);
      setInsight(json.insight ?? null);
      setView('list');
      // O2: die eine Nachfrage — best effort, blockiert den Einstieg nie.
      try {
        const tr = await authFetch('/api/simulation/transfer-check');
        const tj = await tr.json().catch(() => null);
        if (tr.ok && tj?.ok && tj.item?.simId) setTransfer(tj.item as TransferItem);
      } catch {
        /* keine Nachfrage */
      }
    } catch {
      setError(ts.genericError);
      setView('list');
    }
  }, [ts]);

  async function answerTransfer(outcome: 'done' | 'partly' | 'not' | 'dismissed') {
    if (!transfer || transferBusy) return;
    setTransferBusy(true);
    try {
      await authFetch('/api/simulation/transfer-check', {
        method: 'POST',
        body: JSON.stringify({ simId: transfer.simId, outcome }),
      });
    } catch {
      /* Angebot, kein Blocker */
    } finally {
      setTransferBusy(false);
      setTransfer(null);
      if (outcome !== 'dismissed') {
        setTransferThanks(true);
        window.setTimeout(() => setTransferThanks(false), 6000);
      }
    }
  }

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

  // U20 (Paket 1, 12.11.2026): „Fortsetzen“ im Verlauf führt per /?simId=<id> direkt ins laufende Gespräch.
  // Vorher landete man auf der Startseite und musste die Fortsetzen-Zeile noch einmal anklicken.
  const resumeLinkRef = useRef<string | null>(null);
  useEffect(() => {
    if (view !== 'list') return;
    const wanted = searchParams.get('simId');
    if (!wanted || !/^[A-Za-z0-9-]{8,64}$/.test(wanted) || resumeLinkRef.current === wanted) return;
    resumeLinkRef.current = wanted;
    // Query-Parameter verbrauchen — Reload soll wieder am Einstieg landen (wie bei ?szenario=).
    router.replace('/', { scroll: false });
    setView('loading');
    void resumeSimulation({ id: wanted }).then((ok) => {
      if (!ok) setView('list');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, sending]);

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
        handleApiFailure(res, json);
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
          mode: simMode,
          hardness: simHardness,
          ...(focusToSend ? { focus: focusToSend } : {}),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        handleApiFailure(res, json);
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
      setTimeUp(false); setPersonaEnded(null); setLiveNotice(null);
      setView('chat');
    } catch {
      setError(ts.genericError);
    } finally {
      setStarting(false);
    }
  }

  /**
   * Offenen Lauf fortsetzen. U20 (Paket 1, 12.11.2026): auch per Adresse /?simId=… aus dem Verlauf — dann ist nur
   * die Kennung bekannt, Szenario und Startzeit bringt die Antwort mit. true = Gespräch oder Auswertung geöffnet.
   */
  async function resumeSimulation(item: Pick<RecentSim, 'id'> & Partial<RecentSim>): Promise<boolean> {
    // Fertige Auswertungen haben eine eigene Adresse (W1-7).
    if (item.status === 'finished') {
      router.push(`/simulation/${encodeURIComponent(item.id)}`);
      return true;
    }
    setError(null);
    try {
      const res = await authFetch(`/api/simulation/get?simId=${encodeURIComponent(item.id)}`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        handleApiFailure(res, json);
        return false;
      }
      if (json.simulation.status === 'finished') {
        router.push(`/simulation/${encodeURIComponent(item.id)}`);
        return true;
      }
      // Abgebrochene Läufe (z. B. über eine alte Adresse) werden nicht wieder geöffnet.
      if (json.simulation.status !== 'active') {
        setError(ts.genericError);
        return false;
      }
      const s = scenarioById.get(json.simulation.scenarioId) ?? (json.scenario as PublicScenario | null);
      if (!s) {
        setError(ts.scenarioGone);
        return false;
      }
      setScenario(s);
      setSimId(json.simulation.id);
      setTurns(json.simulation.turns);
      setAttempt(json.simulation.attempt ?? 1);
      setFocus(json.simulation.focus ?? null);
      setSimStartedAt(json.simulation.createdAt ?? item.createdAt ?? null);
      setCoachNotes(json.simulation.coachNotes ?? []);
      setConvoLocale(json.simulation.convoLocale ?? s.locale ?? 'de');
      setSimMode(json.simulation.mode ?? 'practice');
      setSimHardness(json.simulation.hardness ?? 'standard');
      setTimeUp(json.simulation.timeUp === true);
      setPersonaEnded(json.simulation.ende ?? null);
      setBriefingOpen(false);
      setView('chat');
      return true;
    } catch {
      setError(ts.genericError);
      return false;
    }
  }

  async function sendTurn() {
    const message = input.trim();
    // Im Live-Gespräch geht nichts über den Textweg — das Live-Modell hört nur, was gesprochen wird.
    if (!message || !simId || sending || liveState !== 'off') return;
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
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setTurns((prev) => prev.filter((x) => x !== optimistic));
        setInput(message);
        handleApiFailure(res, json);
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
      // Welle 2: die Rolle hat das Gespräch mit dieser Antwort beendet.
      if (json.ende) {
        setPersonaEnded(json.ende);
        stopMic();
      }
      if (speakReplies) void speak(json.reply);
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
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        handleApiFailure(res, json);
        return;
      }
      setCoachNotes((prev) => [
        ...prev,
        {
          question: timeoutQuestion.trim(),
          answer: json.tip,
          ts: new Date().toISOString(),
          card: json.card ?? null,
        },
      ]);
      setTimeoutsMax(json.timeoutsMax ?? 3);
      setTimeoutQuestion('');
    } catch {
      setError(ts.genericError);
    } finally {
      setTimeoutBusy(false);
    }
  }

  async function finishSimulation(selfAssessment?: string) {
    if (!simId || finishing) return;
    stopMic();
    setFinishing(true);
    setError(null);
    try {
      const trimmed = (selfAssessment ?? '').trim().slice(0, 600);
      const res = await authFetch('/api/simulation/finish', {
        method: 'POST',
        body: JSON.stringify({ simId, ...(trimmed ? { selfAssessment: trimmed } : {}) }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        handleApiFailure(res, json);
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
    setSimMode('practice');
    setSimHardness('standard');
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
    <div className="pn-none glass-panel rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 flex items-start gap-2 text-sm">
      <AlertTriangle className="h-4 w-4 text-rose-800 dark:text-rose-400 mt-0.5 shrink-0" />
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
        <div className="pn-none glass-panel rounded-xl p-6 max-w-xl text-sm text-muted-foreground">
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
    // Welle 3: Varianten stehen nicht als eigene Karten im Raster, sondern als Auswahl an ihrer Grundkarte.
    const grundszenarien = scenarios.filter((s) => !s.variante && !isMein(s));
    const meine = scenarios.filter(isMein);
    const variantenVon = new Map<string, PublicScenario[]>();
    for (const s of scenarios) {
      if (!s.variante) continue;
      variantenVon.set(s.variante.von, [...(variantenVon.get(s.variante.von) ?? []), s]);
    }
    const visibleScenarios =
      categoryFilter === 'all'
        ? grundszenarien
        : grundszenarien.filter((s) => s.category === categoryFilter);
    const recommended = recommendScenarios(grundszenarien, insight?.weakestC ?? null, 3);
    const catLabel = (c: ScenarioCategory) =>
      c === 'mitarbeiterfuehrung'
        ? t.entry.catMitarbeiterfuehrung
        : c === 'zusammenarbeit'
          ? t.entry.catZusammenarbeit
          : c === 'vertrieb'
            ? t.entry.catVertrieb
            : t.entry.catStakeholder;

    const openBriefing = (s: PublicScenario) => {
      setHeroImgFailed(false);
      setScenario(s);
      setError(null);
      setBriefStep(0);
      setConvoLocale(s.locale ?? 'de');
      setView('briefing');
    };

    const scenarioCard = (s: PublicScenario, highlighted = false) => (
      <div key={s.id} className="flex flex-col gap-2 min-w-0">
      <button
        onClick={() => openBriefing(s)}
        className={cx(
          'pn-tile glass-panel rounded-2xl p-5 text-left border transition-colors flex flex-col gap-3',
          highlighted
            ? 'border-primary/40'
            : 'border-border'
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
          <PersonaAvatar name={s.persona.name} scenarioId={portraitOf(s)} size="sm" />
          <div className="text-xs text-muted-foreground min-w-0">
            <div className="font-medium text-foreground truncate">{s.persona.name}</div>
            <div className="truncate">{s.persona.role}</div>
          </div>
        </div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {s.locale === 'en' ? ts.englishOnly : ts.germanOnly}
        </div>
      </button>
      {/* Welle 3: Persönlichkeits-Varianten — dieselbe Lage, ein anderes Gegenüber. */}
      {(variantenVon.get(s.id) ?? []).length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-1 text-xs text-muted-foreground" data-testid="varianten">
          <span>{t.entry.variantsAlso}</span>
          {(variantenVon.get(s.id) ?? []).map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => openBriefing(v)}
              className="pn-none rounded-full border border-border px-2.5 py-0.5 font-medium text-foreground hover:border-primary/60 hover:text-primary transition-colors"
            >
              {locale === 'de' ? v.variante!.name.de : v.variante!.name.en}
            </button>
          ))}
        </div>
      )}
      </div>
    );

    async function submitVorbereiten() {
      if (vorbBusy || vorbAnlass.trim().length < 20 || vorbGegen.trim().length < 20) return;
      setVorbBusy(true);
      setVorbError(null);
      try {
        const res = await authFetch('/api/simulation/vorbereiten', {
          method: 'POST',
          body: JSON.stringify({
            anlass: vorbAnlass.trim().slice(0, 1200),
            gegenueber: vorbGegen.trim().slice(0, 1200),
            ...(vorbZiel.trim() ? { ziel: vorbZiel.trim().slice(0, 600) } : {}),
            locale: locale === 'en' ? 'en' : 'de',
          }),
        });
        const json = await res.json().catch(() => null);
        if (res.status === 409 && json?.code === 'PRIVATE_LIMIT') {
          setVorbError(t.entry.prepLimit);
          return;
        }
        if (!res.ok || !json?.ok || !json.scenario) {
          setVorbOpen(false);
          handleApiFailure(res, json);
          return;
        }
        window.dispatchEvent(new Event(CREDITS_REFRESH_EVENT));
        const s = json.scenario as PublicScenario;
        setScenarios((prev) => [...prev.filter((x) => x.id !== s.id), s]);
        setVorbOpen(false);
        setVorbAnlass('');
        setVorbGegen('');
        setVorbZiel('');
        openBriefing(s);
      } catch {
        setVorbError(ts.genericError);
      } finally {
        setVorbBusy(false);
      }
    }

    async function removeVorbereitet(id: string) {
      try {
        const res = await authFetch('/api/simulation/vorbereiten', { method: 'DELETE', body: JSON.stringify({ id }) });
        if (res.ok) setScenarios((prev) => prev.filter((x) => x.id !== id));
      } catch {
        /* fail-soft: Karte bleibt bis zum nächsten Laden */
      }
    }

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

          {/* ── O2: die eine Nachfrage zum Vorsatz (Gemini Zu 4 / Owner E-4: nur beim Login) ── */}
          {transfer && (
            <section
              className="pn-none glass-panel rounded-xl p-4 border border-primary/30 bg-primary/5 space-y-3"
              data-testid="transfer-check"
            >
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold uppercase tracking-wide text-primary">
                    {t.entry.transferTitle}
                  </div>
                  <p className="text-sm mt-1 leading-snug">»{transfer.text}«</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {transfer.scenarioTitle} · {new Date(transfer.finishedAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void answerTransfer('dismissed')}
                  className="text-muted-foreground hover:text-foreground"
                  title={t.entry.transferDismiss}
                  aria-label={t.entry.transferDismiss}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-12">
                <span className="text-sm font-medium mr-1">{t.entry.transferQuestion}</span>
                {(['done', 'partly', 'not'] as const).map((o) => (
                  <button
                    key={o}
                    type="button"
                    disabled={transferBusy}
                    onClick={() => void answerTransfer(o)}
                    className="pn-none rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    {o === 'done' ? t.entry.transferDone : o === 'partly' ? t.entry.transferPartly : t.entry.transferNot}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => void answerTransfer('dismissed')}
                  className="text-xs text-muted-foreground underline ml-1"
                >
                  {t.entry.transferDismiss}
                </button>
              </div>
            </section>
          )}
          {transferThanks && (
            <p className="text-xs text-muted-foreground" data-testid="transfer-thanks">
              {t.entry.transferThanks}
            </p>
          )}

          {/* UX-W4 (01.10., Preis vor dem Klick): Kostenhinweis oben, nicht erst nach dem Katalog. */}
          <p className="text-xs text-muted-foreground" data-testid="start-cost-note-top">
            {ts.startCostNote.replace('{eur}', maxEurHint(t.common.maxEurHint, locale))}
          </p>

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
                      className="pn-tile w-full glass-panel rounded-xl p-3 flex items-center justify-between gap-3 border border-border transition-colors"
                    >
                      <button
                        onClick={() => void resumeSimulation(r)}
                        className="flex items-center gap-3 min-w-0 flex-1 text-left"
                      >
                        <PersonaAvatar name={s.persona.name} scenarioId={portraitOf(s)} size="sm" />
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
                              ? 'bg-sky-500/15 text-sky-800 dark:text-sky-400 border-sky-500/30'
                              : 'bg-amber-500/15 text-amber-800 dark:text-amber-500 border-amber-500/30'
                          )}
                        >
                          {remainMs > 0
                            ? t.entry.resumeTimeLeft.replace('{min}', String(remainMin))
                            : t.entry.resumeTimeUp}
                        </span>
                        {/* Mülleimer mit zweistufiger Bestätigung (endgültig, inkl. DB) */}
                        {confirming ? (
                          <span className="flex items-center gap-1.5">
                            <span className="text-xs text-rose-800 dark:text-rose-400 font-medium hidden sm:inline">
                              {ts.deleteConfirm}
                            </span>
                            <button
                              onClick={() => void deleteSim(r.id)}
                              disabled={deletingId === r.id}
                              title={ts.deleteSim}
                              aria-label={ts.deleteSim}
                              className="pn-none rounded-lg border border-rose-500/50 bg-rose-500/15 p-1.5 text-rose-800 dark:text-rose-400 transition-colors hover:bg-rose-500/25 disabled:opacity-50"
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
                              className="pn-none rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setPendingDeleteId(r.id)}
                            title={ts.deleteSim}
                            aria-label={ts.deleteSim}
                            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-800 dark:hover:text-rose-400"
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

          {/* ── Welle 4: eigene vorbereitete Gespräche (privat, 30 Tage) ── */}
          {meine.length > 0 && (
            <section className="space-y-2" data-testid="meine-gespraeche">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <MessagesSquare className="h-3.5 w-3.5 text-primary" /> {t.entry.prepMineTitle}
              </h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {meine.map((s) => (
                  <div key={s.id} className="flex flex-col gap-1.5 min-w-0">
                    {scenarioCard(s, true)}
                    <button
                      type="button"
                      onClick={() => void removeVorbereitet(s.id)}
                      className="self-end text-xs text-muted-foreground underline hover:text-foreground"
                    >
                      {t.entry.prepRemove}
                    </button>
                  </div>
                ))}
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
                  'pn-none rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors',
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
                    'pn-none rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors',
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
            {/* Welle 4: „Mein echtes Gespräch vorbereiten“ — für alle, privat. */}
            <button
              onClick={() => {
                setVorbError(null);
                setVorbOpen(true);
              }}
              data-testid="prep-card"
              className="pn-none rounded-2xl p-5 text-left border-2 border-dashed border-primary/40 hover:border-primary transition-colors flex flex-col items-start justify-center gap-2 min-h-[200px] text-muted-foreground hover:text-foreground"
            >
              <MessagesSquare className="h-6 w-6 text-primary" />
              <h3 className="font-semibold leading-snug text-foreground">{t.entry.prepTitle}</h3>
              <p className="text-sm leading-relaxed">{t.entry.prepBody}</p>
              <span className="mt-1 text-xs font-semibold text-primary">{t.entry.prepCta} →</span>
            </button>
            {/* Welle C: Self-Service-Builder — nur für Workspace-Admins. */}
            {isWorkspaceAdmin && (
              <button
                onClick={() => router.push('/simulation/builder')}
                className="pn-none rounded-2xl p-5 text-left border-2 border-dashed border-accent/40 hover:border-accent transition-colors flex flex-col items-start justify-center gap-2 min-h-[200px] text-muted-foreground hover:text-foreground"
              >
                <Sparkles className="h-6 w-6 text-accent" />
                <h3 className="font-semibold leading-snug text-foreground">
                  {ts.builderCardTitle}
                </h3>
                <p className="text-sm leading-relaxed">{ts.builderCardBody}</p>
                <span className="mt-1 text-xs font-semibold text-accent">
                  {ts.builderCardCta} →
                </span>
              </button>
            )}
            <button
              onClick={() => {
                setWishDone(false);
                setWishOpen(true);
              }}
              className="pn-none rounded-2xl p-5 text-left border-2 border-dashed border-border hover:border-primary/50 transition-colors flex flex-col items-start justify-center gap-2 min-h-[200px] text-muted-foreground hover:text-foreground"
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
          <p className="text-xs text-muted-foreground text-center">{ts.startCostNote.replace('{eur}', maxEurHint(t.common.maxEurHint, locale))}</p>
        </div>

        {/* ── Welle 4: Dialog „Mein echtes Gespräch vorbereiten“ ── */}
        {vorbOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="pn-none glass-panel rounded-2xl border border-border p-6 max-w-lg w-full space-y-4 bg-card max-h-[90vh] overflow-y-auto">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <MessagesSquare className="h-5 w-5 text-primary" /> {t.entry.prepDialogTitle}
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{t.entry.prepHint}</p>
              <label className="block space-y-1">
                <span className="text-sm font-medium">{t.entry.prepAnlass}</span>
                <textarea
                  value={vorbAnlass}
                  onChange={(e) => setVorbAnlass(e.target.value)}
                  rows={3}
                  maxLength={1200}
                  placeholder={t.entry.prepAnlassPh}
                  className="pn-field w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium">{t.entry.prepGegen}</span>
                <textarea
                  value={vorbGegen}
                  onChange={(e) => setVorbGegen(e.target.value)}
                  rows={3}
                  maxLength={1200}
                  placeholder={t.entry.prepGegenPh}
                  className="pn-field w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium">{t.entry.prepZiel}</span>
                <textarea
                  value={vorbZiel}
                  onChange={(e) => setVorbZiel(e.target.value)}
                  rows={2}
                  maxLength={600}
                  placeholder={t.entry.prepZielPh}
                  className="pn-field w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </label>
              <p className="text-xs text-muted-foreground">{t.entry.prepCost}</p>
              {vorbError && <p className="text-sm text-rose-800 dark:text-rose-400">{vorbError}</p>}
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setVorbOpen(false)}
                  disabled={vorbBusy}
                  className="pn-none rounded-lg px-4 py-2 text-sm border border-border hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {t.common.cancel}
                </button>
                <button
                  onClick={() => void submitVorbereiten()}
                  disabled={vorbBusy || vorbAnlass.trim().length < 20 || vorbGegen.trim().length < 20}
                  className="btn-gradient text-white font-semibold rounded-lg px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-50"
                >
                  {vorbBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {vorbBusy ? t.entry.prepBusy : t.entry.prepSend}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Wunsch-Dialog (Geister-Karte) ── */}
        {wishOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="pn-none glass-panel rounded-2xl border border-border p-6 max-w-md w-full space-y-4 bg-card">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-primary" /> {t.entry.wishTitle}
              </h3>
              {wishDone ? (
                <>
                  <p className="text-sm leading-relaxed flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-emerald-800 dark:text-emerald-400 shrink-0 mt-0.5" />
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
                    className="pn-field w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => setWishOpen(false)}
                      className="pn-none rounded-lg px-4 py-2 text-sm border border-border hover:bg-muted transition-colors"
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
    const comps = scenario.competencies;
    const steps = [
      { icon: User, label: ts.stepSituation },
      { icon: Target, label: ts.stepGoals },
      { icon: Compass, label: ts.stepApproach },
      // Welle 1 (3.4): die Fähigkeiten, auf die der Richter achtet — mit Gewicht und Definition.
      { icon: ListChecks, label: ts.stepCriteria },
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
                {scenario.variante && (
                  <span className="pn-none mt-1 inline-block rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary" data-testid="variante-badge">
                    {ts.variantLabel}: {locale === 'de' ? scenario.variante.name.de : scenario.variante.name.en}
                  </span>
                )}
                <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{scenario.teaser}</p>
              </div>

              {renderBriefSteps()}

              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={() => setBriefStep((s) => Math.max(0, s - 1))}
                  disabled={briefStep === 0}
                  className="pn-none rounded-xl px-4 py-2.5 text-sm border border-border hover:bg-muted transition-colors disabled:opacity-40 flex items-center gap-1"
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
                        'pn-none inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors',
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

              {/* ── B2: Übungs- vs. Prüfungsmodus ── */}
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  {ts.modeLabel}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(['practice', 'check'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setSimMode(m)}
                      aria-pressed={simMode === m}
                      className={cx(
                        'pn-none inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors',
                        simMode === m
                          ? 'border-primary/60 bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/30'
                      )}
                    >
                      {m === 'practice' ? <MessagesSquare className="h-4 w-4" /> : <Flag className="h-4 w-4" />}
                      {m === 'practice' ? ts.modePractice : ts.modeCheck}
                    </button>
                  ))}
                </div>
                {simMode === 'check' && (
                  <p className="mt-2 text-xs text-amber-800 dark:text-amber-400 leading-relaxed">{ts.modeCheckHint}</p>
                )}
              </div>

              {/* ── B2: Härtegrad der Persona ── */}
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  {ts.hardnessLabel}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(['mild', 'standard', 'hart'] as const).map((h) => (
                    <button
                      key={h}
                      onClick={() => setSimHardness(h)}
                      aria-pressed={simHardness === h}
                      className={cx(
                        'pn-none rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors',
                        simHardness === h
                          ? 'border-primary/60 bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/30'
                      )}
                    >
                      {h === 'mild' ? ts.hardnessMild : h === 'standard' ? ts.hardnessStandard : ts.hardnessHart}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{ts.hardnessHint}</p>
              </div>
            </div>

            {/* ── Rechte Spalte: Hero-Porträt mit Overlay (Synthesia-Muster) ── */}
            <div className="order-1 lg:order-2 lg:sticky lg:top-4">
              <div className="pn-none relative overflow-hidden rounded-3xl border border-border shadow-neon aspect-[4/5] bg-muted">
                {/* Welle 4: Kunden- und private Szenarien haben kein Porträt — dann Verlauf mit Initialen statt Alt-Text. */}
                {heroImgFailed ? (
                  <div className="absolute inset-0 flex items-start justify-center pt-[22%] bg-gradient-to-br from-primary to-accent text-7xl font-bold text-primary-foreground/80" aria-hidden>
                    {scenario.persona.name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={withBasePath(`/personas/${portraitOf(scenario)}.jpg`)}
                    alt={scenario.persona.name}
                    className="absolute inset-0 h-full w-full object-cover"
                    onError={() => setHeroImgFailed(true)}
                  />
                )}
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
                      {ts.timeboxHonest.replace('{min}', String(simMode === 'check' ? (scenario.checkDurationMin ?? scenario.durationMin) : scenario.durationMin))}
                    </span>
                  </div>
                  {/* W2-4: Preis VOR der Entscheidung, nicht erst im Dialog. */}
                  <div className="text-[11px] text-white/65">{ts.startCostNote.replace('{eur}', maxEurHint(t.common.maxEurHint, locale))}</div>
                  {/* EU-KI-VO Art. 50 (T1.5, Owner-GO 25.09.): Interaktions-Hinweis VOR dem Start —
                      sichtbar, nicht wegklickbar; der Fusszeilen-Hinweis im Chat bleibt zusaetzlich. */}
                  <div className="text-[11px] text-white/85 inline-flex items-center justify-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span>{ts.aiStartNotice}</span>
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
                  'pn-none flex-1 flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors',
                  i === briefStep
                    ? 'border-primary/50 bg-primary/10 text-primary'
                    : i < briefStep
                      ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-400'
                      : 'border-border text-muted-foreground hover:text-foreground'
                )}
              >
                <st.icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{st.label}</span>
                <span className="sm:hidden">{i + 1}</span>
              </button>
            ))}
          </div>

          <div className="pn-surface glass-panel rounded-2xl p-6 min-h-[280px]">
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
                    <ul className="pn-tile space-y-1 rounded-lg border border-border bg-muted/40 p-3">
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
                    <li key={idx} className="pn-tile text-sm leading-relaxed flex gap-3 rounded-xl border border-border bg-muted/30 p-3">
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
                  <section className="pn-none rounded-xl border border-accent/30 bg-accent/5 p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-accent mb-1 flex items-center gap-1">
                      <Lightbulb className="h-3.5 w-3.5" /> {ts.expectationTitle}
                    </h3>
                    <p className="text-sm leading-relaxed">{b.expectation}</p>
                  </section>
                )}
              </div>
            )}
            {briefStep === 3 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <ListChecks className="h-4 w-4 text-primary" /> {ts.stepCriteria}
                </h3>
                <p className="text-sm text-muted-foreground">{ts.criteriaIntro}</p>
                <ul className="divide-y divide-border">
                  {(() => {
                    const total = comps.reduce((a, c) => a + (c.weight ?? 1), 0) || 1;
                    return comps.map((c) => {
                      const f = faehigkeit(c.key);
                      const ft = f ? faehigkeitText(f, locale) : null;
                      return (
                        <li key={c.key} className="py-2.5">
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-sm font-semibold">{ft ? ft.titel : c.label}</span>
                            <span className="pn-none shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                              {Math.round(((c.weight ?? 1) / total) * 100)} %
                            </span>
                          </div>
                          {ft && <p className="text-sm text-muted-foreground leading-relaxed mt-0.5">{ft.definition}</p>}
                        </li>
                      );
                    });
                  })()}
                </ul>
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
    const limitMs =
      (simMode === 'check'
        ? (scenario.checkDurationMin ?? scenario.durationMin)
        : scenario.durationMin) * 60_000;
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
              className="pn-none text-sm font-semibold rounded-lg px-3 py-2 border border-border text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
              title={ts.backToList}
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">{ts.backToList}</span>
            </button>
            {/* Sprachmodus Live: Kennzeichen neben der Uhr, solange die Live-Verbindung steht. */}
            {liveState !== 'off' && (
              <span
                className={cx(
                  'pn-none text-sm font-semibold rounded-lg px-3 py-2 border flex items-center gap-1.5',
                  liveState === 'on' ? 'border-primary/40 text-primary bg-primary/10' : 'border-border text-muted-foreground'
                )}
                title={liveState === 'on' ? ts.liveActive : ts.liveConnecting}
              >
                <Radio className={liveState === 'on' ? 'h-4 w-4 animate-pulse' : 'h-4 w-4'} /> {ts.liveBadge}
              </span>
            )}
            {/* Welle 2: Statuszeile — Stille-Vorwarnung, Verbindung kurz weg, wieder da. Erscheint nur im Fall. */}
            {liveNotice && (
              <span
                className={cx(
                  'pn-none text-sm rounded-lg px-3 py-2 border flex items-center gap-2',
                  liveNotice.kind === 'reconnected'
                    ? 'border-emerald-500/40 text-emerald-800 dark:text-emerald-300 bg-emerald-500/10'
                    : liveNotice.kind === 'reconnecting'
                      ? 'border-rose-500/40 text-rose-700 dark:text-rose-300 bg-rose-500/10'
                      : 'border-amber-500/40 text-amber-800 dark:text-amber-400 bg-amber-500/10'
                )}
                role="status"
              >
                <span className={cx('h-2 w-2 rounded-full', liveNotice.kind === 'reconnected' ? 'bg-emerald-500' : liveNotice.kind === 'reconnecting' ? 'bg-rose-500' : 'bg-amber-500')} />
                {liveNotice.kind === 'idle'
                  ? ts.liveIdleWarn.replace('{s}', String(liveNotice.seconds ?? 60))
                  : liveNotice.kind === 'reconnecting'
                    ? ts.liveReconnecting
                    : ts.liveReconnected}
              </span>
            )}
            {/* W2-1: Countdown — passiv, keine Bewertung. */}
            {clockText && (
              <span
                className={cx(
                  'text-sm font-semibold rounded-lg px-3 py-2 border tabular-nums flex items-center gap-1.5',
                  timeUp || remainingMs === 0
                    ? 'border-rose-500/40 text-rose-800 dark:text-rose-400 bg-rose-500/10'
                    : clockWarn
                      ? 'border-amber-500/40 text-amber-800 dark:text-amber-500 bg-amber-500/10'
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
                  if (speakReplies) stopSpeaking();
                  setSpeakReplies((v) => !v);
                }}
                className={cx(
                  'pn-none text-sm font-semibold rounded-lg px-3 py-2 border transition-colors flex items-center gap-1.5',
                  speakReplies
                    ? 'border-primary/40 text-primary bg-primary/10'
                    : 'border-border text-muted-foreground hover:text-foreground'
                )}
                title={speakReplies ? ts.ttsOff : ts.ttsOn}
              >
                {speakReplies ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </button>
            )}
            {simMode !== 'check' && (
            <button
              onClick={() => {
                // Paket 1, C1: Der Dialog zeigt seine eigenen Fehler — eine ältere Meldung aus dem Gespräch gehört nicht hinein.
                setError(null);
                setTimeoutOpen(true);
              }}
              disabled={userTurnCount < 1 || timeoutsLeft === 0}
              className="pn-none text-sm font-semibold rounded-lg px-3 py-2 border border-accent/40 text-accent hover:bg-accent/10 transition-colors flex items-center gap-1.5 disabled:opacity-50"
              title={ts.timeoutHint}
            >
              <Pause className="h-4 w-4" /> {ts.timeoutCta}
              {/* W2-4: Zähler mit Legende statt nacktem 0/3 */}
              <span className="text-[10px] tabular-nums" title={ts.timeoutCounterLegend}>
                {coachNotes.length}/{timeoutsMax}
              </span>
            </button>
            )}
            {simMode === 'check' && (
              <span className="text-xs font-semibold rounded-lg px-3 py-2 border border-amber-500/40 text-amber-800 dark:text-amber-400 bg-amber-500/10 inline-flex items-center gap-1.5">
                <Flag className="h-3.5 w-3.5" /> {ts.modeCheckBadge}
              </span>
            )}
            {/* W2-3: erst ab 3 eigenen Beiträgen aktiv (Dialog verlangte es
                schon immer — jetzt sagt es auch der Button). Nach Zeitablauf
                übernimmt das Banner/Modal — kein doppelter Auswerten-Knopf. */}
            {!effTimeUp && (
              <button
                onClick={() => {
                  stopMic();
                  setConfirmOpen(true);
                }}
                disabled={finishing || userTurnCount < 3}
                className="pn-none text-sm font-semibold rounded-lg px-3 py-2 border border-primary/40 text-primary hover:bg-primary/10 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                title={userTurnCount < 3 ? ts.finishNeedsTurns : undefined}
              >
                {/* U11 (Paket 1, 12.11.2026): Hat die Rolle beendet, gibt es nichts mehr zu beenden — nur „Auswerten“. */}
                <Flag className="h-4 w-4" /> {personaEnded ? ts.evaluateCta : ts.finishCta}
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
                      <ul className="pn-tile space-y-1 rounded-lg border border-border bg-muted/40 p-3">
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
                    <div className="pn-none rounded-xl border border-accent/30 bg-accent/5 p-3">
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
              {/* EU-KI-VO Art. 50 (T1.5): Hinweis am Sessionstart, oberhalb des ersten Beitrags. */}
              <div className="flex justify-center">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground">
                  <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
                  {ts.aiStartNotice}
                </span>
              </div>
              {turns.map((turn, idx) => (
                <div
                  key={idx}
                  className={cx('flex items-end gap-2', turn.role === 'user' ? 'justify-end' : 'justify-start')}
                >
                  {turn.role === 'persona' && <PersonaAvatar name={scenario.persona.name} scenarioId={portraitOf(scenario)} size="sm" />}
                  <div
                    className={cx(
                      'pn-none rounded-2xl px-4 py-2.5 text-sm leading-relaxed max-w-[85%] whitespace-pre-wrap',
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
                  <PersonaAvatar name={scenario.persona.name} scenarioId={portraitOf(scenario)} size="sm" />
                  <div className="pn-none glass-panel border border-border rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {scenario.persona.name} {ts.personaTyping}
                  </div>
                </div>
              )}
              {/* Sprachmodus Live: Verbindungsaufbau und die mitlaufende Mitschrift des laufenden Zugs. */}
              {liveState === 'connecting' && (
                <div className="flex items-end gap-2 justify-start">
                  <PersonaAvatar name={scenario.persona.name} scenarioId={portraitOf(scenario)} size="sm" />
                  <div className="pn-none glass-panel border border-border rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {ts.liveConnecting}
                  </div>
                </div>
              )}
              {liveYou && (
                <div className="flex items-end gap-2 justify-end">
                  <div className="pn-none rounded-2xl px-4 py-2.5 text-sm leading-relaxed max-w-[85%] whitespace-pre-wrap bg-primary/70 text-primary-foreground rounded-br-sm">
                    {liveYou}
                  </div>
                </div>
              )}
              {livePersona && (
                <div className="flex items-end gap-2 justify-start">
                  <PersonaAvatar name={scenario.persona.name} scenarioId={portraitOf(scenario)} size="sm" />
                  <div className="pn-none glass-panel border border-border rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm leading-relaxed max-w-[85%] whitespace-pre-wrap">
                    {livePersona}
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          </div>

          {/* Eingabe */}
          <div className="border-t border-border p-3">
            {/* CP-3.3 (M17, EU-KI-VO Art. 50): dauerhafter KI-Hinweis — bewusst
                persistent statt einmal wegklickbar (beweissicher, Abs. 5:
                spätestens bei der ersten Interaktion). */}
            <p className="max-w-3xl mx-auto mb-1 text-[10px] leading-tight text-muted-foreground">
              {ts.aiNotice}
            </p>
            {/* Zeit-Regie (Owner-Vorgabe 04.08.): nach der Verabschiedung der
                Persona ist die Eingabe zu — es bleibt nur die Auswertung. */}
            {/* Welle 2: die Rolle hat das Gespräch selbst beendet — Karte mit Grund-Art und Weg zur Auswertung. */}
            {personaEnded && !deadEnd && (
              <div className="pn-none max-w-3xl mx-auto mb-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold text-emerald-800 dark:text-emerald-300">{ts.endedByPersona.replace('{name}', scenario.persona.name)}</span>
                  <span className="text-muted-foreground">
                    {personaEnded.ergebnis === 'ziel' ? ts.endedZiel : personaEnded.ergebnis === 'abbruch' ? ts.endedAbbruch : ts.endedVerabschiedung} {ts.endedHint}
                  </span>
                </span>
                <button
                  onClick={() => {
                  stopMic();
                  setConfirmOpen(true);
                }}
                  disabled={finishing}
                  className="btn-gradient text-white font-semibold rounded-lg px-4 py-2 text-sm flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" /> {ts.evaluateCta}
                </button>
              </div>
            )}
            {effTimeUp && !deadEnd && !personaEnded && (
              <div className="pn-none max-w-3xl mx-auto mb-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 text-amber-800 dark:text-amber-400">
                  <Clock className="h-4 w-4 shrink-0" /> {ts.timeUpBanner}
                </span>
                <button
                  onClick={() => {
                  stopMic();
                  setConfirmOpen(true);
                }}
                  disabled={finishing}
                  className="btn-gradient text-white font-semibold rounded-lg px-4 py-2 text-sm flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" /> {ts.evaluateCta}
                </button>
              </div>
            )}
            {micActive && !effTimeUp && (
              <div className="max-w-3xl mx-auto mb-2 flex items-center gap-2 text-xs text-primary">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
                {liveState === 'on' ? ts.liveActive : ts.micLive}
              </div>
            )}
            {/* Paket 1, C1 (12.11.2026): Die Meldung steht direkt über dem Eingabefeld. Vorher stand sie über dem
                ersten Beitrag und war in einem längeren Gespräch aus dem Bild gescrollt.
                W2-3: kein doppelter Fehlerbanner — im offenen Dialog zeigt der Dialog. */}
            {error && !confirmOpen && !checkinOpen && !timeoutOpen && (
              <div className="max-w-3xl mx-auto mb-2" role="alert">
                {errorBanner}
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
                placeholder={personaEnded ? ts.endedHint : effTimeUp ? ts.timeUpPlaceholder : liveState !== 'off' ? ts.liveActive : ts.inputPlaceholder}
                disabled={effTimeUp || liveState !== 'off'}
                className="pn-field flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
              />
              {/* Paket 1, C11 (12.11.2026): Während das Mikrofon startet oder neu verbindet, ist der Knopf gesperrt. */}
              {speechSupported && !effTimeUp && (
                <button
                  onClick={() => (micActive ? stopMic() : startMic())}
                  disabled={micStarting || liveState === 'connecting' || liveNotice?.kind === 'reconnecting'}
                  className={cx(
                    'pn-none relative rounded-xl p-3 border transition-colors disabled:opacity-50',
                    micActive
                      ? 'border-primary/60 text-primary bg-primary/10 shadow-neon'
                      : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
                  )}
                  aria-label={micActive ? ts.micStop : ts.micStart}
                  title={micActive ? ts.micStop : ts.micStart}
                >
                  {/* Owner-Befund 19.09.: animate-ping skalierte den Ring auf 2x und ragte 9 px in den
                      scrollbaren Gesprächsbereich → Scrollbar flackerte im Sekundentakt → die Seite
                      wackelte rechts-links. Pulsieren ohne Wachsen hält das Layout still. */}
                  {micActive && (
                    <span className="absolute inset-0 rounded-xl border-2 border-primary/50 animate-pulse pointer-events-none" aria-hidden />
                  )}
                  <Mic className="h-5 w-5" />
                </button>
              )}
              <button
                onClick={() => void sendTurn()}
                disabled={sending || !input.trim() || effTimeUp || liveState !== 'off'}
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
            <div className="pn-none glass-panel rounded-2xl border border-amber-500/40 p-6 max-w-md w-full space-y-4 bg-card">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Clock className="h-5 w-5 text-amber-800 dark:text-amber-500" /> {ts.deadEndTitle}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{ts.deadEndBody}</p>
              {error && errorBanner}
              <div className="flex flex-wrap gap-2 justify-end">
                <button
                  onClick={() => void abortSimulation()}
                  disabled={aborting || starting}
                  className="pn-none rounded-lg px-4 py-2 text-sm border border-border hover:bg-muted transition-colors disabled:opacity-50 flex items-center gap-2"
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
            <div className="pn-none glass-panel rounded-2xl border border-border p-6 max-w-md w-full space-y-4 bg-card">
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
                  className="pn-none rounded-lg px-4 py-2 text-sm border border-border hover:bg-muted transition-colors"
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
            <div className="pn-none glass-panel rounded-2xl border border-accent/40 p-6 max-w-lg w-full space-y-4 bg-card max-h-[85vh] overflow-y-auto custom-scrollbar">
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
                    <div className="pn-none text-sm rounded-xl bg-primary/10 border border-primary/20 px-3 py-2">
                      {n.question}
                    </div>
                  )}
                  <div className="pn-none text-sm rounded-xl border border-accent/30 bg-accent/5 px-3 py-2 leading-relaxed whitespace-pre-wrap">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-accent mb-1">
                      Coach
                    </div>
                    {n.answer}
                    {/* V3 (Owner-GO 25.09.): die Merkkarte, auf der der Impuls aufbaut. */}
                    {n.card && (
                      <div
                        className="pn-none mt-2 rounded-lg border border-border bg-background/70 px-3 py-2 text-left"
                        data-testid="coach-card"
                      >
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                          <Lightbulb className="h-3 w-3" aria-hidden /> {ts.coachCardLabel}
                        </div>
                        <div className="text-sm font-medium">{n.card.title}</div>
                        {n.card.hint && (
                          <div className="text-xs text-muted-foreground leading-snug">{n.card.hint}</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {timeoutBusy && (
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> {ts.timeoutThinking}
                </div>
              )}
              {/* Paket 1, C1 (12.11.2026): Fehler der Coach-Pause stehen im Dialog (vorher verdeckt dahinter). */}
              {error && errorBanner}

              {coachNotes.length < timeoutsMax && (
                <div className="flex items-end gap-2">
                  <textarea
                    value={timeoutQuestion}
                    onChange={(e) => setTimeoutQuestion(e.target.value)}
                    rows={2}
                    placeholder={ts.timeoutPlaceholder}
                    className="pn-field flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                  <button
                    onClick={() => void requestTimeout()}
                    disabled={timeoutBusy}
                    className="pn-none rounded-xl px-4 py-2.5 text-sm font-semibold border border-accent/40 text-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
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
        {/* CP-3.4 (M21 Option 1) — Aufklärung vor der ersten Mikrofon-Nutzung. */}
        {consentUrl && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" data-testid="consent-needed">
            <div className="pn-none glass-panel rounded-2xl border border-border p-6 max-w-md w-full space-y-4 bg-card">
              <h3 className="font-semibold text-lg">{ts.consentTitle}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{ts.consentBody}</p>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setConsentUrl(null)} className="pn-none rounded-lg px-4 py-2 text-sm border border-border hover:bg-muted transition-colors">{ts.consentLater}</button>
                <a href={consentUrl} className="btn-gradient text-white font-semibold rounded-lg px-4 py-2 text-sm">{ts.consentGo}</a>
              </div>
            </div>
          </div>
        )}
        {micNoticeOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="pn-none glass-panel rounded-2xl border border-border p-6 max-w-md w-full space-y-4 bg-card">
              <h3 className="font-semibold text-lg">{ts.micNoticeTitle}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{ts.micNoticeBody}</p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setMicNoticeOpen(false)}
                  className="pn-none rounded-lg px-4 py-2 text-sm border border-border hover:bg-muted transition-colors"
                >
                  {ts.micNoticeDecline}
                </button>
                <button
                  onClick={() => {
                    micAckRef.current = true;
                    try {
                      localStorage.setItem(MIC_ACK_KEY, "1");
                    } catch {
                      /* Privatmodus — Sitzungs-Fallback micAckRef greift */
                    }
                    setMicNoticeOpen(false);
                    startMic();
                  }}
                  className="btn-gradient text-white font-semibold rounded-lg px-4 py-2 text-sm"
                >
                  {ts.micNoticeAccept}
                </button>
              </div>
            </div>
          </div>
        )}

        {confirmOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="pn-none glass-panel rounded-2xl border border-border p-6 max-w-md w-full space-y-4 bg-card">
              <h3 className="font-semibold text-lg">{ts.confirmTitle}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{ts.confirmBody}</p>
              {/* Preis vor dem Klick (29.09.): die Auswertung ist der einzige kostenpflichtige Schritt. */}
              <p className="text-xs text-muted-foreground" data-testid="finish-cost-note">
                {ts.finishCostNote.replace('{eur}', maxEurHint(t.common.maxEurHint, locale))}
              </p>
              {userTurnCount < 3 && (
                <p className="text-sm text-amber-800 dark:text-amber-400">{ts.notEnoughTurns}</p>
              )}
              {error && errorBanner}
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setConfirmOpen(false)}
                  className="pn-none rounded-lg px-4 py-2 text-sm border border-border hover:bg-muted transition-colors"
                >
                  {t.common.cancel}
                </button>
                <button
                  onClick={() => {
                    // A1: erst der Check-in, dann die Auswertung. Das geteilte
                    // Eingabefeld wird geleert — ein liegengebliebener Entwurf
                    // gehört zum beendeten Gespräch, nicht zur Reflexion.
                    stopMic();
                    setConfirmOpen(false);
                    setCheckinOpen(true);
                    setInput('');
                  }}
                  disabled={finishing || userTurnCount < 3}
                  className="btn-gradient text-white font-semibold rounded-lg px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" />
                  {ts.confirmCta}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* A1: Coaching-Check-in — Selbstbild einholen, BEVOR das Ergebnis kommt
            (Synthesia-Vergleich §7). Antwort fährt im Finish-Aufruf mit: kein
            zusätzlicher Credit, keine zusätzliche Latenz. */}
        {checkinOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="pn-none glass-panel rounded-2xl border border-border p-6 max-w-md w-full space-y-4 bg-card">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <GraduationCap className="h-5 w-5" />
                </span>
                <h3 className="font-semibold text-lg">{ts.checkinTitle}</h3>
              </div>
              <p className="text-sm leading-relaxed">{ts.checkinQuestion}</p>
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  rows={4}
                  maxLength={500}
                  placeholder={ts.checkinPlaceholder}
                  className="pn-field flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  autoFocus
                />
                {speechSupported && (
                  <button
                    onClick={() => (micActive ? stopMic() : startDictation())}
                    disabled={micStarting}
                    className={cx(
                      'pn-none relative rounded-xl p-3 border transition-colors disabled:opacity-50',
                      micActive
                        ? 'border-primary/60 text-primary bg-primary/10 shadow-neon'
                        : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
                    )}
                    aria-label={micActive ? ts.micStop : ts.micStart}
                    title={micActive ? ts.micStop : ts.micStart}
                  >
                    <Mic className="h-5 w-5" />
                  </button>
                )}
              </div>
              {error && errorBanner}
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => void finishSimulation()}
                  disabled={finishing}
                  className="pn-none rounded-lg px-4 py-2 text-sm border border-border hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {ts.checkinSkip}
                </button>
                <button
                  onClick={() => void finishSimulation(input)}
                  disabled={finishing || !input.trim()}
                  className="btn-gradient text-white font-semibold rounded-lg px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-50"
                >
                  {finishing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {ts.checkinSubmit}
                </button>
              </div>
              {/* W1-13 (14.10.2026): die KI sagt in Ich-Form, was sie gerade tut (LXT Anhang F §4.4). */}
              {finishing ? (
                <AiWaitSteps
                  steps={[t.aiWait.finishStep1, t.aiWait.finishStep2, t.aiWait.finishStep3]}
                  intervalMs={8000}
                  className="mt-3 text-center text-xs text-muted-foreground"
                />
              ) : null}
            </div>
          </div>
        )}
      </AppShell>
    );
  }

  return null;
}
