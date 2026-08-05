'use client';

import { useTheme } from 'next-themes';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  History,
  MessagesSquare,
  Users,
  PlusCircle,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Menu,
  X,
  LogOut,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import { useTranslation } from '@/i18n/useTranslation';
import { signOut } from '@/lib/auth-service';
import { useToast } from '@/hooks/use-toast';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { LoginModal } from '@/components/auth/login-modal';
import { LanguageSwitcher } from '@/components/language-switcher';
import { PulscraftMark } from '@/components/pulscraft-wordmark';
import { CreditBalance } from '@/components/app/credit-balance';
import { AppSwitcher } from '@/components/app/app-switcher';

type NavItem = { href: string; label: string; icon: LucideIcon };
type NavGroup = { label: string; items: NavItem[] };

const COLLAPSE_KEY = 'coach_sidebar-collapsed';

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
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  // resolvedTheme is only known on the client — guard against hydration mismatch
  const [mounted, setMounted] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    setMounted(true);
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  const isDark = mounted && resolvedTheme === 'dark';
  const { toast } = useToast();

  async function onSignOut() {
    const { error } = await signOut();
    if (error) {
      toast({
        title: t.auth.signOutFailed,
        description: error.message,
        variant: 'destructive',
      });
    }
  }

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  // MAIN-Gruppe (Coach hat keine ADMIN-Routen — Struktur bleibt erweiterbar).
  const groups: NavGroup[] = useMemo(
    () => [
      {
        label: 'MAIN',
        items: [
          { href: '/analyze', label: t.nav.analyze, icon: BarChart3 },
          { href: '/simulation', label: t.nav.simulation, icon: MessagesSquare },
          { href: '/runs-dashboard', label: t.nav.history, icon: History },
          // Kein Credits-Eintrag mehr: der Header-Chip regelt die Credits
          // (Owner-Vorgabe 04.08. — /credits bleibt als Route erreichbar).
          { href: '/workspace', label: t.nav.workspace, icon: Users },
        ],
      },
    ],
    [t]
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
            'fixed inset-y-0 left-0 z-50 flex flex-col transition-all duration-300 md:translate-x-0 md:static md:flex',
            'bg-card border-r border-border',
            collapsed ? 'md:w-[72px]' : 'md:w-64',
            'w-64',
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          {/* Logo / Wordmark */}
          <div className="flex h-16 items-center border-b border-border px-4">
            <button
              className="md:hidden absolute top-4 right-4 inline-flex items-center justify-center rounded-lg p-2 hover:bg-foreground/5 transition-colors text-muted-foreground"
              onClick={() => setMobileOpen(false)}
              aria-label={t.common.close}
            >
              <X className="h-5 w-5" />
            </button>
            {/* Brand-Block (einheitliche Studio-Optik, Owner-Vorgabe 04.08.):
                eckiges Logo + Wortmarke, App-Name DARUNTER. ZWEI Geschwister-
                Links (kein <a> im <a>): Marke+Logo -> Hub als plain ROOT-
                absolutes <a href="/"> (next/link wuerde den basePath /coach
                anhaengen); App-Name -> /analyze via next/link (basePath-aware).
                Geometrie wie Studio: Icon h-8 + gap-2.5 => ml-[42px]/-mt-2.5. */}
            {collapsed ? (
              <a href="/" className="block transition-opacity hover:opacity-80" aria-label="PulseNorth Hub">
                <PulscraftMark />
              </a>
            ) : (
              <div className="flex flex-col items-start leading-none">
                <a
                  href="/"
                  className="flex items-start gap-2.5 transition-opacity hover:opacity-80"
                  aria-label="PulseNorth Hub"
                >
                  <PulscraftMark />
                  <span className="text-lg font-bold tracking-tight">
                    <span className="text-foreground">PulseNorth</span>
                    <span className="text-primary">.AI</span>
                  </span>
                </a>
                <Link
                  href="/analyze"
                  className="-mt-2.5 ml-[42px] text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Coach Startseite"
                >
                  Coach
                </Link>
              </div>
            )}
          </div>

          {/* Navigation (MAIN / …) */}
          <nav className="flex-1 space-y-6 p-3 overflow-y-auto custom-scrollbar">
            {groups.map((group) => (
              <div key={group.label} className="space-y-1">
                {!collapsed && (
                  <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.label}
                  </p>
                )}
                {group.items.map((item) => {
                  const active = isActive(item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      className={cx(
                        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors group',
                        collapsed && 'justify-center',
                        active
                          ? 'border border-primary/20 bg-primary/10 text-primary font-semibold'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
                      <Icon className={cx('h-5 w-5 shrink-0', !active && 'group-hover:scale-110 transition-transform')} />
                      {!collapsed && <span className="font-medium">{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* New Analysis Button */}
          <div className="p-3 border-t border-border">
            <button
              className={cx(
                'w-full btn-gradient text-white font-semibold rounded-xl flex items-center justify-center gap-2 shadow-neon active:scale-[0.98] transition-transform',
                collapsed ? 'py-2.5 px-0' : 'py-3 px-4'
              )}
              onClick={() => router.push('/analyze')}
              title={collapsed ? t.nav.newAnalysis : undefined}
            >
              <PlusCircle className="h-5 w-5 shrink-0" />
              {!collapsed && <span>{t.nav.newAnalysis}</span>}
            </button>
          </div>

          {/* Footer: Theme toggle + Collapse toggle */}
          <div className="px-3 pb-3 space-y-1 border-t border-border pt-3">
            <button
              className={cx(
                'flex items-center w-full py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors',
                collapsed ? 'justify-center' : 'justify-center'
              )}
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              title={isDark ? t.common.lightMode : t.common.darkMode}
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {!collapsed && <span className="ml-2">{isDark ? t.common.lightMode : t.common.darkMode}</span>}
            </button>
            {/* Collapse-Toggle (Desktop) */}
            <button
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Sidebar ausklappen' : 'Sidebar einklappen'}
              className="hidden md:flex w-full items-center justify-center rounded-lg border border-border bg-muted py-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          </div>

          {/* User-Footer (einheitliche Studio-Optik, Owner-Vorgabe 04.08.:
              Avatar + Name + E-Mail + Abmelden unten in der Sidebar; die
              Coach-Einzelfunktion Einstellungen wandert als Zahnrad mit). */}
          {user && (
            <div className={cx('flex items-center gap-3 border-t border-border p-3', collapsed && 'justify-center')}>
              <Avatar className="h-9 w-9 shrink-0 border border-border">
                <AvatarImage src={user.photoURL || ''} alt={user.displayName || t.auth.user} />
                <AvatarFallback className="bg-gradient-to-br from-primary to-accent text-sm font-medium text-white">
                  {(user.displayName?.charAt(0) || user.email?.charAt(0) || 'U').toUpperCase()}
                </AvatarFallback>
              </Avatar>
              {!collapsed && (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{user.displayName || t.auth.user}</p>
                    <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                  </div>
                  <Link
                    href="/settings"
                    title="Einstellungen"
                    aria-label="Einstellungen"
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Settings className="h-4 w-4" />
                  </Link>
                  <button
                    onClick={onSignOut}
                    title={t.auth.signOut}
                    aria-label={t.auth.signOut}
                    className="text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
          )}
        </aside>

        {/* Main Content */}
        <main id="main-content" className="flex-1 flex flex-col min-w-0 bg-background relative overflow-hidden">
          {/* Decorative Background Blobs */}
          <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
            <div className="absolute -left-40 -top-40 h-[500px] w-[500px] rounded-full bg-primary/5 blur-3xl" />
            <div className="absolute -right-40 top-1/3 h-[400px] w-[400px] rounded-full bg-accent/5 blur-3xl" />
          </div>

          {/* Header */}
          <header className="glass-header sticky top-0 z-30 flex h-16 items-center justify-between px-4 lg:px-6">
            <div className="flex items-center gap-3 min-w-0">
              <button
                className="md:hidden inline-flex items-center justify-center rounded-lg p-2 hover:bg-foreground/5 transition-colors text-muted-foreground"
                onClick={() => setMobileOpen(true)}
                aria-label={t.common.openMenu}
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <div className="text-lg font-bold tracking-tight truncate text-foreground">{props.title}</div>
                {props.subtitle && (
                  <div className="text-xs text-muted-foreground truncate font-mono">{props.subtitle}</div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 md:gap-3">
              {props.actions}
              {/* M3-1: aus jeder App in jede App (Plattform-Kohäsion) */}
              <AppSwitcher />
              <CreditBalance />
              <LanguageSwitcher compact />
              {/* User-Anzeige lebt jetzt einheitlich unten in der Sidebar
                  (Owner-Vorgabe 04.08.) — der Header zeigt nur noch den
                  Login-Einstieg fuer nicht angemeldete Besucher. */}
              {!user && (
                <LoginModal>
                  <button className="w-9 h-9 rounded-full bg-secondary border border-white/10 flex items-center justify-center text-muted-foreground text-sm font-bold hover:bg-foreground/10 transition-colors">
                    ?
                  </button>
                </LoginModal>
              )}
            </div>
          </header>

          {/* Content Area */}
          <div className={cx(
            'flex-1 overflow-y-auto relative z-10 custom-scrollbar',
            !props.noPadding && 'p-4 lg:p-6'
          )}>
            {props.children}
          </div>
        </main>
      </div>
    </div>
  );
}
