'use client';

/**
 * Welle C (Synthesia-Vergleich §7) — Self-Service-Szenario-Builder:
 * Kunden-Admins erstellen eigene Szenarien aus Brief + Material. Der
 * B3b-Generator liefert den Entwurf, der Admin reviewt (inkl. DNA — er ist
 * Autor seiner eigenen Szenarien), überarbeitet per Änderungswunsch
 * (Synthesia-Muster »describe any changes«) und schaltet bewusst frei.
 * Lernende sehen weiterhin ausschließlich die publicScenario-Projektion.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  Link2,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  Wand2,
} from 'lucide-react';
import AppShell from '@/components/app/app-shell';
import { authFetch } from '@/lib/api-client';
import { useTranslation } from '@/i18n/useTranslation';
import { maxEurHint, showEurPrice } from '@/lib/pricing-display';
import { CREDITS_REFRESH_EVENT } from '@/components/app/credit-balance';
import { withBasePath } from '@/lib/base-path';
import { copyText } from '@/lib/report-utils';
import { LIVE_VOICES, defaultLiveVoice, liveVoiceSamplePath } from '@/lib/simulation/live-voices';
import { szenarioLink } from '@/lib/simulation/szenario-link';
import type { PersonaVoice } from '@/lib/simulation/types';

interface BuilderScenario {
  id: string;
  title: string;
  teaser: string;
  category: string;
  difficulty: number;
  persona: { name: string; role: string; voice?: PersonaVoice; liveVoice?: string };
  candidateBriefing: {
    yourRole: string;
    relationship: string;
    incidents: string[];
    goals: string[];
    approachHints?: string[];
  };
  personaDna: {
    background: string;
    hiddenDrivers: string[];
    positions: string[];
    interests: string[];
    objectionPlaybook: Array<{ trigger: string; objection: string }>;
    concessionConditions: string[];
    openingLine: string;
  };
  assessment: {
    competencies: Array<{ key: string; label: string; weight?: number }>;
    checkpoints: Array<{ id: string; description: string }>;
  };
}

interface BuilderItem {
  id: string;
  status: 'draft' | 'published';
  createdAt: string;
  updatedAt: string;
  /** C28: Stand der Rollen-Vorbereitung, nur bei freigeschalteten Szenarien. */
  vorbereitung?: 'bereit' | 'laeuft' | 'fehlgeschlagen' | 'offen';
  /** Freier Testlauf (Owner-Entscheid 12.11.2026): kommt nur für die Person mit, die das Szenario gebaut hat. */
  freeTestEval?: 'offen' | 'verbraucht';
  scenario: BuilderScenario;
}

/**
 * S15/U27 (Paket 5, 12.11.2026): Beispiel-Aufträge zum Anklicken, je einer pro Gesprächsart. Vorher stand nur ein
 * Platzhalter im Feld. Ein Klick füllt Beschreibung und Kategorie vor; die Texte stehen in den Wörterbüchern.
 */
const BEISPIELE = [
  { n: 1, category: 'mitarbeiterfuehrung' },
  { n: 2, category: 'vertrieb' },
  { n: 3, category: 'zusammenarbeit' },
  { n: 4, category: 'stakeholder' },
] as const;

