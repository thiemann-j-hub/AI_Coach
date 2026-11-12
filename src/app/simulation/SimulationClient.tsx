'use client';

/**
 * Gesprächssimulation — Debrief 2.0 (Blueprint COACH-DEBRIEF-BLUEPRINT.md).
 *
 * Ablauf: Szenario-Auswahl → Kontext-Treppe (Situation → Ziele → So gelingt es)
 * → Chat mit der KI-Rolle (inkl. Time-out-Coach) → kostenpflichtige Auswertung
 * mit deterministischem Gesamtscore, Erwartungslabels, Zitat-Belegen, Delta zum
 * Vorversuch und Fokus-Retry. Grundsatz: »Kein Score ohne Zitat« — und
 * »nicht beobachtbar« ist ehrlicher als 0 %.
 *
 * Paket 4 (12.11.2026, C25): Die Sprachwege leben in eigenen Dateien unter ./sprechen —
 * `useLiveGespraech` (Sprachgespräch mit der Rolle), `useDiktat` (Diktat ins Eingabefeld), dazu die Ansichten
 * `WegWahl` (Briefing), `MikrofonCheck` und `Sprechansicht`. Diese Datei verbindet sie mit Briefing, Chat und
 * dem Ablauf am Gesprächsende.
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
  FileText,
  HelpCircle,
  Keyboard,
  ListChecks,
  Flag,
  MessagesSquare,
  Lightbulb,
  Loader2,
  Mic,
  MoreHorizontal,
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
import { aiErrorMessage } from '@/lib/api-error-text';
import { withBasePath } from '@/lib/base-path';
import { liveAudioSupported } from '@/lib/live-audio';
import { useAuth } from '@/providers/auth-provider';
import { useTranslation } from '@/i18n/useTranslation';
import { faehigkeit, faehigkeitText } from '@/lib/simulation/faehigkeiten';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { costNote, maxEurHint, showEurPrice } from '@/lib/pricing-display';
import { useWorkspaceRole } from '@/lib/use-workspace-role';
import type { FactVisual, PersonaVoice } from '@/lib/simulation/types';
import { recommendScenarios } from '@/lib/simulation/empfehlung';
import { catalogOrder, type PlayedInfo } from '@/lib/simulation/katalog';
import {
  CHECKIN_MAX_CHARS,
  checkinAutoWeiterIn,
  checkinSchritt,
  checkinStart,
  type CheckinAktion,
  type CheckinBody,
  type CheckinStand,
} from '@/lib/simulation/checkin-ablauf';
import { decideApiFailure, type ApiFailureBody } from '@/lib/simulation/api-failure';
import type { VoiceMessage } from '@/lib/simulation/live-failure';
import { uhrStand } from '@/lib/simulation/gespraechs-uhr';
import { rolleZustand } from '@/lib/simulation/sprech-zustand';
import { WEG_MERKER, gemerkterWeg, mikrofonVorhanden, wegBeimFortsetzen, wegVorwahl, type Weg } from '@/lib/simulation/weg-wahl';
import { pauseSetzen } from '@/lib/simulation/zeit';
import { MikrofonCheck } from './sprechen/MikrofonCheck';
import { Sprechansicht } from './sprechen/Sprechansicht';
import { WegWahl } from './sprechen/WegWahl';
import { mikroHinweisBestaetigen, mikroHinweisBestaetigt } from './sprechen/mikro-hinweis';
import { GespraechsBlasen, PersonaAvatar, cx } from './sprechen/teile';
import { useDiktat } from './sprechen/useDiktat';
import { useLiveGespraech } from './sprechen/useLiveGespraech';

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
  /** Paket 4: Das Szenario erlaubt das Sprachgespräch (Katalog). Nur dann gibt es die Wahl „Sprechen“. */
  liveAvailable?: boolean;
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
  /** `finishing` (Paket 3): die Auswertung läuft gerade. */
  status: 'active' | 'finishing' | 'finished';
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  attempt: number;
  overall: number | null;
  verdict: 'passed' | 'failed' | 'unrated' | null;
  /** Pausenfelder der Uhr (zeit.ts) für die Restzeit in der Liste offener Läufe. */
  pausedMs?: number;
  pauseSince?: string | null;
}

/**
 * Einstiegs-Insight des Katalog-Endpunkts (W1-4). U15 (Owner-Entscheid 12.11.2026): schwächste beobachtete
 * FÄHIGKEIT der jüngsten Rollenspiel-Auswertung (Schlüssel aus `feedback.rubric`) und deren Szenario.
 */
interface EntryInsight {
  skill: string;
  label: string | null;
  scenarioId: string | null;
}

/**
 * U28, C25 (12.11.2026): Bestätigung, Check-in und die zwei Hinweise zum Mikrofon nutzen die Dialog-Komponente
 * (Fokusfang, Escape, `role="dialog"`). Aussehen wie die übrigen Dialoge dieser Seite; am Handy bleibt ein Rand.
 * Das Schließen-Kreuz der Komponente ist ausgeblendet: Jeder dieser Dialoge hat eigene, beschriftete Knöpfe.
 */
const DIALOG_BOX =
  'pn-none glass-panel w-[calc(100%-2rem)] max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl sm:rounded-2xl border-border bg-card p-6 [&>button.absolute]:hidden';
const DIALOG_TITLE = 'text-lg font-semibold leading-snug tracking-normal';
/** Check-in am Handy: Der Dialog steht oben. Das Feld hat sofort den Cursor, die Tastatur verdeckte sonst „Weiter“. */
const DIALOG_BOX_CHECKIN = `${DIALOG_BOX} top-4 translate-y-0 sm:top-[50%] sm:translate-y-[-50%]`;

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

/** Paket 4: Die letzte eigene Wahl „Sprechen | Schreiben“ merkt sich das Gerät (localStorage, try/catch). */
function liesGemerktenWeg(): Weg | null {
  try {
    return gemerkterWeg(localStorage.getItem(WEG_MERKER));
  } catch {
    return null;
  }
}
function merkeWeg(weg: Weg) {
  try {
    localStorage.setItem(WEG_MERKER, weg);
  } catch {
    /* localStorage optional */
  }
}

