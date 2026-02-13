'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { LoginModal } from '@/components/auth/login-modal';
import { UserNav } from '@/components/auth/user-nav';

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
  const { user } = useAuth();

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
    <div className="min-h-screen bg-background text-foreground font-sans">
      <div className="flex h-screen overflow-hidden">
        {/* Mobile backdrop */}
        {mobileOpen ? (
          <button
            aria-label="Close menu"
            className="fixed inset-0 z-40 bg-black/60 md:hidden backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
        ) : null}

        {/* Sidebar */}
        <aside
          className={cx(
            'fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-card border-r border-border md:static md:z-auto md:w-64',
            mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
            'transition-transform duration-200'
          )}
        >
          <div className="h-16 flex items-center justify-between px-5 border-b border-border">
            <button
              className="md:hidden inline-flex items-center justify-center rounded-xl p-2 hover:bg-white/5 transition-colors"
              onClick={() => setMobileOpen(false)}
              aria-label="Close"
            >
              <span className="material-symbols-outlined">close</span>
            </button>

            <div className="flex items-center gap-2 w-full">
              <Link href="/analyze" className="block w-full py-4">
                 {/* Logo Placeholder - Text Gradient style */}
                 <div className="text-xl font-bold tracking-tight text-gradient">
                   PulseCraft AI
                 </div>
              </Link>
            </div>
          </div>

          <nav className="px-3 py-4 space-y-1">
            {nav.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cx(
                    'flex items-center gap-3 px-3 py-2 rounded-xl border text-sm transition-all duration-200',
                    active
                      ? 'bg-primary/10 text-primary border-primary/20 shadow-neon'
                      : 'text-muted-foreground border-transparent hover:bg-white/5 hover:text-foreground'
                  )}
                >
                  <span className="material-symbols-outlined">{item.icon}</span>
                  <span className={cx(active ? 'font-bold' : 'font-medium')}>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto p-4 border-t border-border">
            <button
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary hover:bg-primary-dark text-primary-foreground font-bold transition-all shadow-neon active:scale-[0.98]"
              onClick={() => router.push('/analyze')}
            >
              <span className="material-symbols-outlined text-[20px]">add_circle</span>
              <span>Neue Analyse</span>
            </button>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 flex flex-col min-w-0 bg-background/50 relative">
          {/* Background Gradient Effect (optional) */}
          <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-primary/5 to-transparent pointer-events-none" />

          <header className="h-16 flex items-center justify-between px-4 md:px-8 bg-card/80 backdrop-blur-md border-b border-border sticky top-0 z-30">
            <div className="flex items-center gap-3 min-w-0">
              <button
                className="md:hidden inline-flex items-center justify-center rounded-xl p-2 hover:bg-white/5 transition-colors"
                onClick={() => setMobileOpen(true)}
                aria-label="Open menu"
              >
                <span className="material-symbols-outlined">menu</span>
              </button>
              <div className="min-w-0">
                <div className="text-lg font-bold tracking-tight truncate text-foreground">{props.title}</div>
                {props.subtitle ? (
                  <div className="text-xs text-muted-foreground truncate">{props.subtitle}</div>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-3 md:gap-4">
              {props.actions}
              <button
                className="relative inline-flex items-center justify-center rounded-xl p-2 hover:bg-white/5 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Notifications"
              >
                <span className="material-symbols-outlined">notifications</span>
                <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-accent shadow-neon" />
              </button>
              
              {user ? (
                <UserNav />
              ) : (
                <LoginModal>
                  <button className="w-9 h-9 rounded-full bg-surface-light border border-white/5 flex items-center justify-center text-muted-foreground text-sm font-bold hover:bg-white/10 transition-colors">
                    ?
                  </button>
                </LoginModal>
              )}
            </div>
          </header>

          <div className="flex-1 overflow-y-auto p-4 md:p-8 relative z-10">
            {props.children}
          </div>
        </main>
      </div>
    </div>
  );
}
