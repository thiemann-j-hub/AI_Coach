'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ReportDashboard, { CompetencyPanel } from '@/components/app/report-dashboard';

export default function DesignPreviewPage() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem('theme');
    const isDark = t === 'dark';
    setDark(isDark);
    document.documentElement.classList.toggle('dark', isDark);
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', next);
  }

  const sample = useMemo(() => {
    return {
      summary:
        'Sie haben eine starke Empathie gezeigt und klare Ziele gesetzt. Die Gesprächsführung war strukturiert und lösungsorientiert. Besonders positiv: Sie haben Raum für Eigenverantwortung gelassen.',
      strengths: [
        'Aktives Zuhören und Paraphrasieren',
        'Wertschätzende Kommunikation',
        'Förderung der Eigenverantwortung',
      ],
      improvements: ['Konkretere Zielvereinbarungen am Ende', 'Weniger geschlossene Fragen nutzen'],
      riskFlags: [
        'Achten Sie darauf, nicht zu schnell in den „Lösungsmodus“ zu wechseln. Der/die Mitarbeitende sollte die Lösung selbst entwickeln.',
        'Gefahr: zu viele Ratschläge statt Leitfragen.',
      ],
      rewrites: [
        'Original: "Warum hast du das so gemacht?" Rewrite: "Was waren deine Überlegungen bei dieser Entscheidung?"',
        'Original: "Das müssen wir ändern." Rewrite: "Wie könnten wir das in Zukunft anders gestalten?"',
      ],
      practice7Days:
        'Lassen Sie in den nächsten Gesprächen bewusst Pausen (mind. 3 Sekunden), damit der/die Mitarbeitende nachdenken und selbst formulieren kann.',
      scores: { overall: 8.6 },
      competency_ratings: [
        { id: 'C1', title: 'Empathie', score: 4, reason: 'Sehr gutes Eingehen auf Signale.', quotes: ['„Ich verstehe, dass dich das belastet.“'] },
        { id: 'C2', title: 'Lösungsorientierung', score: 3, reason: 'Gute Struktur – manchmal etwas schnell.', quotes: ['„Was brauchst du, um…?“'] },
        { id: 'C3', title: 'Strukturierung', score: 2, reason: 'Phasen erkennbar, Abschluss könnte klarer sein.', quotes: [] },
        { id: 'C4', title: 'Fragetechnik', score: null, reason: 'Nicht ausreichend beobachtbar.', quotes: [] },
      ],
    };
  }, []);

  return (
    <div className="h-screen flex overflow-hidden bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
      {/* Left sidebar (Desktop) */}
      <aside className="w-64 bg-white dark:bg-[#0B1221] border-r border-gray-200 dark:border-gray-800 hidden md:flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2 font-bold text-xl tracking-tight text-slate-800 dark:text-white">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-[hsl(var(--primary))] to-blue-600 flex items-center justify-center text-white shadow-lg"
              style={{ boxShadow: '0 12px 24px rgba(56,189,248,0.20)' }}
            >
              ✦
            </span>
            Gesprächs‑Coach
          </div>
        </div>

        <nav className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
          <Link
            className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg bg-blue-50 dark:bg-[hsl(var(--primary))/0.10] text-[hsl(var(--primary))] transition-colors"
            href="/design-preview"
          >
            Analyse Bericht
          </Link>

          <span className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg text-gray-600 dark:text-[hsl(var(--muted-foreground))]">
            Verlauf (später)
          </span>
        </nav>

        <div className="p-4 border-t border-gray-200 dark:border-gray-800">
          <button
            type="button"
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition"
            onClick={toggleTheme}
          >
            {dark ? 'Light Mode' : 'Dark Mode'}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <header className="h-16 flex items-center justify-between px-6 bg-white/80 dark:bg-[#0B1221]/90 backdrop-blur-md border-b border-gray-200 dark:border-gray-800 sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <button className="md:hidden p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800" onClick={toggleTheme} title="Theme">
              ☰
            </button>
            <div>
              <h1 className="text-lg font-bold text-gray-800 dark:text-white">Meeting Analyse</h1>
              <p className="text-xs text-gray-500 hidden sm:block">Design‑Preview • nur Optik</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button className="hidden sm:flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 transition">
              Exportieren
            </button>
            <button className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 transition" title="Benachrichtigungen">
              🔔
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto space-y-6">
            <ReportDashboard
              result={sample}
              metaChips={[
                { label: 'Dauer', value: '45 min' },
                { label: 'Redeanteil', value: '40%' },
              ]}
            />
          </div>
        </main>
      </div>

      {/* Right sidebar (Desktop XL): Competencies */}
      <aside className="w-80 bg-white dark:bg-[#0B1221] border-l border-gray-200 dark:border-gray-800 hidden xl:flex flex-col">
        <div className="h-16 flex items-center justify-between px-5 border-b border-gray-200 dark:border-gray-800">
          <h3 className="font-bold text-gray-900 dark:text-white">Kompetenzen</h3>
          <span className="text-xs font-medium px-2 py-1 bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-300 rounded-md">
            {Array.isArray(sample.competency_ratings) ? sample.competency_ratings.length : 0} Details
          </span>
        </div>
        <CompetencyPanel competencies={sample.competency_ratings} />
      </aside>
    </div>
  );
}
