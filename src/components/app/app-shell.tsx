'use client';

import { useTheme } from 'next-themes';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { useTranslation } from '@/i18n/useTranslation';
import { LoginModal } from '@/components/auth/login-modal';
import { UserNav } from '@/components/auth/user-nav';
import { LanguageSwitcher } from '@/components/language-switcher';

type NavItem = {
  href: string;
  labelKey: 'analyze' | 'history';
  icon: string;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export default function AppShell(props: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  /** If true, children fill the entire main area without default padding */
  noPadding?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  // resolvedTheme is only known on the client — guard against hydration mismatch
  const [mounted, setMounted] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === 'dark';

  const nav: NavItem[] = useMemo(
    () => [
      { href: '/analyze', labelKey: 'analyze' as const, icon: 'analytics' },
      { href: '/runs-dashboard', labelKey: 'history' as const, icon: 'history' },
    ],
    []
  );

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    if (href === '/analyze' && pathname.startsWith('/runs/')) return true;
    return pathname === href || pathname.startsWith(href + '/');
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <div className="flex h-screen overflow-hidden">
        {/* Mobile backdrop */}
        {mobileOpen && (
          <button
            aria-label={t.common.closeMenu}
            className="fixed inset-0 z-40 bg-black/60 md:hidden backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={cx(
            'fixed inset-y-0 left-0 z-50 w-64 flex flex-col transition-transform duration-300 md:translate-x-0 md:static md:flex',
            'bg-card border-r border-border',
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          {/* Logo */}
          <div className="flex h-16 items-center border-b border-border px-6">
            <button
              className="md:hidden absolute top-4 right-4 inline-flex items-center justify-center rounded-lg p-2 hover:bg-foreground/5 transition-colors text-muted-foreground"
              onClick={() => setMobileOpen(false)}
              aria-label={t.common.close}
            >
              <span className="material-icons-round text-xl">close</span>
            </button>
            <Link href="/analyze" className="block">
              <h1 className="font-display font-bold text-xl tracking-tight text-gradient">
                PulseCraft AI
              </h1>
            </Link>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-1 p-4 overflow-y-auto custom-scrollbar">
            {nav.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cx(
                    'flex items-center px-4 py-3 rounded-lg transition-all duration-200 group',
                    active
                      ? 'bg-primary/10 text-primary font-semibold shadow-primary-glow/20'
                      : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5'
                  )}
                >
                  <span className={cx('material-icons-round mr-3 text-xl', !active && 'group-hover:scale-110 transition-transform')}>
                    {item.icon}
                  </span>
                  <span className="text-sm font-medium">{t.nav[item.labelKey]}</span>
                </Link>
              );
            })}
          </nav>

          {/* New Analysis Button */}
          <div className="p-4 border-t border-border">
            <button
              className="w-full btn-gradient text-white font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-2 shadow-neon active:scale-[0.98] transition-transform"
              onClick={() => router.push('/analyze')}
            >
              <span className="material-icons-round text-xl">add_circle_outline</span>
              <span>{t.nav.newAnalysis}</span>
            </button>
          </div>

          {/* Theme Toggle + Language Switcher */}
          <div className="px-4 pb-4 space-y-1">
            <button
              className="flex items-center justify-center w-full py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-foreground/5 rounded-lg transition-colors"
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
            >
              <span className="material-icons-round text-base mr-2">
                {isDark ? 'light_mode' : 'dark_mode'}
              </span>
              {isDark ? t.common.lightMode : t.common.darkMode}
            </button>
            <div className="flex items-center justify-center w-full py-2">
              <LanguageSwitcher />
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main id="main-content" className="flex-1 flex flex-col min-w-0 bg-background relative overflow-hidden">
          {/* Decorative Background Blobs */}
          <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
            <div className="absolute -left-40 -top-40 h-[500px] w-[500px] rounded-full bg-primary/5 blur-3xl" />
            <div className="absolute -right-40 top-1/3 h-[400px] w-[400px] rounded-full bg-accent/5 blur-3xl" />
          </div>

          {/* Header */}
          <header className="glass-header sticky top-0 z-30 flex h-16 items-center justify-between px-4 md:px-8">
            <div className="flex items-center gap-3 min-w-0">
              <button
                className="md:hidden inline-flex items-center justify-center rounded-lg p-2 hover:bg-foreground/5 transition-colors text-muted-foreground"
                onClick={() => setMobileOpen(true)}
                aria-label={t.common.openMenu}
              >
                <span className="material-icons-round">menu</span>
              </button>
              <div className="min-w-0">
                <div className="text-lg font-bold tracking-tight truncate text-foreground">{props.title}</div>
                {props.subtitle && (
                  <div className="text-xs text-muted-foreground truncate font-mono">{props.subtitle}</div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 md:gap-4">
              {props.actions}

              {user ? (
                <UserNav />
              ) : (
                <LoginModal>
                  <button className="w-9 h-9 rounded-full bg-secondary border border-border flex items-center justify-center text-muted-foreground text-sm font-bold hover:bg-foreground/10 transition-colors">
                    ?
                  </button>
                </LoginModal>
              )}
            </div>
          </header>

          {/* Content Area */}
          <div className={cx(
            'flex-1 overflow-y-auto relative z-10 custom-scrollbar',
            !props.noPadding && 'p-4 md:p-8'
          )}>
            {props.children}
          </div>
        </main>
      </div>
    </div>
  );
}
