'use client';

/**
 * Paket 3 (12.11.2026): gemeinsame Typen und kleine Bausteine der Rollenspiel-Auswertung.
 * Anlass: Die eine lange Seite ist in vier Reiter zerlegt (U14, S10); was mehrere Reiter brauchen, liegt hier.
 */

import React from 'react';
import { ChevronRight, TrendingDown, TrendingUp } from 'lucide-react';

/* ── Typen (Vertrag der Antwort von /api/simulation/get) ── */

export interface SimEvalFeedback {
  summary: string;
  rubric: {
    key: string;
    label: string;
    evidence: string[];
    why: string;
    score: number | null;
    /** Welle 1: „Das gelang“ / „Nächstes Mal“ (fehlt bei Alt-Läufen). */
    wentWell?: string[];
    tryNext?: string[];
  }[];
  checkpoints: { id: string; hit: boolean; comment: string }[];
  nextStep: string;
  /** Schlüssel der Fähigkeit, zu der der „Größte Hebel“ gehört (fehlt bei Alt-Läufen, leer = keine). */
  nextStepKey?: string | null;
  focusReview?: { addressed: boolean; comment: string } | null;
  /** A1: Abgleich Selbstbild ↔ Auswertung (nur wenn der Check-in beantwortet wurde; seit Paket 3 ein eigener Schritt). */
  selfReview?: { agreement: 'confirms' | 'partly' | 'differs'; comment: string } | null;
  /** V3: Merkkarten aus der Coaching-Bibliothek zum nächsten Schritt (fehlt bei Alt-Läufen). */
  cards?: { id: string; title: string; hint: string }[];
  /** O2: der EINE Schritt für den Alltag (fehlt bei Alt-Läufen). */
  microTransfer?: { step: string; when: string } | null;
  /** Paket 3, S13: Aussagen, die den Fakten des Szenarios widersprechen (fehlt bei Alt-Läufen). */
  sachlichNichtGedeckt?: { zitat: string; warum: string }[] | null;
}

/** A3: ein Punkt der Verlaufskurve (aus /api/simulation/list, gleiche Quelle wie die Historie). */
export interface SimEvalHistoryPoint {
  id: string;
  attempt: number;
  overall: number | null;
}

export interface SimEvalDebriefAnchor {
  key: string;
  label: string;
  score: number | null;
  pct: number | null;
  expectation: 'not-observable' | 'below' | 'approaching' | 'meets' | 'exceeds';
  /** Welle 1: Gewicht (Prozent der beobachteten Anker) und Beitrag zur Gesamtnote in Punkten; fehlt bei Alt-Läufen. */
  weightPct?: number | null;
  contribution?: number | null;
}

export interface SimEvalDebrief {
  overall: number | null;
  verdict: 'passed' | 'failed' | 'unrated';
  passMarkPct: number;
  coverage: number;
  anchors: SimEvalDebriefAnchor[];
  checkpointsHit: number;
  checkpointsTotal: number;
  /** Rechenweg (N17): Teilwerte und Gewichte; fehlen bei Alt-Läufen. */
  anchorPct?: number | null;
  checkpointPct?: number | null;
  weights?: { anchors: number; checkpoints: number };
  /** Bewertung 2.0 (01.11.2026): Ergebnis des Gesprächs und Grund des Urteils; fehlen bei Alt-Läufen. */
  ergebnis?: 'ziel' | 'offen' | 'abbruch' | null;
  verdictGrund?: 'punkte' | 'ziel' | 'abbruch';
}

export interface SimEvalDelta {
  overall: number | null;
  anchors: Array<{ key: string; delta: number | null }>;
  prevOverall: number | null;
  prevAttempt: number;
}

export interface SimEvalRating {
  id: string;
  name: string;
  score: number | null;
  why: string;
  evidence: string[];
}

export interface SimEvalTurn {
  role: string;
  text: string;
}

/** Springt in den Reiter „Gespräch“ und rollt zum Zug mit diesem Index. */
export type ZurStelle = (turn: number) => void;

/** »Motto — Gesprächstyp mit Name«. */
export function splitTitle(title: string): { motto: string; heroTitle: string } {
  const idx = title.indexOf('—');
  if (idx < 0) return { motto: title, heroTitle: title };
  return { motto: title.slice(0, idx).trim(), heroTitle: title.slice(idx + 1).trim() };
}

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export function DeltaTag({ delta }: { delta: number | null }) {
  if (delta == null || delta === 0) return null;
  const up = delta > 0;
  return (
    <span
      className={cx(
        'inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full',
        up ? 'text-emerald-800 dark:text-emerald-400 bg-emerald-500/10' : 'text-rose-800 dark:text-rose-400 bg-rose-500/10'
      )}
    >
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? '+' : ''}
      {delta}
    </span>
  );
}

/** Kleine Überschrift über einem Abschnitt. */
export function Kicker(props: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={cx('text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5', props.className)}>
      {props.children}
    </h2>
  );
}

/**
 * Paket 3, U17 und S12: ein Beleg. Steht das Zitat im Gespräch (`turn`), ist es ein Knopf, der zur Stelle springt;
 * ohne Treffer bleibt es ein Zitat ohne Sprung.
 */
export function Zitat(props: { text: string; turn: number | null; onJump: ZurStelle; jumpLabel: string }) {
  const cls = 'text-xs italic border-l-2 border-primary/40 pl-2.5 py-0.5 text-muted-foreground leading-relaxed';
  if (props.turn == null) return <blockquote className={cls}>{props.text}</blockquote>;
  const turn = props.turn;
  return (
    <button
      type="button"
      onClick={() => props.onJump(turn)}
      className={cx(cls, 'block w-full text-left rounded-r transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40')}
    >
      {props.text}{' '}
      <span className="not-italic font-semibold text-primary whitespace-nowrap">
        {props.jumpLabel}
        <ChevronRight className="inline h-3 w-3" aria-hidden />
      </span>
    </button>
  );
}
