'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';

type NavItem = {
  href: string;
  label: string;
  icon: string; // Material Symbols name
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export default function AppShell(props: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const nav: NavItem[] = useMemo(
    () => [
      { href: '/analyze', label: 'Analyse', icon: 'analytics' },
      { href: '/runs-dashboard', label: 'Verlauf', icon: 'history' },
      { href: '/design-preview', label: 'Design-Preview', icon: 'dashboard_customize' },
    ],
    []
  );

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(href + '/');
  };

  return (
    <div className="min-h-screen bg-[#060B14] text-slate-100">
      <div className="flex h-screen overflow-hidden">
        {/* Mobile backdrop */}
        {mobileOpen ? (
          <button
            aria-label="Close menu"
            className="fixed inset-0 z-40 bg-black/60 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
        ) : null}

        {/* Sidebar */}
        <aside
          className={cx(
            'fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-[#0B1221] border-r border-[#1F2937] md:static md:z-auto md:w-64',
            mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
            'transition-transform duration-200'
          )}
        >
          <div className="h-16 flex items-center justify-between px-5 border-b border-[#1F2937]">
            <button
              className="md:hidden inline-flex items-center justify-center rounded-xl p-2 hover:bg-white/5"
              onClick={() => setMobileOpen(false)}
              aria-label="Close"
            >
              <span className="material-symbols-outlined">close</span>
            </button>

            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-sky-400/15 border border-sky-400/20 text-sky-400">
                <span className="material-symbols-outlined">auto_awesome</span>
              </span>
              <div className="px-4 py-4 border-b border-white/10">
  <Link href="/analyze" className="block">
    <Image
      src="/pulscraft_logo_transparent.png"
      alt="Pulscraft AI"
      width={520}
      height={140}
      priority
      className="w-full h-auto"
    />
  </Link>
</div>
            </div>

            <div className="w-10 md:w-0" />
          </div>

          <nav className="px-3 py-4 space-y-1">
            {nav.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cx(
                    'flex items-center gap-3 px-3 py-2 rounded-xl border text-sm transition-colors',
                    active
                      ? 'bg-sky-400/10 text-sky-400 border-sky-400/20'
                      : 'text-slate-300 border-transparent hover:bg-white/5 hover:text-white'
                  )}
                >
                  <span className="material-symbols-outlined">{item.icon}</span>
                  <span className={cx(active ? 'font-semibold' : 'font-medium')}>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto p-4 border-t border-[#1F2937]">
            <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-white/5 border border-white/10">
              <div className="w-9 h-9 rounded-full bg-sky-400/15 border border-sky-400/20 flex items-center justify-center text-sky-400 text-sm font-semibold">
                MM
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">Demo</div>
                <div className="text-xs text-slate-400 truncate">ohne Login</div>
              </div>
              <button
                className="ml-auto text-slate-400 hover:text-white"
                onClick={() => router.push('/analyze')}
                aria-label="Neue Analyse"
                title="Neue Analyse"
              >
                <span className="material-symbols-outlined">add</span>
              </button>
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 flex flex-col min-w-0">
          <header className="h-16 flex items-center justify-between px-4 md:px-8 bg-[#0B1221]/70 backdrop-blur border-b border-[#1F2937]">
            <div className="flex items-center gap-3 min-w-0">
              <button
                className="md:hidden inline-flex items-center justify-center rounded-xl p-2 hover:bg-white/5"
                onClick={() => setMobileOpen(true)}
                aria-label="Open menu"
              >
                <span className="material-symbols-outlined">menu</span>
              </button>
              <div className="min-w-0">
                <div className="text-lg font-semibold tracking-tight truncate">{props.title}</div>
                {props.subtitle ? (
                  <div className="text-xs text-slate-400 truncate">{props.subtitle}</div>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2 md:gap-3">
              {props.actions}
              <button
                className="relative inline-flex items-center justify-center rounded-xl p-2 hover:bg-white/5 text-slate-300"
                aria-label="Notifications"
              >
                <span className="material-symbols-outlined">notifications</span>
                <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-red-500" />
              </button>
              <div className="w-9 h-9 rounded-full bg-sky-400/15 border border-sky-400/20 flex items-center justify-center text-sky-400 text-sm font-semibold">
                MM
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto p-4 md:p-8">{props.children}</div>
        </main>
      </div>
    </div>
  );
}
