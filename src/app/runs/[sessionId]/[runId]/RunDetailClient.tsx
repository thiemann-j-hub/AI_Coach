'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import ReportDashboard from '@/components/app/report-dashboard';

export default function RunDetailClient({
  sessionId,
  runId,
  resultForDashboard,
  createdAtIso,
}: {
  sessionId: string;
  runId: string;
  resultForDashboard: any;
  createdAtIso: string | null;
}) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  function newSessionId(): string {
    const c: any = globalThis.crypto as any;
    if (c?.randomUUID) return c.randomUUID();
    return `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function shortId(id?: string, n = 18) {
    const s = String(id ?? '');
    if (!s) return '—';
    if (s.length <= n) return s;
    return s.slice(0, n) + '…';
  }

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
            <Link href="/runs-dashboard" className="flex items-center px-4 py-3 text-text-muted-light dark:text-text-muted-dark hover:text-text-main-light dark:hover:text-text-main-dark hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg transition-all duration-200 group">
                <span className="material-icons-round mr-3 group-hover:scale-110 transition-transform">history</span>
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
              onClick={() => {
                const sid = newSessionId();
                try { localStorage.setItem('commscoach_sessionId', sid); } catch {}
                router.push(`/analyze?sessionId=${encodeURIComponent(sid)}`);
              }}
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
                <h2 className="text-lg font-bold text-text-main-light dark:text-text-main-dark leading-tight">Analyse-Ergebnis</h2>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-muted-light dark:text-text-muted-dark font-mono bg-surface-light dark:bg-surface-dark px-1.5 py-0.5 rounded border border-border-light dark:border-border-dark">
                    #{shortId(runId, 8)}
                  </span>
                  <span className="text-xs text-green-500 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                    Verarbeitung abgeschlossen
                  </span>
                </div>
            </div>
            <div className="flex items-center space-x-4">
                <button 
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark text-text-muted-light dark:text-text-muted-dark text-sm hover:border-primary transition-colors"
                  onClick={() => router.push(`/runs-dashboard?sessionId=${encodeURIComponent(sessionId)}`)}
                >
                  <span className="material-icons-round text-sm">history</span>
                  <span>Verlauf</span>
                </button>
                <button className="relative p-2 text-text-muted-light dark:text-text-muted-dark hover:text-primary transition-colors">
                    <span className="material-icons-round">notifications</span>
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full border-2 border-background-light dark:border-background-dark"></span>
                </button>
                <div className="flex items-center pl-4 border-l border-border-light dark:border-border-dark">
                    <div className="text-right mr-3 hidden sm:block">
                        <div className="text-sm font-semibold text-text-main-light dark:text-text-main-dark">Jürgen Thiemann</div>
                        <div className="text-xs text-text-muted-light dark:text-text-muted-dark cursor-pointer hover:text-primary">Logout</div>
                    </div>
                    <div className="relative">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center text-white font-bold shadow-md">
                            JT
                        </div>
                    </div>
                </div>
            </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 scroll-smooth bg-[#080C14]">
          {/* We pass the result to ReportDashboard but we might need to style it to fit the dark theme better if it uses hardcoded colors. 
              The attached design shows a very dark/sleek UI. ReportDashboard might need tweaks or we wrap it in a container that forces dark mode context.
          */}
          <ReportDashboard runResult={resultForDashboard} />
        </div>
      </main>

      {/* Mobile Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setMobileOpen(false)}></div>
      )}
    </div>
  );
}
