'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTheme } from 'next-themes';

type AnyObj = Record<string, any>;

interface RunDetailClientProps {
  runId: string;
  sessionId: string;
  result: AnyObj;
}

// --- Helpers ---

function shortId(id?: string, n = 18) {
  const s = String(id ?? '');
  if (!s) return '—';
  if (s.length <= n) return s;
  return s.slice(0, n) + '…';
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function toNumber(v: any): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function overallToPercent(result: AnyObj): number | null {
  const raw = toNumber(result?.scores?.overall ?? result?.scoreOverall ?? result?.overall);
  if (raw === null) return null;
  if (raw <= 10) return clamp(raw * 10, 0, 100);
  return clamp(raw, 0, 100);
}

function getScoreTitle(pct: number | null) {
  if (pct === null) return 'Analyse bereit';
  if (pct >= 85) return 'Sehr starke Gesprächsführung';
  if (pct >= 70) return 'Gute Gesprächsführung';
  if (pct >= 55) return 'Solide Basis';
  return 'Ausbaufähig';
}

function getScoreBadge(pct: number | null) {
  if (pct === null) return { label: '—', cls: 'bg-gray-100 text-gray-700' };
  if (pct >= 85) return { label: 'SEHR STARK', cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' };
  if (pct >= 70) return { label: 'STARK', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400' };
  if (pct >= 55) return { label: 'SOLIDE', cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400' };
  return { label: 'FOKUS', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' };
}

function asStringArray(v: any): string[] {
  return Array.isArray(v) ? v.map((x) => String(x ?? '')).map((s) => s.trim()).filter(Boolean) : [];
}

// --- Components ---

function CircularProgress({ value }: { value: number }) {
  const radius = 50;
  const stroke = 8;
  const normalizedRadius = radius - stroke * 0.5;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (value / 100) * circumference;

  return (
    <div className="relative w-32 h-32 flex items-center justify-center">
      <svg height={radius * 2} width={radius * 2} className="rotate-[-90deg]">
        <circle
          stroke="currentColor"
          fill="transparent"
          strokeWidth={stroke}
          strokeDasharray={circumference + ' ' + circumference}
          style={{ strokeDashoffset: 0 }}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
          className="text-gray-200 dark:text-gray-800"
        />
        <circle
          stroke="currentColor"
          fill="transparent"
          strokeWidth={stroke}
          strokeDasharray={circumference + ' ' + circumference}
          style={{ strokeDashoffset }}
          strokeLinecap="round"
          r={normalizedRadius}
          cx={radius}
          cy={radius}
          className="text-primary transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-3xl font-bold text-text-main-light dark:text-text-main-dark">{value}</span>
        <span className="text-[10px] uppercase font-bold text-text-muted-light dark:text-text-muted-dark tracking-wider">Gesamt</span>
      </div>
    </div>
  );
}

function ProgressBar({ value, max = 10, label }: { value: number; max?: number; label?: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-sm font-medium text-text-main-light dark:text-text-main-dark">{label}</span>
        <span className="text-sm font-bold text-text-main-light dark:text-text-main-dark">{value}/{max}</span>
      </div>
      <div className="h-2 w-full bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
        <div 
          className="h-full bg-primary rounded-full transition-all duration-1000" 
          style={{ width: `${pct}%` }} 
        />
      </div>
    </div>
  );
}

function SectionCard({ title, icon, items, type }: { title: string; icon: string; items: string[]; type: 'strength' | 'potential' | 'risk' }) {
  if (!items || items.length === 0) return null;

  let headerColor = '';
  let iconColor = '';
  let borderClass = '';
  
  if (type === 'strength') {
    headerColor = 'text-green-600 dark:text-green-400';
    iconColor = 'bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-400';
    borderClass = 'border-l-4 border-green-500';
  } else if (type === 'potential') {
    headerColor = 'text-amber-600 dark:text-amber-400';
    iconColor = 'bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400';
    borderClass = 'border-l-4 border-amber-500';
  } else {
    headerColor = 'text-red-600 dark:text-red-400';
    iconColor = 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400';
    borderClass = 'border-l-4 border-red-500';
  }

  return (
    <div className={`bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-2xl p-6 shadow-card-light dark:shadow-card-dark h-full ${borderClass}`}>
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${iconColor}`}>
          <span className="material-icons-round text-lg">{icon}</span>
        </div>
        <h3 className={`font-bold text-lg ${headerColor}`}>{title}</h3>
      </div>
      <ul className="space-y-3">
        {items.map((item, i) => (
          <li key={i} className="flex gap-3 text-sm text-text-main-light dark:text-text-main-dark leading-relaxed">
            <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${type === 'strength' ? 'bg-green-500' : type === 'potential' ? 'bg-amber-500' : 'bg-red-500'}`} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function RunDetailClient({ runId, sessionId, result }: RunDetailClientProps) {
  const { theme, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const router = useRouter();

  const pct = overallToPercent(result);
  const scoreTitle = getScoreTitle(pct);
  const badge = getScoreBadge(pct);
  const displayScore = pct !== null ? Math.round(pct) : 0;

  // Data Extraction
  const strengths = asStringArray(result.strengths);
  const potentials = asStringArray(result.improvementAreas ?? result.potential);
  // Simulating risks if not present or using a subset of improvements
  const risks = asStringArray(result.risks); 

  const competencies = Array.isArray(result.competency_ratings) 
    ? result.competency_ratings 
    : [];

  const practice = result.practice7Days || result.sevenDayPractice || result.practice;
  const rewrites = Array.isArray(result.rewrites) ? result.rewrites : [];

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
            <Link href="/analyze" className="flex items-center px-4 py-3 text-text-muted-light dark:text-text-muted-dark hover:text-text-main-light dark:hover:text-text-main-dark hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg transition-all duration-200 group">
                <span className="material-icons-round mr-3 group-hover:scale-110 transition-transform">analytics</span>
                <span className="font-medium">Analyse</span>
            </Link>
            <Link href="/runs-dashboard" className="flex items-center px-4 py-3 bg-primary/10 text-primary rounded-lg border-l-4 border-primary transition-all duration-200 group">
                <span className="material-icons-round mr-3">history</span>
                <span className="font-medium">Verlauf</span>
            </Link>
            <Link href="/design-preview" className="flex items-center px-4 py-3 text-text-muted-light dark:text-text-muted-dark hover:text-text-main-light dark:hover:text-text-main-dark hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg transition-all duration-200 group">
                <span className="material-icons-round mr-3 group-hover:scale-110 transition-transform">grid_view</span>
                <span className="font-medium">Design-Preview</span>
            </Link>
        </nav>
        <div className="p-4 mt-auto">
            <button 
                className="w-full btn-gradient text-white font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-2 shadow-glow"
                onClick={() => router.push('/analyze')}
            >
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
                <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-text-main-light dark:text-text-main-dark leading-tight">Analyse</h2>
                    <span className="px-2 py-0.5 bg-surface-light dark:bg-white/10 rounded text-[10px] font-mono text-text-muted-light dark:text-text-muted-dark">#{shortId(runId, 6)}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                    <span className="w-2 h-2 rounded-full bg-green-500"></span>
                    <span className="text-text-muted-light dark:text-text-muted-dark">Verarbeitung abgeschlossen</span>
                </div>
            </div>
            <div className="flex items-center space-x-4">
                <button 
                    className="flex items-center gap-2 px-3 py-1.5 text-text-muted-light dark:text-text-muted-dark hover:text-primary transition-colors text-sm"
                    onClick={() => router.push(`/runs-dashboard?sessionId=${sessionId}`)}
                >
                    <span className="material-icons-round text-sm">arrow_back</span>
                    <span>Verlauf</span>
                </button>
                <button className="relative p-2 text-text-muted-light dark:text-text-muted-dark hover:text-primary transition-colors">
                    <span className="material-icons-round">notifications</span>
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full border-2 border-background-light dark:border-background-dark"></span>
                </button>
                <div className="flex items-center pl-4 border-l border-border-light dark:border-border-dark">
                    <div className="text-right mr-3 hidden sm:block">
                        <div className="text-sm font-semibold text-text-main-light dark:text-text-main-dark">Jürgen Thiemann</div>
                        <div className="text-xs text-text-muted-light dark:text-text-muted-dark">Senior HR Manager</div>
                    </div>
                    <div className="relative">
                        <div className="w-10 h-10 rounded-full bg-[#112240] border border-white/10 flex items-center justify-center text-white font-bold shadow-md">
                            JT
                        </div>
                    </div>
                </div>
            </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
          <div className="max-w-7xl mx-auto space-y-6">
            
            {/* Top Row: Score Card & Competencies */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Score Card */}
                <div className="lg:col-span-2 bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-2xl p-8 shadow-card-light dark:shadow-card-dark relative overflow-hidden">
                    {/* Background decoration */}
                    <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>

                    <div className="flex flex-col md:flex-row items-center md:items-start gap-8 relative z-10">
                        <div className="flex-shrink-0">
                            <CircularProgress value={displayScore} />
                        </div>
                        <div className="flex-1 text-center md:text-left">
                            <div className="flex flex-col md:flex-row items-center md:items-start gap-4 mb-3">
                                <h2 className="text-2xl font-bold text-text-main-light dark:text-text-main-dark">{scoreTitle}</h2>
                                <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${badge.cls}`}>
                                    {badge.label}
                                </span>
                            </div>
                            <p className="text-text-muted-light dark:text-text-muted-dark mb-6 leading-relaxed">
                                {result.summary || 'Keine Zusammenfassung verfügbar.'}
                            </p>
                            <div className="flex items-center justify-center md:justify-start gap-3">
                                <div className="px-4 py-2 bg-background-light dark:bg-background-dark/50 rounded-lg border border-border-light dark:border-border-dark/50 text-xs font-mono text-text-muted-light dark:text-text-muted-dark">
                                    Dauer: 45 min
                                </div>
                                <div className="px-4 py-2 bg-background-light dark:bg-background-dark/50 rounded-lg border border-border-light dark:border-border-dark/50 text-xs font-mono text-text-muted-light dark:text-text-muted-dark">
                                    Redeanteil: 40%
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Competencies */}
                <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-2xl p-6 shadow-card-light dark:shadow-card-dark flex flex-col">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="font-bold text-lg text-text-main-light dark:text-text-main-dark">Kompetenzen</h3>
                        <span className="text-xs px-2 py-1 bg-background-light dark:bg-white/10 rounded text-text-muted-light dark:text-text-muted-dark">Details</span>
                    </div>
                    <div className="space-y-6 overflow-y-auto pr-2 custom-scrollbar flex-1">
                        {competencies.length > 0 ? competencies.map((comp: any, i: number) => (
                            <div key={i} className="bg-background-light dark:bg-background-dark/30 rounded-xl p-4 border border-border-light dark:border-border-dark/30">
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="w-8 h-8 rounded-full bg-surface-light dark:bg-[#1C2C4E] flex items-center justify-center text-primary font-bold text-xs shadow-sm">
                                        C{i + 1}
                                    </div>
                                    <div className="font-medium text-text-main-light dark:text-text-main-dark flex-1">{comp.topic}</div>
                                    <div className="text-sm font-bold text-text-main-light dark:text-text-main-dark">{comp.score}/10</div>
                                </div>
                                <div className="h-1.5 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mb-3">
                                    <div 
                                        className="h-full bg-primary rounded-full" 
                                        style={{ width: `${(comp.score / 10) * 100}%` }} 
                                    />
                                </div>
                                <p className="text-xs text-text-muted-light dark:text-text-muted-dark italic border-l-2 border-primary/30 pl-2">
                                    "{comp.reasoning ? comp.reasoning.substring(0, 80) + '...' : ''}"
                                </p>
                            </div>
                        )) : (
                            <div className="text-center text-text-muted-light dark:text-text-muted-dark py-10">Keine Kompetenzdaten verfügbar.</div>
                        )}
                    </div>
                </div>
            </div>

            {/* Analysis Grid: Strengths, Potential, Risks */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <SectionCard 
                    title="Stärken" 
                    icon="verified" 
                    type="strength"
                    items={strengths} 
                />
                <SectionCard 
                    title="Potenzial" 
                    icon="bolt" 
                    type="potential"
                    items={potentials} 
                />
                <SectionCard 
                    title="Risiken" 
                    icon="warning" 
                    type="risk"
                    items={risks} 
                />
            </div>

            {/* Bottom Row: Practice & Rewrites */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 7-Day Practice */}
                <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-2xl p-6 shadow-card-light dark:shadow-card-dark">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-blue-500 flex items-center justify-center text-white shadow-lg shadow-blue-500/30">
                            <span className="font-bold">7</span>
                        </div>
                        <div>
                            <h3 className="font-bold text-lg text-text-main-light dark:text-text-main-dark">7-Tage-Praxis</h3>
                            <p className="text-xs text-text-muted-light dark:text-text-muted-dark">Konkrete Übung für die nächste Woche</p>
                        </div>
                    </div>
                    <div className="p-5 bg-background-light dark:bg-background-dark/50 rounded-xl border border-border-light dark:border-border-dark/50 text-text-main-light dark:text-text-main-dark leading-relaxed">
                        {practice || "Keine spezifische Übung generiert."}
                    </div>
                </div>

                {/* Rewrites */}
                <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-2xl p-6 shadow-card-light dark:shadow-card-dark">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-lg text-text-main-light dark:text-text-main-dark">Vorgeschlagene Umformulierungen</h3>
                        <span className="material-icons-round text-primary animate-pulse">auto_awesome</span>
                    </div>
                    <div className="space-y-4">
                        {rewrites.length > 0 ? rewrites.slice(0, 2).map((rw: any, i: number) => (
                            <div key={i} className="grid grid-cols-2 gap-4">
                                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/10 border-l-2 border-red-500">
                                    <div className="text-[10px] uppercase font-bold text-red-500 mb-1">Original</div>
                                    <p className="text-xs text-text-main-light dark:text-text-main-dark italic">"{rw.original}"</p>
                                </div>
                                <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/10 border-l-2 border-green-500">
                                    <div className="text-[10px] uppercase font-bold text-green-500 mb-1">Besser</div>
                                    <p className="text-xs text-text-main-light dark:text-text-main-dark">{rw.better}</p>
                                </div>
                            </div>
                        )) : (
                            <div className="text-center text-text-muted-light dark:text-text-muted-dark py-4">Keine Umformulierungen verfügbar.</div>
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