/** C28: So oft lädt die Liste nach, solange eine Rolle vorbereitet wird (alle zehn Sekunden, also rund zwei Minuten). */
const VORBEREITUNG_NACHLADEN_MAX = 12;

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export default function BuilderClient() {
  const { t, locale } = useTranslation();
  const ts = t.simulation;
  const router = useRouter();

  const [role, setRole] = useState<'loading' | 'admin' | 'member'>('loading');
  const [items, setItems] = useState<BuilderItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Formular
  const [brief, setBrief] = useState('');
  const [material, setMaterial] = useState('');
  const [category, setCategory] = useState('vertrieb');
  const [difficulty, setDifficulty] = useState(2);
  const [generating, setGenerating] = useState(false);

  // Review/Aktionen
  const [openId, setOpenId] = useState<string | null>(null);
  const [dnaOpen, setDnaOpen] = useState(false);
  const [reviseNote, setReviseNote] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Hörprobe der Live-Stimme: ein Abspieler für die ganze Seite, ein Klick startet, der nächste stoppt.
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopSample = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingVoice(null);
  }, []);
  useEffect(() => stopSample, [stopSample]);
  function toggleSample(voiceId: string) {
    if (playingVoice === voiceId) {
      stopSample();
      return;
    }
    stopSample();
    const audio = new Audio(withBasePath(liveVoiceSamplePath(voiceId)));
    audio.onended = () => setPlayingVoice((cur) => (cur === voiceId ? null : cur));
    audio.onerror = () => setPlayingVoice((cur) => (cur === voiceId ? null : cur));
    audioRef.current = audio;
    setPlayingVoice(voiceId);
    void audio.play().catch(() => setPlayingVoice(null));
  }

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    try {
      const res = await authFetch('/api/simulation/builder');
      if (res.status === 403) {
        setRole('member');
        return;
      }
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error('load');
      setRole('admin');
      setItems(json.items ?? []);
    } catch {
      // Das stille Nachladen im Hintergrund meldet keinen Fehler; die Liste bleibt, wie sie ist.
      if (!opts?.quiet) setError(ts.genericError);
    }
  }, [ts.genericError]);

  useEffect(() => {
    void load();
  }, [load]);

  // C28: Nach dem Freischalten entsteht die Rolle im Hintergrund. Solange das läuft, lädt die Liste nach,
  // damit aus „Rolle wird vorbereitet“ ohne Neuladen der Seite „Rolle ist bereit“ wird.
  const nachgeladenRef = useRef(0);
  useEffect(() => {
    if (!items.some((i) => i.status === 'published' && i.vorbereitung === 'laeuft')) {
      nachgeladenRef.current = 0;
      return;
    }
    if (nachgeladenRef.current >= VORBEREITUNG_NACHLADEN_MAX) return;
    const timer = window.setTimeout(() => {
      nachgeladenRef.current += 1;
      void load({ quiet: true });
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, [items, load]);

  async function generate(reviseScenarioId?: string) {
    if (generating) return;
    setGenerating(true);
    setError(null);
    if (reviseScenarioId) setBusyId(reviseScenarioId);
    try {
      const res = await authFetch('/api/simulation/builder/generate', {
        method: 'POST',
        body: JSON.stringify(
          reviseScenarioId
            ? { reviseScenarioId, reviseNote: reviseNote.trim() }
            : {
                brief: brief.trim(),
                ...(material.trim() ? { material: material.trim() } : {}),
                category,
                difficulty,
                // S15: Die Sprache des Auftrags entscheidet; das hier gilt nur, wenn sie nicht eindeutig ist.
                locale: locale === 'en' ? 'en' : 'de',
              }
        ),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(
          json?.code === 'INSUFFICIENT_CREDITS'
            ? ts.builderNoCredits
            : json?.code === 'SCENARIO_LIMIT'
              ? ts.builderLimit
              : ts.builderGenerateFailed
        );
        return;
      }
      window.dispatchEvent(new Event(CREDITS_REFRESH_EVENT));
      setReviseNote('');
      await load();
      setOpenId(json.item.id);
    } catch {
      setError(ts.builderGenerateFailed);
    } finally {
      setGenerating(false);
      setBusyId(null);
    }
  }

  async function setStatus(id: string, status: 'draft' | 'published') {
    setBusyId(id);
    setError(null);
    try {
      const res = await authFetch('/api/simulation/builder/status', {
        method: 'POST',
        body: JSON.stringify({ scenarioId: id, status }),
      });
      const json = await res.json().catch(() => null);
      // A4 (31.10.2026): KI für das Unternehmen aus — Freischalten geht nicht, die Meldung des Servers zeigen.
      if (res.status === 403 && json?.code === 'KI_AUS') {
        setError(json.error || ts.genericError);
        return;
      }
      if (!res.ok || !json?.ok) throw new Error('status');
      await load();
    } catch {
      setError(ts.genericError);
    } finally {
      setBusyId(null);
    }
  }

  // Stimme der Rolle (Owner-Skizze 28.10.): eine der 30 Live-Stimmen. Der Server leitet daraus die
  // Vorlesestimme für den Textweg ab (gleiches Geschlecht) und gibt beides zurück.
  async function setLiveVoice(id: string, liveVoice: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await authFetch('/api/simulation/builder/voice', {
        method: 'POST',
        body: JSON.stringify({ scenarioId: id, liveVoice }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; voice?: PersonaVoice; liveVoice?: string } | null;
      if (!res.ok || !json?.ok) throw new Error('voice');
      const voice = json.voice;
      setItems((prev) =>
        prev.map((it) =>
          it.id === id
            ? { ...it, scenario: { ...it.scenario, persona: { ...it.scenario.persona, liveVoice, ...(voice ? { voice } : {}) } } }
            : it
        )
      );
    } catch {
      setError(ts.genericError);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await authFetch('/api/simulation/builder/delete', {
        method: 'POST',
        body: JSON.stringify({ scenarioId: id }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error('delete');
      setConfirmDeleteId(null);
      if (openId === id) setOpenId(null);
      await load();
    } catch {
      setError(ts.genericError);
    } finally {
      setBusyId(null);
    }
  }

  const openItem = items.find((i) => i.id === openId) ?? null;

  // S26 (Paket 5, 12.11.2026): Einstiegslink in die Zwischenablage. Nichts wird freigeschaltet: Der Link führt nur
  // angemeldete Personen aus dem Team ins Briefing des freigeschalteten Szenarios.
  async function copyLink(id: string) {
    await copyText(szenarioLink(window.location.origin, id));
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 2500);
  }

  const rolleText = {
    laeuft: ts.builderRolePreparing,
    bereit: ts.builderRoleReady,
    fehlgeschlagen: ts.builderRoleFailed,
    offen: ts.builderRoleOpen,
  } as const;

  const backAction = (
    <button
      onClick={() => router.push('/')}
      className="pn-none inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      <span className="hidden sm:inline">{ts.builderBack}</span>
    </button>
  );

  if (role === 'loading') {
    return (
      <AppShell title={ts.builderTitle} actions={backAction}>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t.common.loading}
        </div>
      </AppShell>
    );
  }

  if (role === 'member') {
    return (
      <AppShell title={ts.builderTitle} actions={backAction}>
        <div className="pn-none glass-panel max-w-xl rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-800 dark:text-amber-400 mt-0.5 shrink-0" />
          <p>{ts.builderAdminOnly}</p>
        </div>
      </AppShell>
    );
  }

  // U23 (Owner-Entscheid 12.11.2026): Den Eurobetrag sieht nur, wer kauft. Bis hierher kommt nur, wen der Server
  // als Admin des Teams bestätigt hat.
  const eurHint = showEurPrice(role) ? maxEurHint(t.common.maxEurHint, locale) : null;

  return (
    <AppShell title={ts.builderTitle} subtitle={ts.builderSubtitle} actions={backAction}>
      <div className="max-w-3xl mx-auto space-y-6">
        {error && (
          <div className="pn-none glass-panel rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 flex items-start gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-rose-800 dark:text-rose-400 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ── Neues Szenario ── */}
        <section className="pn-surface glass-panel rounded-2xl border border-border p-5 space-y-4">
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            <Wand2 className="h-4 w-4 text-primary" /> {ts.builderNewTitle}
          </h2>
          <div>
            <label htmlFor="builder-brief" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {ts.builderBriefLabel}
            </label>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{ts.builderExamplesLabel}:</span>
              {BEISPIELE.map((b) => (
                <button
                  key={b.n}
                  type="button"
                  onClick={() => {
                    setBrief(ts[`builderExample${b.n}Text`]);
                    setCategory(b.category);
                  }}
                  title={ts[`builderExample${b.n}Text`]}
                  className="pn-none rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  data-testid={`builder-example-${b.n}`}
                >
                  {ts[`builderExample${b.n}Label`]}
                </button>
              ))}
            </div>
            <textarea
              id="builder-brief"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={5}
              maxLength={4000}
              placeholder={ts.builderBriefPlaceholder}
              className="pn-field mt-1 w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <div>
            <label htmlFor="builder-material" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {ts.builderMaterialLabel}
            </label>
            <textarea
              id="builder-material"
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
              rows={4}
              maxLength={20000}
              placeholder={ts.builderMaterialPlaceholder}
              className="pn-field mt-1 w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <div className="flex flex-wrap gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                {ts.builderCategoryLabel}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(['mitarbeiterfuehrung', 'zusammenarbeit', 'vertrieb', 'stakeholder'] as const).map((c) => (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    aria-pressed={category === c}
                    className={cx(
                      'pn-none rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                      category === c
                        ? 'border-primary/60 bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {ts[`builderCat_${c}` as keyof typeof ts] as string}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                {ts.builderDifficultyLabel}
              </div>
              <div className="flex gap-1.5">
                {[1, 2, 3].map((d) => (
                  <button
                    key={d}
                    onClick={() => setDifficulty(d)}
                    aria-pressed={difficulty === d}
                    className={cx(
                      'pn-none rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                      difficulty === d
                        ? 'border-primary/60 bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => void generate()}
              disabled={generating || brief.trim().length < 30}
              className="btn-gradient text-white font-semibold rounded-xl px-5 py-2.5 flex items-center gap-2 disabled:opacity-50"
            >
              {generating && !busyId ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {ts.builderGenerateCta}
            </button>
            <span className="text-xs text-muted-foreground">
              {ts.builderCostNote}
              {eurHint ? ` (${eurHint})` : ''}
            </span>
          </div>
          {generating && !busyId && (
            <p className="text-xs text-muted-foreground">{ts.builderGenerating}</p>
          )}
        </section>

        {/* ── Bestehende Szenarien ── */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {ts.builderListTitle} ({items.length})
          </h2>
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground">{ts.builderEmpty}</p>
          )}
          {items.map((item) => {
            const isOpen = openId === item.id;
            const s = item.scenario;
            const liveVoice = s.persona.liveVoice ?? defaultLiveVoice(s.persona.voice);
            return (
              <div key={item.id} className="pn-surface glass-panel rounded-xl border border-border">
                <div className="p-4 flex items-center gap-3 flex-wrap">
                  <button
                    onClick={() => {
                      setOpenId(isOpen ? null : item.id);
                      setDnaOpen(false);
                      setReviseNote('');
                    }}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="text-sm font-semibold truncate">{s.title}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {s.persona.name} · {s.persona.role}
                    </div>
                    {item.status === 'published' && item.vorbereitung && (
                      <div
                        className={cx(
                          'mt-0.5 flex items-start gap-1 text-xs',
                          item.vorbereitung === 'fehlgeschlagen' ? 'text-amber-800 dark:text-amber-400' : 'text-muted-foreground'
                        )}
                        data-testid="builder-role-status"
                      >
                        {item.vorbereitung === 'laeuft' && <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin" />}
                        {item.vorbereitung === 'bereit' && <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />}
                        {item.vorbereitung === 'fehlgeschlagen' && <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />}
                        <span>{rolleText[item.vorbereitung]}</span>
                      </div>
                    )}
                  </button>
                  <span
                    className={cx(
                      'text-xs font-semibold px-2.5 py-1 rounded-full border',
                      item.status === 'published'
                        ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-400 border-emerald-500/30'
                        : 'bg-amber-500/15 text-amber-800 dark:text-amber-400 border-amber-500/30'
                    )}
                  >
                    {item.status === 'published' ? ts.builderPublished : ts.builderDraft}
                  </span>
                  <ChevronDown
                    className={cx('h-4 w-4 text-muted-foreground transition-transform', isOpen && 'rotate-180')}
                  />
                </div>

                {isOpen && (
                  <div className="border-t border-border p-4 space-y-4 text-sm">
                    <p className="text-muted-foreground leading-relaxed">{s.teaser}</p>

                    {/* Stimme der Rolle (Owner-Skizze 28.10.): zwei Gruppen, Name + Charakterwort, Anhören */}
                    <div className="space-y-1.5">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {ts.builderVoice}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={liveVoice}
                          disabled={busyId === item.id}
                          onChange={(e) => void setLiveVoice(item.id, e.target.value)}
                          className="pn-field rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground min-w-[16rem]"
                          aria-label={ts.builderVoice}
                          data-testid="builder-voice"
                        >
                          {(['w', 'm'] as const).map((g) => (
                            <optgroup key={g} label={g === 'w' ? ts.builderVoiceFemale : ts.builderVoiceMale}>
                              {LIVE_VOICES.filter((v) => v.gender === g).map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.id} · {ts.liveVoiceCharacter[v.character]}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => toggleSample(liveVoice)}
                          className="pn-none inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground hover:bg-secondary"
                          aria-pressed={playingVoice === liveVoice}
                          data-testid="builder-voice-listen"
                        >
                          {playingVoice === liveVoice ? <Square className="h-3.5 w-3.5" /> : <Volume2 className="h-4 w-4" />}
                          {playingVoice === liveVoice ? ts.builderVoiceStop : ts.builderVoiceListen}
                        </button>
                      </div>
                      <p className="text-xs text-muted-foreground">{ts.builderVoiceNote}</p>
                    </div>

                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                        {ts.builderGoals}
                      </div>
                      <ol className="list-decimal ml-5 space-y-0.5">
                        {s.candidateBriefing.goals.map((g, i) => (
                          <li key={i}>{g}</li>
                        ))}
                      </ol>
                    </div>

                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                        {ts.builderAnchors}
                      </div>
                      <ul className="space-y-0.5">
                        {s.assessment.competencies.map((c) => (
                          <li key={c.key}>
                            <span className="font-mono text-xs text-muted-foreground mr-1.5">
                              {c.key}×{c.weight ?? 1}
                            </span>
                            {c.label}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* DNA — nur für den Autor (Admin) sichtbar, aufklappbar. */}
                    <div>
                      <button
                        onClick={() => setDnaOpen((v) => !v)}
                        className="text-[11px] font-semibold uppercase tracking-wide text-primary flex items-center gap-1"
                      >
                        {dnaOpen ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        {dnaOpen ? ts.builderDnaHide : ts.builderDnaShow}
                      </button>
                      {dnaOpen && (
                        <div className="pn-tile mt-2 space-y-2 rounded-xl border border-border bg-muted/40 p-3 text-xs leading-relaxed">
                          <p className="text-amber-800 dark:text-amber-400 font-semibold">{ts.builderDnaWarning}</p>
                          <p>
                            <span className="font-semibold">{ts.builderDnaHidden}:</span>{' '}
                            {s.personaDna.hiddenDrivers.join(' · ')}
                          </p>
                          <p>
                            <span className="font-semibold">{ts.builderDnaPositions}:</span>{' '}
                            {s.personaDna.positions.join(' · ')}
                          </p>
                          <p>
                            <span className="font-semibold">{ts.builderDnaInterests}:</span>{' '}
                            {s.personaDna.interests.join(' · ')}
                          </p>
                          <div>
                            <span className="font-semibold">{ts.builderDnaObjections}:</span>
                            <ul className="ml-4 list-disc">
                              {s.personaDna.objectionPlaybook.map((o, i) => (
                                <li key={i}>
                                  {o.trigger} → »{o.objection}«
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Überarbeiten mit Hinweis (Synthesia-Muster). */}
                    <div className="space-y-2">
                      <label htmlFor={`revise-${item.id}`} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {ts.builderReviseLabel}
                      </label>
                      <textarea
                        id={`revise-${item.id}`}
                        value={openId === item.id ? reviseNote : ''}
                        onChange={(e) => setReviseNote(e.target.value)}
                        rows={2}
                        maxLength={2000}
                        placeholder={ts.builderRevisePlaceholder}
                        className="pn-field w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => void generate(item.id)}
                        disabled={generating || reviseNote.trim().length < 5}
                        className="pn-none rounded-lg border border-primary/40 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/10 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {busyId === item.id && generating ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3.5 w-3.5" />
                        )}
                        {ts.builderReviseCta}
                      </button>
                      <button
                        onClick={() => router.push(`/?szenario=${encodeURIComponent(item.id)}`)}
                        className="pn-none rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
                      >
                        <Play className="h-3.5 w-3.5" /> {ts.builderTestCta}
                      </button>
                      {item.status === 'published' && (
                        <button
                          type="button"
                          onClick={() => void copyLink(item.id)}
                          className="pn-none rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
                          data-testid="builder-copy-link"
                        >
                          {copiedId === item.id ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                          <span aria-live="polite">{copiedId === item.id ? ts.builderLinkCopied : ts.builderCopyLink}</span>
                        </button>
                      )}
                      {item.status === 'draft' ? (
                        <button
                          onClick={() => void setStatus(item.id, 'published')}
                          disabled={busyId === item.id}
                          className="pn-none rounded-lg border border-emerald-500/40 px-3 py-2 text-xs font-semibold text-emerald-800 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> {ts.builderPublishCta}
                        </button>
                      ) : (
                        <button
                          onClick={() => void setStatus(item.id, 'draft')}
                          disabled={busyId === item.id}
                          className="pn-none rounded-lg border border-amber-500/40 px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-400 hover:bg-amber-500/10 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <EyeOff className="h-3.5 w-3.5" /> {ts.builderUnpublishCta}
                        </button>
                      )}
                      {confirmDeleteId === item.id ? (
                        <button
                          onClick={() => void remove(item.id)}
                          disabled={busyId === item.id}
                          className="pn-none rounded-lg border border-rose-500/50 bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-800 dark:text-rose-400 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                        >
                          {busyId === item.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                          {ts.builderDeleteConfirm}
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(item.id)}
                          className="pn-none rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:border-rose-500/30 hover:text-rose-800 dark:hover:text-rose-400 transition-colors flex items-center gap-1.5"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> {ts.builderDeleteCta}
                        </button>
                      )}
                    </div>
                    {(item.freeTestEval === 'offen' || item.status === 'published') && (
                      <div className="space-y-0.5 text-xs text-muted-foreground">
                        {item.freeTestEval === 'offen' && <p data-testid="builder-free-test">{ts.builderFreeTestNote}</p>}
                        {item.status === 'published' && <p>{ts.builderLinkNote}</p>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      </div>
    </AppShell>
  );
}
