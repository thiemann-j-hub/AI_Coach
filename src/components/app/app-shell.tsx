'use client';

import { useTheme } from 'next-themes';
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
  const { theme, setTheme } = useTheme();

  const nav: NavItem[] = useMemo(
    () => [
      { href: '/analyze', label: 'Analyse', icon: 'analytics' },
      { href: '/runs-dashboard', label: 'Verlauf', icon: 'history' },
      { href: '/design-preview', label: 'Design-Preview', icon: 'grid_view' },
    ],
    []
  );

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    // Treat runs details as part of Analyze flow for sidebar highlighting
    if (href === '/analyze' && pathname.startsWith('/runs/')) return true;
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
            'fixed inset-y-0 left-0 z-50 w-64 bg-surface-light dark:bg-surface-dark border-r border-border-light dark:border-border-dark flex-col transition-transform duration-300 md:translate-x-0 md:static md:flex',
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <div className="p-6 relative">
            <button
              className="md:hidden absolute top-4 right-4 inline-flex items-center justify-center rounded-xl p-2 hover:bg-white/5 transition-colors"
              onClick={() => setMobileOpen(false)}
              aria-label="Close"
            >
              <span className="material-icons-round">close</span>
            </button>

            <Link href="/analyze" className="block">
              <h1 className="font-display font-bold text-2xl tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-400">
                  PulseCraft AI
              </h1>
            </Link>
          </div>

          <nav className="flex-1 px-4 space-y-2 overflow-y-auto">
            {nav.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cx(
                    'flex items-center px-4 py-3 rounded-lg transition-all duration-200 group',
                    active
                      ? 'bg-primary/10 text-primary border-l-4 border-primary'
                      : 'text-text-muted-light dark:text-text-muted-dark hover:text-text-main-light dark:hover:text-text-main-dark hover:bg-gray-100 dark:hover:bg-white/5 border-transparent'
                  )}
                >
                  <span className={cx('material-icons-round mr-3', !active && 'group-hover:scale-110 transition-transform')}>{item.icon}</span>
                  <span className="font-medium">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="p-4 mt-auto border-t border-border-light dark:border-border-dark">
            <button
              className="w-full btn-gradient text-white font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-2 shadow-glow active:scale-[0.98] transition-transform"
              onClick={() => router.push('/analyze')}
            >
              <span className="material-icons-round text-xl">add_circle_outline</span>
              <span>Neue Analyse</span>
            </button>
          </div>

          <div className="px-4 pb-4">
            <button 
              className="flex items-center justify-center w-full py-2 text-xs text-text-muted-light dark:text-text-muted-dark hover:bg-gray-100 dark:hover:bg-white/5 rounded transition-colors" 
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              <span className="material-icons-round text-base mr-2">brightness_6</span> Toggle Theme
            </button>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 flex flex-col min-w-0 bg-background relative overflow-hidden">
          {/* Background Glows for Glassmorphism Context */}
          <div className="absolute top-[-10%] left-[-5%] w-[30%] h-[30%] bg-primary/15 blur-[120px] rounded-full pointer-events-none z-0" />
          <div className="absolute bottom-[-10%] right-[-5%] w-[30%] h-[30%] bg-accent/10 blur-[120px] rounded-full pointer-events-none z-0" />

          <header className="h-16 flex items-center justify-between px-4 md:px-8 bg-card/70 backdrop-blur-md border-b border-border sticky top-0 z-30">
            <div className="flex items-center gap-3 min-w-0">
              <button
                className="md:hidden inline-flex items-center justify-center rounded-xl p-2 hover:bg-white/5 transition-colors"
                onClick={() => setMobileOpen(true)}
                aria-label="Open menu"
              >
                <span className="material-icons-round">menu</span>
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
                <span className="material-icons-round">notifications</span>
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