/** Paket 4, S24: Zählpunkt des Trichters (ohne Nutzertext, ohne Ablage). Best effort: Er hält niemanden auf. */
function zaehlpunkt(schritt: 'briefing' | 'mikro_ok' | 'mikro_verweigert', scenarioId: string, weg?: Weg) {
  void authFetch('/api/simulation/zaehlpunkt', {
    method: 'POST',
    body: JSON.stringify({ schritt, scenarioId, ...(weg ? { weg } : {}) }),
  }).catch(() => {});
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

export default function SimulationClient() {
  const { t, locale } = useTranslation();
  const ts = t.simulation;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const [view, setView] = useState<View>('loading');
  const [scenarios, setScenarios] = useState<PublicScenario[]>([]);
  /** Entwurf aus dem Builder für den Probelauf (`/?szenario=<id>`): steht nicht im Katalog, die Route gibt ihn Admins mit. */
  const [probe, setProbe] = useState<PublicScenario | null>(null);
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
   * Check-in nach dem Gespräch. Paket 3, S8 (12.11.2026): zwei kurze Fragen nacheinander, WÄHREND die Auswertung
   * schon rechnet (vorher: eine Doppelfrage, erst danach startete der Richter). null = zu. Die Schrittfolge und
   * die 20-Sekunden-Regel stehen getestet in src/lib/simulation/checkin-ablauf.ts. Das Eingabefeld teilt sich den
   * `input`-State mit dem Chat — so diktiert das Mikrofon ohne Umbau auch hier hinein.
   */
  const [checkin, setCheckin] = useState<CheckinStand | null>(null);
  /** Die Antworten sind unterwegs, gleich folgt der Wechsel zur Auswertungsseite. */
  const [checkinBusy, setCheckinBusy] = useState(false);
  /** Zeitpunkt der letzten Eingabe im Check-in: Ab hier zählen die 20 Sekunden. */
  const [checkinInputAt, setCheckinInputAt] = useState(0);
  /** Der Lauf hat schon einen Check-in (z. B. nach einer gescheiterten Auswertung): Dann fragen wir nicht noch einmal. */
  const [checkinDone, setCheckinDone] = useState(false);
  const checkinFieldRef = useRef<HTMLTextAreaElement | null>(null);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [attempt, setAttempt] = useState(1);
  /** Freier Probelauf (erste Auswertung eines selbst gebauten Szenarios): Der Dialog vor der Auswertung nennt keinen Credit. */
  const [freeEval, setFreeEval] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ── Einstieg (COACH-UX-BLUEPRINT §1) ──
  /** Empfehlungs-Insight des Katalogs (W1-4); null = Cold Start. */
  const [insight, setInsight] = useState<EntryInsight | null>(null);
  /** U21 (12.11.2026): bestes Ergebnis je Szenario aus den eigenen abgeschlossenen Läufen. */
  const [played, setPlayed] = useState<Record<string, PlayedInfo>>({});
  // O2 Micro-Transfer: anstehende Nachfrage (null = keine) + Dank nach Antwort.
  const [transfer, setTransfer] = useState<TransferItem | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferThanks, setTransferThanks] = useState(false);
  /** Filterzeile: »Alle« oder eine nicht-leere Kategorie (W1-5). */
  const [categoryFilter, setCategoryFilter] = useState<'all' | ScenarioCategory>('all');
  // Welle C: Builder-Karte nur für Workspace-Admins (Rolle aus dem Profil; ohne Rolle keine Karte).
  const workspaceRole = useWorkspaceRole();
  const isWorkspaceAdmin = workspaceRole === 'admin';
  // U23 (Owner-Entscheid 12.11.2026): Den Eurobetrag sehen nur Admins und Selbstzahler. Lernende, deren Firma
  // zahlt, lesen nur „1 Credit“; der Satz „1 Credit entspricht …“ entfällt für sie ganz.
  const eurHint = showEurPrice(workspaceRole) ? maxEurHint(t.common.maxEurHint, locale) : null;
  const startCost = costNote(ts.startCostNote, eurHint);
  const finishCost = costNote(ts.finishCostNote, eurHint);
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
  /**
   * Fokus aus dem Deep-Link (?szenario=&fokus= — „Nochmal üben mit Fokus“ auf der Auswertungsseite).
   * U19 (12.11.2026): Er steht sichtbar im Briefing und lässt sich dort entfernen; vorher ging er unsichtbar mit.
   */
  const [briefFocus, setBriefFocus] = useState<string | null>(null);
  const [topUpUrl, setTopUpUrl] = useState<string | null>(null);
  // Time-out-Coach (D3)
  const [timeoutOpen, setTimeoutOpen] = useState(false);
  const [coachNotes, setCoachNotes] = useState<CoachNote[]>([]);
  const [timeoutQuestion, setTimeoutQuestion] = useState('');
  const [timeoutBusy, setTimeoutBusy] = useState(false);
  const [timeoutsMax, setTimeoutsMax] = useState(3);
  // Antworten der Rolle im Chat vorlesen (Stimme der Rolle über /api/tts).
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
  // ── Paket 4 (Owner-Entscheid 12.11.2026): Sprechen oder Schreiben ──
  /** Der Weg des laufenden Gesprächs. */
  const [weg, setWeg] = useState<Weg>('schreiben');
  /** Eigene Wahl im offenen Briefing; null = die Vorwahl gilt (src/lib/simulation/weg-wahl.ts). */
  const [wegWunsch, setWegWunsch] = useState<Weg | null>(null);
  /** Mikrofon vorhanden? null = unbekannt (gilt als vorhanden). */
  const [mikrofonDa, setMikrofonDa] = useState<boolean | null>(null);
  /** Der Mikrofon-Check lief auf dieser Seite schon: Danach geht Sprechen ohne erneuten Check. */
  const [mikroGeprueft, setMikroGeprueft] = useState(false);
  /** Der Mikrofon-Check folgt direkt auf einen Klick (Start, Wechsel zu Sprechen): Dann fragt er das Mikrofon gleich an. */
  const [mikroAusKlick, setMikroAusKlick] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // ── W2-1 sichtbare Uhr; der Server bleibt Wahrheit. Paket 4, C13: Sie rechnet mit Start UND Pausen des Laufs
  //    (src/lib/simulation/gespraechs-uhr.ts) und steht in der Coach-Pause. ──
  const [simStartedAt, setSimStartedAt] = useState<string | null>(null);
  const [pausen, setPausen] = useState<{ pausedMs: number; pauseSince: string | null }>({ pausedMs: 0, pauseSince: null });
  /** Nur die Antwort auf die jüngste Pausen-Anfrage zählt (Öffnen und Schließen kurz nacheinander). */
  const pauseAnfrageRef = useRef(0);
  const [nowTs, setNowTs] = useState(() => Date.now());
  // ── W2-3: Verlassen-Dialog (Lauf bleibt offen) ──
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [aborting, setAborting] = useState(false);
  // ── W2-5: Ziel-Streifen (mobil einklappbar, Zustand gemerkt) ──
  const [goalsOpen, setGoalsOpen] = useState(true);
  // Owner-GO 19.09.: Persona-Antworten spricht der Server (Azure-HD, /api/tts).
  // Paket 6, C31 (12.11.2026): Die Browserstimme als Notnagel ist entfernt (manche Browser schicken den Text dafür
  // an ihren Hersteller). Kann der Server nicht vorlesen, bleibt die Antwort als Text stehen.
  const ttsSupported = typeof window !== 'undefined' && 'Audio' in window;

  // Diktat/Vorlesen folgen der GEWÄHLTEN Gesprächssprache (nicht der Autorensprache).
  const speechLang = SPEECH_LANG[convoLocale];

  // W5-4: Link zur Einwilligungs-Seite im Hub, wenn das Unternehmen die Zustimmung „Sprachaufnahme“ verlangt.
  const [consentUrl, setConsentUrl] = useState<string | null>(null);
  // CP-3.4 (M21 Option 1, Compliance-Blueprint 31.08.): Aufklärung vor der ERSTEN Mikrofon-Nutzung je Gerät.
  // Vor dem Diktat (Chat, Check-in) als Dialog; vor dem Sprechen steht sie im Mikrofon-Check. Die Bestätigung
  // selbst liegt in ./sprechen/mikro-hinweis.ts.
  const [micNoticeOpen, setMicNoticeOpen] = useState(false);

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

  // Paket 4, C25 (12.11.2026): Die Sprachwege leben in eigenen Hooks. Fehlerantworten ihrer Routen laufen über
  // `handleApiFailure` (weiter unten), darum der Umweg über den Ref.
  const apiFailureRef = useRef<(res: Response, body: ApiFailureBody | null) => void>(() => {});

  // Sprachgespräch (Owner-GO 28.10.2026, N4-231): Die Rolle hört und spricht selbst, die Mitschrift beider Seiten
  // läuft mit. Seit Paket 4 der erste Weg: Start im Briefing mit „Sprechen“, davor der Mikrofon-Check.
  const live = useLiveGespraech({
    simId,
    onTurn: (turn) => {
      const at = new Date().toISOString();
      setTurns((prev) => [
        ...prev,
        ...(turn.user ? [{ role: 'user' as const, text: turn.user, ts: at }] : []),
        ...(turn.persona ? [{ role: 'persona' as const, text: turn.persona, ts: at }] : []),
      ]);
      if (turn.timeUp) setTimeUp(true);
      if (turn.ended) setPersonaEnded((cur) => cur ?? { grund: '', ergebnis: 'verabschiedung' });
    },
    onEnded: (p) => setPersonaEnded({ grund: p.grund, ergebnis: p.ergebnis }),
    onBanner: (art) => {
      if (art === 'timeUp') setTimeUp(true);
      else setPersonaEnded((cur) => cur ?? { grund: '', ergebnis: 'verabschiedung' });
    },
    // C13: Das Relais nennt die Pausen des Laufs, die Uhr gleicht sich daran ab. Läuft dort noch eine Pause, obwohl
    // die Coach-Pause hier zu ist (das Schließen kam nicht an), endet sie jetzt.
    onReady: (p) => {
      if (typeof p.pausedMs !== 'number') return;
      setPausen({ pausedMs: p.pausedMs, pauseSince: p.pauseSince ?? null });
      if (p.pauseSince && !timeoutOpen) void setzePause(false);
    },
    onError: setError,
    // Ohne Einwilligung „Sprachaufnahme“ geht es schreibend weiter; der Hinweis nennt den Weg zur Einwilligung.
    onConsent: (url) => {
      setConsentUrl(url);
      setWeg('schreiben');
    },
    onApiFailure: (res, body) => apiFailureRef.current(res, body),
    // Sprechen geht für diesen Lauf gerade nicht (Schalter aus, Netz): schreibend weiter, mit einem Satz.
    onUnavailable: () => {
      setWeg('schreiben');
      setError(ts.speakUnavailable);
    },
    voiceText,
    texte: { genericError: ts.genericError, voiceLost: ts.voiceLost },
  });

  // Diktat: Gesprochenes wird ans Eingabefeld ANGEHÄNGT (nichts überschreiben). Es startet nie das Sprachgespräch.
  const diktat = useDiktat({
    lang: speechLang,
    onText: (text) => setInput((prev) => (prev ? prev.replace(/\s+$/, '') + ' ' : '') + text),
    onError: setError,
    onConsent: setConsentUrl,
    onApiFailure: (res, body) => apiFailureRef.current(res, body),
    voiceText,
    texte: { unavailable: ts.unavailable, genericError: ts.genericError },
  });

  const { stop: stopLive } = live;
  const { stop: stopDiktat, start: startDiktat } = diktat;
  /** Alles rund ums Mikrofon beenden: Sprachgespräch und Diktat. */
  const stopMic = useCallback(() => {
    stopDiktat();
    stopLive();
  }, [stopDiktat, stopLive]);

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
        case 'evaluation':
          // Paket 3 (12.11.2026): Der Lauf wurde inzwischen beendet (z. B. im zweiten Fenster) — kein roter Fehler,
          // sondern zur Auswertungsseite: Dort steht „läuft“ oder das Ergebnis.
          stopMic();
          if (simId) router.push(`/simulation/${encodeURIComponent(simId)}`);
          else setError(ts.genericError);
          break;
        case 'text':
          setError(ts[d.key]);
          break;
      }
    },
    [t, ts, stopMic, simId, router]
  );
  apiFailureRef.current = handleApiFailure;

  /**
   * Diktat starten (Chat und Check-in). Paket 4: Der Mikrofon-Knopf im Chat diktiert nur noch; das Sprachgespräch
   * beginnt im Briefing mit „Sprechen“ oder über das Menü. Vor der ersten Mikrofon-Nutzung je Gerät steht die
   * Aufklärung (CP-3.4); nach „Verstanden“ startet das Diktat.
   */
  const startDictation = useCallback(() => {
    if (!mikroHinweisBestaetigt()) {
      setMicNoticeOpen(true);
      return;
    }
    startDiktat();
  }, [startDiktat]);

  /**
   * Paket 4, C13 und U5 (12.11.2026): Die Coach-Pause hält die Uhr an. Der Server merkt die Pause am Lauf
   * (`POST /api/simulation/pause`); im Sprachgespräch halten zusätzlich Relais und Mikrofon an. Die Anzeige
   * folgt sofort und gleicht sich dann an die Antwort des Servers an.
   */
  async function setzePause(on: boolean, lauf: string | null = simId) {
    if (!lauf) return;
    const anfrage = ++pauseAnfrageRef.current;
    setPausen((cur) => {
      const neu = { ...cur };
      pauseSetzen(neu, on, Date.now());
      return neu;
    });
    live.pause(on);
    // Nimmt der Server die Pause nicht an (Deckel erreicht, Netz), läuft die Uhr dort weiter — also auch hier.
    const ohnePause = () => {
      if (on && pauseAnfrageRef.current === anfrage) setPausen((cur) => ({ ...cur, pauseSince: null }));
    };
    try {
      const res = await authFetch('/api/simulation/pause', {
        method: 'POST',
        body: JSON.stringify({ simId: lauf, on }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; pausedMs?: unknown; pauseSince?: unknown } | null;
      if (!res.ok || !json?.ok) {
        ohnePause();
        return;
      }
      if (pauseAnfrageRef.current !== anfrage) return;
      setPausen({
        pausedMs: typeof json.pausedMs === 'number' ? json.pausedMs : 0,
        pauseSince: typeof json.pauseSince === 'string' ? json.pauseSince : null,
      });
    } catch {
      ohnePause();
    }
  }
  function oeffnePause() {
    // Paket 1, C1: Der Dialog zeigt seine eigenen Fehler — eine ältere Meldung aus dem Gespräch gehört nicht hinein.
    setError(null);
    setTimeoutOpen(true);
    void setzePause(true);
  }
  function schliessePause() {
    setTimeoutOpen(false);
    void setzePause(false);
  }

  /** Paket 4: „Schreiben“ ist jederzeit erreichbar (Menü, Mikrofon-Check); das Sprachgespräch wird sauber getrennt. */
  function wechsleZuSchreiben() {
    stopLive();
    setWeg('schreiben');
    merkeWeg('schreiben');
    // Die Uhr stand während des Mikrofon-Checks; schreibend läuft sie ab jetzt.
    if (pausen.pauseSince && !timeoutOpen) void setzePause(false);
  }
  /**
   * Paket 4: „Sprechen“ aus dem Chat. Lief der Mikrofon-Check auf dieser Seite schon, verbindet es gleich; sonst
   * kommt er zuerst. C30: Der Tonweg entsteht im Klick selbst.
   */
  function wechsleZuSprechen() {
    stopDiktat();
    stopSpeaking();
    setError(null);
    live.vorbereiten();
    setMikroAusKlick(true);
    setWeg('sprechen');
    merkeWeg('sprechen');
    if (mikroGeprueft) void live.start({ eroeffnung: !turns.some((x) => x.role === 'user') });
  }
  /** „Los geht's“ im Mikrofon-Check. S1: Die Rolle eröffnet hörbar, solange die Person noch nichts gesagt hat. */
  function sprechenLos() {
    live.vorbereiten();
    setMikroGeprueft(true);
    void live.start({ eroeffnung: !turns.some((x) => x.role === 'user') });
  }
  /**
   * Der große Mikrofon-Knopf der Sprechansicht. S6: Steht die Verbindung, schaltet er stumm, ohne aufzulegen.
   * Ist sie zu (Stille, Abriss), verbindet er neu.
   */
  function mikroKnopf() {
    if (live.state === 'on') {
      live.setStumm(!live.stumm);
      return;
    }
    setError(null);
    live.vorbereiten();
    void live.start({ eroeffnung: !turns.some((x) => x.role === 'user') });
  }

  /** Laufende Sprachausgabe stoppen. */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopSpeaking = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      if (a.src.startsWith('blob:')) URL.revokeObjectURL(a.src);
      a.removeAttribute('src');
      audioRef.current = null;
    }
  }, []);

  /**
   * Persona-Antwort vorlesen — Azure-HD-Stimme der Persona (Server). Kann der Server nicht (503 nicht konfiguriert,
   * Netz, Autoplay-Sperre), bleibt es still; die Antwort steht als Text da.
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
        /* Vorlesen ist Komfort: ohne Ton geht das Gespräch als Text weiter. */
      }
    },
    [ttsSupported, stopSpeaking, scenario, convoLocale, ts.genericError]
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
  // Paket 4: Gibt es ein Mikrofon? Davon hängt die Vorwahl „Sprechen“ im Briefing ab (unbekannt gilt als vorhanden).
  useEffect(() => {
    if (view !== 'briefing') return;
    let aktuell = true;
    void (async () => {
      let geraete: Array<{ kind: string }> | null = null;
      try {
        geraete = (await navigator.mediaDevices?.enumerateDevices?.()) ?? null;
      } catch {
        geraete = null;
      }
      if (aktuell) setMikrofonDa(mikrofonVorhanden(geraete));
    })();
    return () => {
      aktuell = false;
    };
  }, [view]);

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

  // ── Paket 3, S8 (12.11.2026): Check-in in zwei Fragen ──
  // Mikrofon an oder aus und die Hinweise darüber zählen als Eingabe: Die 20 Sekunden beginnen neu.
  useEffect(() => {
    if (checkin) setCheckinInputAt(Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diktat.aktiv, diktat.startet, micNoticeOpen, consentUrl]);
  // Bleibt das Feld leer und ohne Eingabe, geht es nach 20 Sekunden von selbst weiter (Regel in checkin-ablauf.ts).
  useEffect(() => {
    if (!checkin || checkinBusy || micNoticeOpen || consentUrl) return;
    const rest = checkinAutoWeiterIn({
      text: input,
      diktatLaeuft: diktat.aktiv || diktat.startet,
      letzteEingabeMs: checkinInputAt,
      jetztMs: Date.now(),
    });
    if (rest == null) return;
    const id = window.setTimeout(() => checkinGo({ art: 'weiter', text: '' }), rest);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkin, checkinBusy, micNoticeOpen, consentUrl, input, diktat.aktiv, diktat.startet, checkinInputAt]);
  // Jede Frage beginnt mit dem Cursor im Feld.
  const checkinFrage = checkin?.frage ?? null;
  useEffect(() => {
    if (checkinFrage) checkinFieldRef.current?.focus();
  }, [checkinFrage]);

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
      const gewuenscht = new URLSearchParams(window.location.search).get('szenario');
      const res = await authFetch(
        gewuenscht ? `/api/simulation/scenarios?szenario=${encodeURIComponent(gewuenscht)}` : '/api/simulation/scenarios'
      );
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
      setProbe(json.probe ?? null);
      setRecent(json.recent ?? []);
      setInsight(json.insight ?? null);
      setPlayed(json.played ?? {});
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
  // öffnet direkt das Briefing des Szenarios; der Fokus steht dort (U19) und geht beim Start mit.
  useEffect(() => {
    if (view !== 'list' || scenarios.length === 0) return;
    const wanted = searchParams.get('szenario');
    if (!wanted) return;
    const s = scenarios.find((x) => x.id === wanted) ?? (probe?.id === wanted ? probe : undefined);
    if (!s) return;
    setBriefFocus(searchParams.get('fokus')?.trim() || null);
    setScenario(s);
    setError(null);
    setBriefStep(0);
    setConvoLocale(s.locale ?? 'de');
    setWegWunsch(null);
    setView('briefing');
    zaehlpunkt('briefing', s.id);
    // Query-Parameter verbrauchen — Reload soll wieder am Einstieg landen.
    router.replace('/', { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, scenarios, probe]);

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

  async function startSimulation(s: PublicScenario, withFocus?: string | null, wegStart: Weg = weg) {
    // Paket 4, C30: Der Tonweg entsteht im Klick selbst, noch vor dem ersten Warten (iOS gibt den Ton sonst nicht frei).
    if (wegStart === 'sprechen') live.vorbereiten();
    setStarting(true);
    setError(null);
    // Fokus aus dem Briefing (U19: dort sichtbar und entfernbar) oder vom Neustart desselben Szenarios.
    const focusToSend = withFocus ?? briefFocus ?? undefined;
    try {
      const res = await authFetch('/api/simulation/start', {
        method: 'POST',
        body: JSON.stringify({
          scenarioId: s.id,
          locale: convoLocale,
          mode: simMode,
          hardness: simHardness,
          // Paket 4, S24: nur für den Zählpunkt „Gespräch gestartet“.
          weg: wegStart,
          ...(focusToSend ? { focus: focusToSend } : {}),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        stopLive();
        handleApiFailure(res, json);
        return;
      }
      // Die Antwort sagt selbst, ob das Sprachgespräch für diesen Lauf geht (z. B. bei einem gerade vorbereiteten
      // Gespräch, das der Katalog noch nicht kennt): Dann bietet das Menü im Gespräch „Sprechen“ an.
      setScenario(typeof json.simulation.liveAvailable === 'boolean' ? { ...s, liveAvailable: json.simulation.liveAvailable } : s);
      setFreeEval(json.simulation.freeEval === true);
      setSimId(json.simulation.id);
      setTurns(json.simulation.turns);
      setAttempt(json.simulation.attempt ?? 1);
      setFocus(json.simulation.focus ?? null);
      setBriefFocus(null);
      setCheckinDone(false);
      setSimStartedAt(json.simulation.createdAt ?? new Date().toISOString());
      setPausen({ pausedMs: json.simulation.pausedMs ?? 0, pauseSince: json.simulation.pauseSince ?? null });
      setCoachNotes([]);
      setBriefingOpen(false);
      setTimeoutOpen(false);
      setTimeUp(false); setPersonaEnded(null);
      setWeg(wegStart);
      setMikroAusKlick(true);
      setView('chat');
      // Sprechen: zuerst der Mikrofon-Check. Lief er auf dieser Seite schon, eröffnet die Rolle gleich hörbar.
      if (wegStart === 'sprechen' && mikroGeprueft) void live.start({ eroeffnung: true, simId: json.simulation.id });
    } catch {
      stopLive();
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
    // Fertige Auswertungen haben eine eigene Adresse (W1-7). Paket 3 (12.11.2026): Läuft die Auswertung noch,
    // steht dort „Auswertung läuft“ mit dem Gespräch zum Nachlesen.
    if (item.status === 'finished' || item.status === 'finishing') {
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
      if (json.simulation.status === 'finished' || json.simulation.status === 'finishing') {
        router.push(`/simulation/${encodeURIComponent(item.id)}`);
        return true;
      }
      // Abgebrochene Läufe (z. B. über eine alte Adresse) werden nicht wieder geöffnet.
      if (json.simulation.status !== 'active') {
        setError(json.simulation.status === 'aborted' ? ts.runAborted : ts.genericError);
        return false;
      }
      const basis = scenarioById.get(json.simulation.scenarioId) ?? (json.scenario as PublicScenario | null);
      if (!basis) {
        setError(ts.scenarioGone);
        return false;
      }
      // Live-Prüfung 12.11.2026: Ob „Sprechen“ geht, sagt die Antwort zum Lauf (wie beim Start). Vorher fehlte die
      // Angabe, wenn das Szenario nicht im geladenen Katalog stand.
      const s: PublicScenario =
        typeof json.simulation.liveAvailable === 'boolean' ? { ...basis, liveAvailable: json.simulation.liveAvailable } : basis;
      setScenario(s);
      setFreeEval(json.simulation.freeEval === true);
      setSimId(json.simulation.id);
      setTurns(json.simulation.turns);
      setAttempt(json.simulation.attempt ?? 1);
      setFocus(json.simulation.focus ?? null);
      setCheckinDone(json.simulation.checkin != null);
      setSimStartedAt(json.simulation.createdAt ?? item.createdAt ?? null);
      setPausen({ pausedMs: json.simulation.pausedMs ?? 0, pauseSince: json.simulation.pauseSince ?? null });
      // Eine Pause, die beim Verlassen der Seite offen blieb, endet jetzt (sonst erst an ihrem Deckel).
      if (json.simulation.pauseSince) void setzePause(false, json.simulation.id);
      setCoachNotes(json.simulation.coachNotes ?? []);
      setConvoLocale(json.simulation.convoLocale ?? s.locale ?? 'de');
      setSimMode(json.simulation.mode ?? 'practice');
      setSimHardness(json.simulation.hardness ?? 'standard');
      setTimeUp(json.simulation.timeUp === true);
      setPersonaEnded(json.simulation.ende ?? null);
      setBriefingOpen(false);
      // Paket 4: Sprechen nur, wenn die Person es auf diesem Gerät zuletzt selbst gewählt hat und das Gespräch noch
      // offen ist. Dann steht zuerst der Mikrofon-Check (ohne Klick davor: mit dem Knopf „Mikrofon einschalten“).
      const offen = json.simulation.timeUp !== true && !json.simulation.ende;
      setWeg(
        offen
          ? wegBeimFortsetzen({
              liveAvailable: s.liveAvailable === true,
              liveTon: liveAudioSupported(),
              mikrofon: mikrofonDa,
              gemerkt: liesGemerktenWeg(),
            })
          : 'schreiben'
      );
      setMikroAusKlick(false);
      setView('chat');
      return true;
    } catch {
      setError(ts.genericError);
      return false;
    }
  }

  async function sendTurn() {
    const message = input.trim();
    // Im Sprachgespräch geht nichts über den Textweg — die Rolle hört dort nur, was gesprochen wird.
    // Nach dem Ende durch die Rolle oder nach „Zeit um“ bleibt nur die Auswertung.
    if (!message || !simId || sending || weg === 'sprechen' || timeUp || personaEnded) return;
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

  /**
   * Paket 3 (U12, S7; 12.11.2026): „Ja, auswerten“ startet die Auswertung sofort. Die Route antwortet gleich mit dem
   * Zustand des Laufs (202 `finishing`, 200 `finished`); gerechnet wird auf dem Server. Währenddessen läuft der
   * Check-in, gewartet wird hier nicht mehr. Fehler (kein Guthaben, zu wenige Beiträge, Limit) stehen im Dialog.
   */
  async function startEvaluation() {
    if (!simId || finishing) return;
    stopMic();
    setFinishing(true);
    setError(null);
    try {
      const res = await authFetch('/api/simulation/finish', {
        method: 'POST',
        body: JSON.stringify({ simId }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        handleApiFailure(res, json);
        return;
      }
      // Header-Saldo nachladen — die Auswertung hat gerade 1 Credit gekostet.
      window.dispatchEvent(new Event(CREDITS_REFRESH_EVENT));
      // Das geteilte Eingabefeld wird geleert — ein liegengebliebener Entwurf gehört zum beendeten Gespräch.
      setInput('');
      if (checkinDone) {
        // Der Check-in liegt schon vor (zweiter Anlauf nach einer gescheiterten Auswertung): gleich zur Auswertung.
        router.push(`/simulation/${encodeURIComponent(simId)}`);
        return;
      }
      setConfirmOpen(false);
      setCheckinInputAt(Date.now());
      setCheckin(checkinStart());
    } catch {
      setError(ts.genericError);
    } finally {
      setFinishing(false);
    }
  }

  /** Ein Schritt im Check-in: „Weiter“ (auch nach 20 Sekunden ohne Eingabe) oder „Überspringen“. */
  function checkinGo(aktion: CheckinAktion) {
    if (!checkin || checkinBusy) return;
    stopMic();
    const folge = checkinSchritt(checkin, aktion);
    setInput('');
    setError(null);
    setCheckinInputAt(Date.now());
    if (!folge.fertig) {
      setCheckin(folge.stand);
      return;
    }
    void submitCheckin(folge.body);
  }

  /**
   * Antworten speichern, dann sofort zur Auswertungsseite (W1-7: eigene Adresse, Reload-fest). Auf die Antwort der
   * Route warten wir höchstens zwei Sekunden: So liegen die Antworten in aller Regel vor, wenn die Seite lädt, und
   * ein langsamer oder gescheiterter Aufruf hält niemanden auf — dann fehlt dort nur der Abgleich mit dem Selbstbild.
   */
  async function submitCheckin(body: CheckinBody) {
    if (!simId) return;
    setCheckinBusy(true);
    const gesendet = authFetch('/api/simulation/checkin', {
      method: 'POST',
      body: JSON.stringify({ simId, ...body }),
    }).catch(() => null);
    await Promise.race([gesendet, new Promise((resolve) => window.setTimeout(resolve, 2000))]);
    router.push(`/simulation/${encodeURIComponent(simId)}`);
  }

  function backToList() {
    // Eine offene Coach-Pause endet mit dem Verlassen (die Uhr läuft dann weiter, wie der Dialog es sagt).
    if (timeoutOpen) void setzePause(false);
    setWegWunsch(null);
    setScenario(null);
    setSimId(null);
    setTurns([]);
    setFocus(null);
    setAttempt(1);
    setCoachNotes([]);
    setError(null);
    setConfirmOpen(false);
    setCheckin(null);
    setBriefFocus(null);
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
    // Paket 3 (12.11.2026): Läufe, deren Auswertung gerade rechnet, stehen hier als „Auswertung läuft“.
    const activeSims = recent.filter((r) => r.status === 'active' || r.status === 'finishing');
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
    // U15 (Owner-Entscheid 12.11.2026): Empfehlung aus der schwächsten Fähigkeit der jüngsten Auswertung; das
    // gerade gespielte Szenario steht nicht zuerst. Bewertet kein Szenario des Katalogs diese Fähigkeit (z. B. nach
    // einem selbst vorbereiteten Gespräch), gilt der Kaltstart — sonst stünde die Begründung über fremden Karten.
    const recoSkill =
      insight && grundszenarien.some((s) => s.competencies.some((c) => c.key === insight.skill)) ? insight.skill : null;
    const recommended = recommendScenarios(grundszenarien, recoSkill, 3, insight?.scenarioId ?? null);
    const recoFaehigkeit = recoSkill ? faehigkeit(recoSkill) : undefined;
    const recoName = recoFaehigkeit ? faehigkeitText(recoFaehigkeit, locale).titel : (insight?.label ?? recoSkill ?? '');
    // U21 (12.11.2026): Die Liste ist nach Stufe geordnet, und die Empfehlungen stehen darin nicht noch einmal.
    // Wer nach einer Kategorie filtert, sieht diese Kategorie vollständig.
    const visibleScenarios =
      categoryFilter === 'all'
        ? catalogOrder(grundszenarien, recommended)
        : catalogOrder(grundszenarien.filter((s) => s.category === categoryFilter));
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
      setBriefFocus(null);
      setScenario(s);
      setError(null);
      setBriefStep(0);
      setConvoLocale(s.locale ?? 'de');
      setWegWunsch(null);
      setView('briefing');
      zaehlpunkt('briefing', s.id);
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
        {/* U21 (12.11.2026): schon gespielt, mit dem besten Ergebnis aus den eigenen abgeschlossenen Läufen. */}
        {played[s.id] && (
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground" data-testid="played">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
            {played[s.id].best != null
              ? t.entry.playedBest.replace('{pct}', String(played[s.id].best))
              : t.entry.played}
          </div>
        )}
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
            {startCost}
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
                  // Paket 3 (12.11.2026): Die Auswertung rechnet — die Zeile führt zur Auswertungsseite, ohne
                  // Restzeit und ohne Mülleimer.
                  const evaluating = r.status === 'finishing';
                  const confirming = pendingDeleteId === r.id;
                  // W2-1: Restzeit im Fortsetzen-Streifen — die Zeitbox läuft
                  // ab Start in Echtzeit, auch außerhalb der Seite.
                  // Live-Prüfung 12.11.2026: gerechnet mit der gemeinsamen Uhr (zeit.ts) — Coach-Pausen und der
                  // Mikrofon-Check zählen nicht zur Gesprächszeit. Vorher zeigte die Liste weniger Zeit als das Gespräch.
                  const stand = uhrStand(r, s.durationMin * 60_000, Date.now());
                  const remainMs = stand?.restMs ?? 0;
                  const remainMin = stand?.restMin ?? 0;
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
                            evaluating
                              ? 'bg-primary/10 text-primary border-primary/20'
                              : remainMs > 0
                                ? 'bg-sky-500/15 text-sky-800 dark:text-sky-400 border-sky-500/30'
                                : 'bg-amber-500/15 text-amber-800 dark:text-amber-500 border-amber-500/30'
                          )}
                          data-testid={evaluating ? 'resume-evaluating' : undefined}
                        >
                          {evaluating
                            ? t.entry.resumeEvaluating
                            : remainMs > 0
                              ? t.entry.resumeTimeLeft.replace('{min}', String(remainMin))
                              : t.entry.resumeTimeUp}
                        </span>
                        {/* Mülleimer mit zweistufiger Bestätigung (endgültig, inkl. DB) */}
                        {evaluating ? null : confirming ? (
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
                    {/* Go-Live-Prüfung 12.11.2026: Entfernen in zwei Schritten. Vorher löschte ein Klick das Gespräch,
                        das 1 Credit gekostet hat, ohne Nachfrage. */}
                    {pendingDeleteId === s.id ? (
                      <span className="self-end flex items-center gap-3 text-xs" data-testid="prep-remove-confirm">
                        <span className="font-medium text-rose-800 dark:text-rose-400">{ts.deleteConfirm}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setPendingDeleteId(null);
                            void removeVorbereitet(s.id);
                          }}
                          className="font-medium text-rose-800 underline hover:opacity-80 dark:text-rose-400"
                        >
                          {t.entry.prepRemove}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDeleteId(null)}
                          className="text-muted-foreground underline hover:text-foreground"
                        >
                          {t.common.cancel}
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPendingDeleteId(s.id)}
                        className="self-end text-xs text-muted-foreground underline hover:text-foreground"
                      >
                        {t.entry.prepRemove}
                      </button>
                    )}
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
                {recoSkill ? t.entry.recoReason.replace('{c}', recoName) : t.entry.coldStartFrame}
              </p>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {recommended.map((s) => scenarioCard(s, true))}
              </div>
            </section>
          )}

          {/* ── U22 (12.11.2026): „Mein echtes Gespräch vorbereiten“ — direkt unter den Empfehlungen, vor der
              Gesamtliste, als eigener Streifen (Welle 4: für alle, privat). „Szenario wünschen“ bleibt am Ende
              der Liste. ── */}
          <button
            onClick={() => {
              setVorbError(null);
              setVorbOpen(true);
            }}
            data-testid="prep-card"
            className="pn-tile glass-panel w-full rounded-2xl border border-primary/40 p-4 sm:p-5 text-left flex items-center gap-4 transition-colors"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <MessagesSquare className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold leading-snug">{t.entry.prepTitle}</span>
              <span className="mt-0.5 block text-sm text-muted-foreground leading-relaxed">{t.entry.prepBody}</span>
              <span className="mt-1 block text-xs font-semibold text-primary sm:hidden">{t.entry.prepCta} →</span>
            </span>
            <span className="hidden sm:inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-primary">
              {t.entry.prepCta} <ArrowRight className="h-4 w-4" />
            </span>
          </button>

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
            {/* Geister-Karte (W1-5): der Wunsch wird Nachfrage-Statistik. */}
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
          <p className="text-xs text-muted-foreground text-center">{startCost}</p>
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
    // Paket 4, U1 und S1 (Owner-Entscheid 12.11.2026): Wahl „Sprechen | Schreiben“ direkt über dem Startknopf.
    // Die Vorwahl ist eine reine Entscheidung (src/lib/simulation/weg-wahl.ts); eine eigene Wahl im Briefing geht vor.
    const vorwahl = wegVorwahl({
      liveAvailable: scenario.liveAvailable === true,
      liveTon: liveAudioSupported(),
      mikrofon: mikrofonDa,
      gemerkt: liesGemerktenWeg(),
    });
    const briefWeg: Weg = vorwahl.wahl ? (wegWunsch ?? vorwahl.weg) : 'schreiben';
    // U25: Wahl und Start stehen am Rechner am Porträt (immer im Bild) und am Handy als feste Leiste am unteren Rand —
    // dort nicht mehr über Situation und Zielen.
    const startBlock = (aufBild: boolean) => (
      <div className="space-y-3">
        {vorwahl.wahl && (
          <WegWahl
            weg={briefWeg}
            onChange={(w) => {
              setWegWunsch(w);
              merkeWeg(w);
            }}
            aufBild={aufBild}
            disabled={starting}
            texte={{
              titel: ts.wegTitle,
              sprechen: ts.wegSprechen,
              schreiben: ts.wegSchreiben,
              hinweis: briefWeg === 'sprechen' ? ts.wegSprechenNote.replace('{name}', scenario.persona.name) : ts.wegSchreibenNote,
            }}
          />
        )}
        <button
          onClick={() => void startSimulation(scenario, undefined, briefWeg)}
          disabled={starting}
          className="w-full btn-gradient text-white font-semibold rounded-xl px-6 py-3 flex items-center justify-center gap-2 shadow-neon disabled:opacity-60"
        >
          {starting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
          {ts.startCta}
        </button>
      </div>
    );
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

          {/* U19 (12.11.2026): Der Fokus aus „Nochmal üben mit Fokus“ steht sichtbar im Briefing, über beiden
              Spalten (am Handy also vor dem Start-Knopf), und lässt sich hier entfernen. */}
          {briefFocus && (
            <div
              className="pn-none rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 flex items-start gap-2 text-sm"
              data-testid="brief-focus"
            >
              <Sparkles className="h-4 w-4 text-accent shrink-0 mt-0.5" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="leading-relaxed break-words">
                  <span className="font-semibold text-accent">{ts.briefFocusLabel}: </span>
                  {briefFocus}
                </p>
                <button
                  type="button"
                  onClick={() => setBriefFocus(null)}
                  className="mt-1 text-xs text-muted-foreground underline hover:text-foreground"
                >
                  {ts.briefFocusRemove}
                </button>
              </div>
            </div>
          )}

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
                {/* U26 (12.11.2026): Stufe, Härtegrad und Prüfung an EINER Stelle erklärt; überall sonst steht
                    nur noch der Wert. */}
                <ul className="mt-3 space-y-1 text-xs text-muted-foreground leading-relaxed" data-testid="difficulty-help">
                  <li>{ts.difficultyHelpLevel}</li>
                  <li>{ts.difficultyHelpHardness}</li>
                  <li>{ts.difficultyHelpCheck}</li>
                </ul>
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
                  <div className="hidden lg:block">{startBlock(true)}</div>
                  {/* W2-1: ehrliche Zeitbox — die Uhr läuft ab Start in Echtzeit. */}
                  <div className="text-xs text-white/80 leading-snug">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {ts.timeboxHonest.replace('{min}', String(simMode === 'check' ? (scenario.checkDurationMin ?? scenario.durationMin) : scenario.durationMin))}
                    </span>
                  </div>
                  {/* W2-4: Preis VOR der Entscheidung, nicht erst im Dialog (am Handy in der Leiste beim Startknopf). */}
                  <div className="hidden lg:block text-[11px] text-white/65">{startCost}</div>
                  {/* EU-KI-VO Art. 50 (T1.5, Owner-GO 25.09.): Interaktions-Hinweis VOR dem Start —
                      sichtbar, nicht wegklickbar. U4 (Paket 4): Hier steht er einmal; im Gespräch trägt der Name
                      der Rolle das Kennzeichen „KI-Rolle“. */}
                  <div className="text-[11px] text-white/85 inline-flex items-center justify-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span>{ts.aiStartNotice}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Paket 4, U25: Am Handy stehen Wahl und Start als feste Leiste am unteren Rand (am Ende des Briefings,
              beim Rollen immer im Bild) — nicht mehr über Situation und Zielen. */}
          <div
            className="lg:hidden sticky bottom-0 z-20 -mx-4 -mb-4 border-t border-border bg-card/95 backdrop-blur px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-2"
            data-testid="brief-start-bar"
          >
            {startBlock(false)}
            {startCost && <div className="text-center text-[11px] text-muted-foreground">{startCost}</div>}
          </div>
        </div>
      </AppShell>
    );

    /* Kontext-Treppe (Tabs + Inhalt) — unverändert, nur in die linke Spalte gezogen. */
    function renderBriefSteps() {
      return (
        <>
          {/* Treppen-Navigation. U25 (Paket 4): Am Handy stehen die Namen der Reiter da (vorher nur Symbole mit
              Ziffern); die Zeile rollt waagerecht, kein Wort wird abgeschnitten. Der gewählte Reiter rollt ins Bild. */}
          <div className="relative flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
            {steps.map((st, i) => (
              <button
                key={i}
                onClick={() => setBriefStep(i)}
                ref={(el) => {
                  const zeile = el?.parentElement;
                  if (!el || !zeile || i !== briefStep) return;
                  if (el.offsetLeft < zeile.scrollLeft) zeile.scrollLeft = el.offsetLeft;
                  else if (el.offsetLeft + el.offsetWidth > zeile.scrollLeft + zeile.clientWidth)
                    zeile.scrollLeft = el.offsetLeft + el.offsetWidth - zeile.clientWidth;
                }}
                className={cx(
                  'pn-none shrink-0 sm:flex-1 flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-2 text-xs font-semibold transition-colors',
                  i === briefStep
                    ? 'border-primary/50 bg-primary/10 text-primary'
                    : i < briefStep
                      ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-400'
                      : 'border-border text-muted-foreground hover:text-foreground'
                )}
              >
                <st.icon className="h-3.5 w-3.5 shrink-0" />
                {st.label}
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
    // ── W2-1: sichtbare Uhr (Client-Anzeige; Server-Zeitregie bleibt Wahrheit). Paket 4, C13 und U5: Sie rechnet
    //    mit den Pausen des Laufs und steht in der Coach-Pause (src/lib/simulation/gespraechs-uhr.ts). ──
    const limitMs =
      (simMode === 'check'
        ? (scenario.checkDurationMin ?? scenario.durationMin)
        : scenario.durationMin) * 60_000;
    const uhr = uhrStand(simStartedAt ? { createdAt: simStartedAt, ...pausen } : null, limitMs, nowTs);
    const remainingMin = uhr ? uhr.restMin : null;
    /**
     * Zeit ist um — ODER die sichtbare Uhr steht auf 0:00 (Test-Fund 11.08.):
     * Das Server-Flag entsteht erst beim NÄCHSTEN Beitrag. Ohne diese Zeile
     * zeigt ein zwischenzeitlich abgelaufener Lauf eine rote 0:00 UND eine
     * offene Eingabe — der Nutzer tippt ins Leere und bekommt erst danach die
     * Verabschiedung. Der Server bleibt die Wahrheit, der Client läuft ihm
     * nur nicht mehr hinterher.
     */
    const effTimeUp = timeUp || (uhr?.um ?? false);
    // ── W2-2: Totsackgasse — Zeit um, aber kein auswertbares Gespräch ──
    const deadEnd = effTimeUp && userTurnCount < 3;
    // Paket 3 (12.11.2026): Nach „Zeit um“ UND nach dem Ende durch die Rolle ist die Eingabe zu — es bleibt nur
    // die Auswertung. Vorher blieb das Feld nach dem Ende durch die Rolle offen.
    const inputClosed = effTimeUp || !!personaEnded;
    const b = scenario.candidateBriefing;
    const personaName = scenario.persona.name;
    // ── Paket 4: Sprechen oder Schreiben. Sprechen geht nur, wo das Szenario es erlaubt und der Browser Live-Ton kann. ──
    const sprechenMoeglich = scenario.liveAvailable === true && liveAudioSupported();
    const imSprechen = weg === 'sprechen';
    /** Vor dem ersten Wort steht der Mikrofon-Check (einmal je Seite). */
    const imCheck = imSprechen && !mikroGeprueft;
    /** Weg in den Ablauf am Gesprächsende (Bestätigung → Auswertung startet → Check-in → Auswertungsseite). */
    const auswerten = () => {
      stopMic();
      setConfirmOpen(true);
    };

    // W2-1: Countdown — passiv, keine Bewertung. In der Coach-Pause steht er („angehalten“).
    const uhrAnzeige = uhr && (
      <span
        className={cx(
          'text-sm font-semibold rounded-lg px-2.5 py-2 border tabular-nums flex items-center gap-1.5 whitespace-nowrap',
          effTimeUp
            ? 'border-rose-500/40 text-rose-800 dark:text-rose-400 bg-rose-500/10'
            : uhr.warn
              ? 'border-amber-500/40 text-amber-800 dark:text-amber-500 bg-amber-500/10'
              : 'border-border text-muted-foreground'
        )}
        title={ts.timeboxHonest.replace('{min}', String(scenario.durationMin))}
        data-testid="gespraechs-uhr"
      >
        <Clock className="hidden sm:block h-4 w-4" /> {effTimeUp ? '0:00' : uhr.text}
        {uhr.angehalten && !effTimeUp && <span className="text-xs font-medium">· {ts.clockPaused}</span>}
      </span>
    );

    // Zeit-Regie (Owner-Vorgabe 04.08.) und Welle 2: Nach „Zeit um“ oder dem Ende durch die Rolle bleibt nur die
    // Auswertung. Im Chat steht die Karte über dem Eingabefeld, in der Sprechansicht über den Knöpfen.
    const auswertenKnopf = (
      <button
        onClick={auswerten}
        disabled={finishing}
        className="btn-gradient text-white font-semibold rounded-lg px-4 py-2 text-sm flex items-center gap-1.5 disabled:opacity-50"
      >
        <Sparkles className="h-4 w-4" /> {ts.evaluateCta}
      </button>
    );
    const endeKarte =
      personaEnded && !deadEnd ? (
        <div className="pn-none rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-sm text-left">
          <span className="flex flex-col gap-0.5">
            <span className="font-semibold text-emerald-800 dark:text-emerald-300">{ts.endedByPersona.replace('{name}', personaName)}</span>
            <span className="text-muted-foreground">
              {personaEnded.ergebnis === 'ziel' ? ts.endedZiel : personaEnded.ergebnis === 'abbruch' ? ts.endedAbbruch : ts.endedVerabschiedung} {ts.endedHint}
            </span>
          </span>
          {auswertenKnopf}
        </div>
      ) : effTimeUp && !deadEnd ? (
        <div className="pn-none rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-sm text-left">
          <span className="flex items-center gap-2 text-amber-800 dark:text-amber-400">
            <Clock className="h-4 w-4 shrink-0" /> {ts.timeUpBanner}
          </span>
          {auswertenKnopf}
        </div>
      ) : null;
    // Welle 2: Statuszeile im Sprachgespräch — Stille-Vorwarnung, Verbindung kurz weg, wieder da. Erscheint nur im Fall.
    const liveZeile =
      live.hinweis && !inputClosed ? (
        <div
          className={cx(
            'pn-none text-sm rounded-lg px-3 py-2 border flex items-center gap-2 text-left',
            live.hinweis.kind === 'reconnected'
              ? 'border-emerald-500/40 text-emerald-800 dark:text-emerald-300 bg-emerald-500/10'
              : live.hinweis.kind === 'reconnecting'
                ? 'border-rose-500/40 text-rose-700 dark:text-rose-300 bg-rose-500/10'
                : 'border-amber-500/40 text-amber-800 dark:text-amber-400 bg-amber-500/10'
          )}
          role="status"
        >
          <span
            className={cx(
              'h-2 w-2 shrink-0 rounded-full',
              live.hinweis.kind === 'reconnected' ? 'bg-emerald-500' : live.hinweis.kind === 'reconnecting' ? 'bg-rose-500' : 'bg-amber-500'
            )}
          />
          {live.hinweis.kind === 'idle'
            ? ts.liveIdleWarn.replace('{s}', String(live.hinweis.seconds ?? 60))
            : live.hinweis.kind === 'reconnecting'
              ? ts.liveReconnecting
              : ts.liveReconnected}
        </div>
      ) : null;
    // Paket 1, C1 (12.11.2026): Die Meldung steht dort, wo die Person gerade hinsieht (über dem Eingabefeld bzw.
    // über den Knöpfen). W2-3: kein doppelter Fehlerbanner — im offenen Dialog zeigt der Dialog.
    const fehlerZeile =
      error && !confirmOpen && !checkin && !timeoutOpen ? <div role="alert">{errorBanner}</div> : null;

    // Ziele und das vollständige Briefing inkl. Faktenblatt: im Chat im Streifen oben, in der Sprechansicht über das Menü.
    const zielePunkte = b.goals.map((g, idx) => (
      <li key={idx} className="flex gap-1.5">
        <span className="text-primary font-bold shrink-0">{idx + 1}.</span>
        <span>{g}</span>
      </li>
    ));
    const briefingInhalt = (
      <div className="space-y-3 text-sm">
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
    );

    // Paket 4: Menü „⋯“. Der Wechsel „Schreiben“ ↔ „Sprechen“ ist jederzeit erreichbar; dazu der Ton
    // (Sprechansicht: Ton der Rolle, Chat: Antworten vorlesen), das Briefing und die Hilfe zum Sprechen.
    const menuePunkt = 'gap-2 cursor-pointer';
    const menue =
      imCheck || (!imSprechen && !sprechenMoeglich && !ttsSupported) ? null : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={ts.menuMore}
              title={ts.menuMore}
              className="pn-none rounded-lg border border-border p-2 text-muted-foreground hover:text-foreground transition-colors"
              data-testid="gespraech-menue"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {imSprechen ? (
              <>
                <DropdownMenuItem onSelect={wechsleZuSchreiben} className={menuePunkt}>
                  <Keyboard /> {ts.menuToWrite}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => live.setTonAus(!live.tonAus)} className={menuePunkt}>
                  {live.tonAus ? <Volume2 /> : <VolumeX />} {live.tonAus ? ts.menuSoundOn : ts.menuSoundOff}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setBriefingOpen(true)} className={menuePunkt}>
                  <FileText /> {ts.briefingShow}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setHelpOpen(true)} className={menuePunkt}>
                  <HelpCircle /> {ts.menuHelp}
                </DropdownMenuItem>
              </>
            ) : (
              <>
                {sprechenMoeglich && (
                  <DropdownMenuItem onSelect={wechsleZuSprechen} disabled={inputClosed || sending} className={menuePunkt}>
                    <Mic /> {ts.menuToSpeak}
                  </DropdownMenuItem>
                )}
                {ttsSupported && (
                  <DropdownMenuItem
                    onSelect={() => {
                      if (speakReplies) stopSpeaking();
                      setSpeakReplies((v) => !v);
                    }}
                    className={menuePunkt}
                  >
                    {speakReplies ? <VolumeX /> : <Volume2 />} {speakReplies ? ts.ttsOff : ts.ttsOn}
                  </DropdownMenuItem>
                )}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      );

    return (
      // Paket 4, U3: Im Gespräch zeigt die Kopfzeile nur Zurück, den Namen der Rolle mit dem Kennzeichen „KI-Rolle“
      // (U4), die Uhr und die Knöpfe des Gesprächs. „Credits aufladen“, Sprachwahl und Avatar entfallen hier.
      <AppShell
        title={imCheck ? ts.micCheckTitle : personaName}
        subtitle={imCheck ? undefined : scenario.persona.role}
        noPadding
        gespraech={{
          // W2-3: Ausgang aus dem Gespräch — der Lauf bleibt offen.
          zurueck: () => setLeaveOpen(true),
          zurueckLabel: ts.backToList,
          kennzeichen: imCheck ? undefined : ts.aiRoleBadge,
          ohneTitel: imSprechen && !imCheck,
        }}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
            {/* Im Mikrofon-Check steht nur der Weg zurück: Die Person prüft dort ihr Mikrofon, sonst nichts. */}
            {!imCheck && uhrAnzeige}
            {simMode === 'check' && !imCheck && (
              <span className="text-xs font-semibold rounded-lg px-2.5 py-2 border border-amber-500/40 text-amber-800 dark:text-amber-400 bg-amber-500/10 inline-flex items-center gap-1.5">
                <Flag className="h-3.5 w-3.5" /> {ts.modeCheckBadge}
              </span>
            )}
            {/* Im Chat stehen Coach-Pause und Beenden im Kopf (am Handy als Symbol); in der Sprechansicht stehen sie
                unten in Daumenhöhe. */}
            {!imSprechen && simMode !== 'check' && (
              <button
                onClick={oeffnePause}
                disabled={userTurnCount < 1 || timeoutsLeft === 0}
                className="pn-none text-sm font-semibold rounded-lg px-2.5 py-2 border border-accent/40 text-accent hover:bg-accent/10 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                aria-label={ts.timeoutCta}
              >
                <Pause className="h-4 w-4" /> <span className="hidden sm:inline">{ts.timeoutCta}</span>
                {/* W2-4: Zähler mit Legende statt nacktem 0/3 */}
                <span className="text-[10px] tabular-nums" title={ts.timeoutCounterLegend}>
                  {coachNotes.length}/{timeoutsMax}
                </span>
              </button>
            )}
            {/* W2-3: erst ab 3 eigenen Beiträgen aktiv. Nach Zeitablauf übernimmt das Banner — kein doppelter
                Auswerten-Knopf. U11: Hat die Rolle beendet, gibt es nichts mehr zu beenden — nur „Auswerten“. */}
            {!imSprechen && !effTimeUp && (
              <button
                onClick={auswerten}
                disabled={finishing || userTurnCount < 3}
                className="pn-none text-sm font-semibold rounded-lg px-2.5 py-2 border border-primary/40 text-primary hover:bg-primary/10 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                title={userTurnCount < 3 ? ts.finishNeedsTurns : undefined}
                aria-label={personaEnded ? ts.evaluateCta : ts.finishCta}
              >
                <Flag className="h-4 w-4" /> <span className="hidden sm:inline">{personaEnded ? ts.evaluateCta : ts.finishCta}</span>
              </button>
            )}
            {menue}
          </div>
        }
      >
        {imCheck ? (
          <MikrofonCheck
            key={simId ?? 'check'}
            personaName={personaName}
            vorbereiten={live.vorbereiten}
            ausKlick={mikroAusKlick}
            onLos={sprechenLos}
            onSchreiben={wechsleZuSchreiben}
            onZaehlpunkt={(schritt) => zaehlpunkt(schritt, scenario.id, 'sprechen')}
          />
        ) : imSprechen ? (
          <Sprechansicht
            name={personaName}
            rolle={scenario.persona.role}
            portrait={portraitOf(scenario)}
            zustand={rolleZustand({
              verbunden: live.state === 'on',
              verbindet: live.state === 'connecting' || live.busy,
              ton: live.spricht,
              denkt: live.denkt,
              mikroAn: !live.stumm && !timeoutOpen,
            })}
            turns={turns}
            laufendDu={live.you}
            laufendRolle={live.persona}
            banner={
              endeKarte || liveZeile || fehlerZeile ? (
                <>
                  {endeKarte}
                  {liveZeile}
                  {fehlerZeile}
                </>
              ) : undefined
            }
            pause={
              simMode === 'check'
                ? null
                : { onClick: oeffnePause, disabled: userTurnCount < 1 || timeoutsLeft === 0, zaehler: `${coachNotes.length}/${timeoutsMax}` }
            }
            mikro={{
              an: live.state === 'on' && !live.stumm,
              disabled: inputClosed || live.busy || live.state === 'connecting',
              onClick: mikroKnopf,
            }}
            beenden={{
              label: inputClosed ? ts.evaluateCta : ts.endShort,
              onClick: auswerten,
              disabled: finishing || userTurnCount < 3,
              title: userTurnCount < 3 ? ts.finishNeedsTurns : undefined,
            }}
          />
        ) : (
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
              <ol className={cx('mt-1 space-y-0.5 text-xs leading-snug', !goalsOpen && 'hidden sm:block')}>{zielePunkte}</ol>
            </div>
            {briefingOpen && (
              <div className="border-t border-border/60 px-4 py-3 max-h-80 overflow-y-auto custom-scrollbar">
                <div className="max-w-3xl mx-auto">{briefingInhalt}</div>
              </div>
            )}
          </div>

          {/* Nachrichten. U4 (Paket 4): Der KI-Hinweis steht nicht mehr über dem Verlauf; der Name der Rolle im Kopf
              trägt das Kennzeichen „KI-Rolle“. */}
          <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4">
            <div className="max-w-3xl mx-auto space-y-3">
              <GespraechsBlasen
                turns={turns}
                personaName={personaName}
                portrait={portraitOf(scenario)}
                wartet={sending ? `${personaName} ${ts.personaTyping}` : null}
              />
            </div>
          </div>

          {/* Eingabe */}
          <div className="border-t border-border p-3">
            {/* U4 (Paket 4): Die KI-Zeile über dem Eingabefeld entfällt (CP-3.3 bleibt erfüllt: Der Hinweis steht vor
                dem Start im Briefing, und das Kennzeichen „KI-Rolle“ am Namen ist im ganzen Gespräch sichtbar). */}
            {endeKarte && <div className="max-w-3xl mx-auto mb-2">{endeKarte}</div>}
            {diktat.aktiv && !inputClosed && (
              <div className="max-w-3xl mx-auto mb-2 flex items-center gap-2 text-xs text-primary">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
                {ts.micLive}
              </div>
            )}
            {fehlerZeile && <div className="max-w-3xl mx-auto mb-2">{fehlerZeile}</div>}
            <div className="max-w-3xl mx-auto flex items-end gap-2">
              {/* Im Check-in gehört der geteilte Text ins Feld des Dialogs, nicht ins Gespräch dahinter. */}
              <textarea
                value={checkin ? '' : input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void sendTurn();
                  }
                }}
                rows={2}
                placeholder={inputClosed ? ts.inputClosed : ts.inputPlaceholder}
                disabled={inputClosed}
                className="pn-field flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
              />
              {/* Paket 4: Der Mikrofon-Knopf diktiert ins Eingabefeld und heißt auch so; das Sprachgespräch startet
                  er nie mehr. Paket 1, C11: Während das Diktat startet, ist der Knopf gesperrt. */}
              {diktat.supported && !inputClosed && (
                <button
                  onClick={() => (diktat.aktiv ? diktat.stop() : startDictation())}
                  disabled={diktat.startet}
                  className={cx(
                    'pn-none relative rounded-xl p-3 border transition-colors disabled:opacity-50',
                    diktat.aktiv
                      ? 'border-primary/60 text-primary bg-primary/10 shadow-neon'
                      : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
                  )}
                  aria-label={diktat.aktiv ? ts.micStop : ts.micStart}
                  title={diktat.aktiv ? ts.micStop : ts.micStart}
                >
                  {/* Owner-Befund 19.09.: animate-ping skalierte den Ring auf 2x und ragte 9 px in den
                      scrollbaren Gesprächsbereich → Scrollbar flackerte im Sekundentakt → die Seite
                      wackelte rechts-links. Pulsieren ohne Wachsen hält das Layout still. */}
                  {diktat.aktiv && (
                    <span className="absolute inset-0 rounded-xl border-2 border-primary/50 animate-pulse pointer-events-none" aria-hidden />
                  )}
                  <Mic className="h-5 w-5" />
                </button>
              )}
              <button
                onClick={() => void sendTurn()}
                disabled={sending || !input.trim() || inputClosed}
                className="btn-gradient text-white rounded-xl p-3 shadow-neon disabled:opacity-50"
                aria-label={ts.send}
              >
                <Send className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
        )}

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
                    // Direkter Neustart: gleiches Szenario, gleicher Fokus, gleicher Weg.
                    // C30: Der Tonweg für „Sprechen“ entsteht im Klick, vor dem ersten Warten.
                    if (weg === 'sprechen') live.vorbereiten();
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

        {/* Time-out-Coach (D3) — Szene angehalten. Paket 4, C13 und U5: Uhr und Mikrofon stehen wirklich still. */}
        {timeoutOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="pn-none glass-panel rounded-2xl border border-accent/40 p-6 max-w-lg w-full space-y-4 bg-card max-h-[85dvh] overflow-y-auto custom-scrollbar">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold text-lg flex items-center gap-2">
                  <Pause className="h-5 w-5 text-accent" /> {ts.timeoutTitle}
                </h3>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {coachNotes.length}/{timeoutsMax}
                </span>
              </div>
              {/* Der Satz gilt, solange die Pause die Uhr hält (höchstens fünf Minuten je Pause, 15 je Gespräch). */}
              <p className="text-xs text-muted-foreground leading-relaxed" data-testid="pause-hinweis">
                {uhr?.angehalten ? ts.timeoutHint.replace('{name}', personaName) : ts.timeoutHintOver}
              </p>

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
                  onClick={schliessePause}
                  className="btn-gradient text-white font-semibold rounded-xl px-5 py-2.5 text-sm flex items-center gap-2"
                >
                  <Play className="h-4 w-4" /> {ts.timeoutResume}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* U28, C25 (12.11.2026): Die folgenden vier Dialoge nutzen die Dialog-Komponente (Fokusfang, Escape,
            role="dialog"). Die zwei Hinweise zum Mikrofon gehören dazu, weil sie auch über dem Check-in aufgehen:
            als einfache Ebene wären sie dort nicht bedienbar. */}
        {/* W5-4: Das Unternehmen verlangt die Einwilligung „Sprachaufnahme“ — Hinweis mit Link zur Einwilligung. */}
        <Dialog
          open={!!consentUrl}
          onOpenChange={(open) => {
            if (!open) setConsentUrl(null);
          }}
        >
          <DialogContent className={DIALOG_BOX} data-testid="consent-needed">
            <DialogTitle className={DIALOG_TITLE}>{ts.consentTitle}</DialogTitle>
            <DialogDescription className="leading-relaxed">{ts.consentBody}</DialogDescription>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConsentUrl(null)} className="pn-none rounded-lg px-4 py-2 text-sm border border-border hover:bg-muted transition-colors">{ts.consentLater}</button>
              <a href={consentUrl ?? '#'} className="btn-gradient text-white font-semibold rounded-lg px-4 py-2 text-sm">{ts.consentGo}</a>
            </div>
          </DialogContent>
        </Dialog>
        {/* CP-3.4 (M21 Option 1) — Aufklärung vor der ersten Mikrofon-Nutzung. */}
        <Dialog open={micNoticeOpen} onOpenChange={setMicNoticeOpen}>
          <DialogContent className={DIALOG_BOX}>
            <DialogTitle className={DIALOG_TITLE}>{ts.micNoticeTitle}</DialogTitle>
            <DialogDescription className="leading-relaxed">{ts.micNoticeBody}</DialogDescription>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setMicNoticeOpen(false)}
                className="pn-none rounded-lg px-4 py-2 text-sm border border-border hover:bg-muted transition-colors"
              >
                {ts.micNoticeDecline}
              </button>
              <button
                onClick={() => {
                  mikroHinweisBestaetigen();
                  setMicNoticeOpen(false);
                  // Hier wird nur diktiert (Chat und Check-in), nie das Sprachgespräch gestartet (Owner-Befund 01.11.2026).
                  startDiktat();
                }}
                className="btn-gradient text-white font-semibold rounded-lg px-4 py-2 text-sm"
              >
                {ts.micNoticeAccept}
              </button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Auswerten-Bestätigung (Kostenhinweis). Paket 3: „Ja, auswerten“ startet die Auswertung sofort. */}
        <Dialog
          open={confirmOpen}
          onOpenChange={(open) => {
            if (!open && !finishing) setConfirmOpen(false);
          }}
        >
          <DialogContent className={DIALOG_BOX} data-testid="finish-confirm">
            <DialogTitle className={DIALOG_TITLE}>{ts.confirmTitle}</DialogTitle>
            <DialogDescription className="leading-relaxed">{freeEval ? ts.confirmBodyFree : ts.confirmBody}</DialogDescription>
            {/* Preis vor dem Klick (29.09.): die Auswertung ist der einzige kostenpflichtige Schritt.
                U23: Den Eurobetrag sehen nur Admins und Selbstzahler; sonst entfällt die Zeile. */}
            {finishCost && !freeEval && (
              <p className="text-xs text-muted-foreground" data-testid="finish-cost-note">
                {finishCost}
              </p>
            )}
            {userTurnCount < 3 && (
              <p className="text-sm text-amber-800 dark:text-amber-400">{ts.notEnoughTurns}</p>
            )}
            {error && errorBanner}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmOpen(false)}
                disabled={finishing}
                className="pn-none rounded-lg px-4 py-2 text-sm border border-border hover:bg-muted transition-colors disabled:opacity-50"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={() => void startEvaluation()}
                disabled={finishing || userTurnCount < 3}
                className="btn-gradient text-white font-semibold rounded-lg px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-50"
              >
                {finishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {freeEval ? ts.confirmCtaFree : ts.confirmCta}
              </button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Paket 3, S8 (12.11.2026): Check-in in zwei Fragen, während die Auswertung schon rechnet. Kein Nachhaken,
            kein Wartetext; „Weiter“ und „Überspringen“ sind immer sichtbar. Schließen (Escape) heißt überspringen:
            Danach geht es zur Auswertungsseite. Ein Klick neben den Dialog schließt ihn nicht (Text ginge verloren). */}
        <Dialog
          open={!!checkin}
          onOpenChange={(open) => {
            if (!open) checkinGo({ art: 'ueberspringen' });
          }}
        >
          <DialogContent
            className={DIALOG_BOX_CHECKIN}
            data-testid="checkin"
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              checkinFieldRef.current?.focus();
            }}
            onInteractOutside={(e) => e.preventDefault()}
          >
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{ts.checkinStep.replace('{n}', checkin?.frage === 'anders' ? '2' : '1')}</span>
              <button
                type="button"
                onClick={() => checkinGo({ art: 'ueberspringen' })}
                disabled={checkinBusy}
                className="font-semibold underline hover:text-foreground disabled:opacity-50"
              >
                {ts.checkinSkip}
              </button>
            </div>
            <DialogTitle className={DIALOG_TITLE}>
              {checkin?.frage === 'anders' ? ts.checkinQ2 : ts.checkinQ1}
            </DialogTitle>
            <div className="flex items-end gap-2">
              <textarea
                ref={checkinFieldRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  // Jede Eingabe lässt die 20 Sekunden neu beginnen.
                  setCheckinInputAt(Date.now());
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    checkinGo({ art: 'weiter', text: input });
                  }
                }}
                rows={3}
                maxLength={CHECKIN_MAX_CHARS}
                placeholder={ts.checkinFieldPh}
                aria-label={checkin?.frage === 'anders' ? ts.checkinQ2 : ts.checkinQ1}
                disabled={checkinBusy}
                className="pn-field flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
              />
              {diktat.supported && (
                <button
                  type="button"
                  onClick={() => (diktat.aktiv ? diktat.stop() : startDictation())}
                  disabled={diktat.startet || checkinBusy}
                  className={cx(
                    'pn-none relative rounded-xl p-3 border transition-colors disabled:opacity-50',
                    diktat.aktiv
                      ? 'border-primary/60 text-primary bg-primary/10 shadow-neon'
                      : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
                  )}
                  aria-label={diktat.aktiv ? ts.micStop : ts.micStart}
                  title={diktat.aktiv ? ts.micStop : ts.micStart}
                >
                  <Mic className="h-5 w-5" />
                </button>
              )}
            </div>
            <DialogDescription className="text-xs">{ts.checkinAutoHint}</DialogDescription>
            {error && errorBanner}
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 text-xs text-muted-foreground">
                {checkin?.frage === 'gut' ? ts.checkinThen.replace('{q}', ts.checkinQ2) : null}
              </span>
              <button
                type="button"
                onClick={() => checkinGo({ art: 'weiter', text: input })}
                disabled={checkinBusy}
                className="btn-gradient shrink-0 text-white font-semibold rounded-lg px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-50"
              >
                {ts.stepNext}
                {checkinBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              </button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Paket 4: In der Sprechansicht stehen Ziele und Briefing nicht im Bild; das Menü „⋯“ öffnet sie hier. */}
        <Dialog
          open={imSprechen && !imCheck && briefingOpen}
          onOpenChange={(open) => {
            if (!open) setBriefingOpen(false);
          }}
        >
          <DialogContent className={`${DIALOG_BOX} max-w-lg`} aria-describedby={undefined} data-testid="briefing-dialog">
            <DialogTitle className={DIALOG_TITLE}>{ts.goalsStripTitle}</DialogTitle>
            <ol className="space-y-1 text-sm leading-snug">{zielePunkte}</ol>
            {focus && (
              <p className="text-sm leading-relaxed">
                <span className="font-semibold text-accent">{ts.focusBanner}: </span>
                {focus}
              </p>
            )}
            {briefingInhalt}
            <div className="flex justify-end">
              <button
                onClick={() => setBriefingOpen(false)}
                className="btn-gradient text-white font-semibold rounded-lg px-4 py-2 text-sm"
              >
                {t.common.close}
              </button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Paket 4: Hilfe zum Sprechen (Menü „⋯“ der Sprechansicht), drei kurze Sätze. */}
        <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
          <DialogContent className={DIALOG_BOX} aria-describedby={undefined} data-testid="sprech-hilfe">
            <DialogTitle className={DIALOG_TITLE}>{ts.menuHelp}</DialogTitle>
            <ul className="space-y-2 text-sm leading-relaxed text-muted-foreground">
              <li>{ts.speakHelp1}</li>
              <li>{ts.speakHelp2}</li>
              <li>{ts.speakHelp3.replace('{name}', personaName)}</li>
            </ul>
            <div className="flex justify-end">
              <button
                onClick={() => setHelpOpen(false)}
                className="btn-gradient text-white font-semibold rounded-lg px-4 py-2 text-sm"
              >
                {t.common.close}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </AppShell>
    );
  }

  return null;
}
