'use client';

import { useTheme } from 'next-themes';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';
import {
  History,
  MessagesSquare,
  Users,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Menu,
  X,
  LogOut,
  Settings,
  Home as HomeIcon,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import { useTranslation } from '@/i18n/useTranslation';
import { signOut } from '@/lib/auth-service';
import { useToast } from '@/hooks/use-toast';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LoginModal } from '@/components/auth/login-modal';
import { LanguageSwitcher } from '@/components/language-switcher';
import { BrandSwitcher } from '@/components/app/app-switcher';
import { CreditBalance } from '@/components/app/credit-balance';

type NavItem = { href: string; label: string; icon: LucideIcon };
type NavGroup = { label: string; items: NavItem[] };

const COLLAPSE_KEY = 'coach_sidebar-collapsed';

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

/** Standard-Initialen-Regel (Owner-Vorgabe 16.08., alle Apps gleich):
 *  Anfangsbuchstaben der ersten beiden Namensworte ("Jürgen Thiemann" -> JT). */
function initialsOf(name?: string | null, email?: string | null): string {
  const base = (name || email || '').trim();
  if (!base) return 'U';
  const parts = base.split(/\s+/).filter(Boolean);
  return (parts.map((p) => p[0]).join('').toUpperCase().slice(0, 2)) || 'U';
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
  // W1-3 (COACH-UX-BLUEPRINT): EIN Punkt »Üben« ersetzt die zwei Punkte
  // Transkript-Analyse + Rollenspiel-Sitzung — beide Wege leben am Einstieg.
  const groups: NavGroup[] = useMemo(
    () => [
      {
        label: t.nav.mainGroup,
        items: [
          { href: '/', label: t.nav.practice, icon: MessagesSquare },
          { href: '/runs-dashboard', label: t.nav.history, icon: History },
          // Kein Credits-Eintrag mehr: der Header-Chip regelt die Credits.
          // Welle D (IA-Masterplan 15.08.): /workspace ist ABGERISSEN — Team-
          // Verwaltung lebt ausschliesslich zentral in Team & Zugaenge (Hub).
        ],
      },
    ],
    [t]
  );

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const isActive = (href: string) => {
    // »Üben« ist der Einstieg — aktiv auch für beide Zuflüsse (W1-3).
    if (href === '/') {
      return (
        pathname === '/' ||
        pathname.startsWith('/analyze') ||
        pathname.startsWith('/simulation')
      );
    }
    // »Verlauf« deckt auch die Ergebnis-Detailseiten der Analysen ab.
    if (href === '/runs-dashboard' && pathname.startsWith('/runs/')) return true;
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
            {/* Brand-Block = App-Umschalter (Synthesia-Stil, Owner-Vorgabe
                04.08.): Logo + Wortmarke + App-Name mit Dropdown der anderen
                PulseNorth-Apps — ersetzt das Rastersymbol im Header. */}
            <BrandSwitcher collapsed={collapsed} />
          </div>

          {/* Navigation (MAIN / …) */}
          <nav className="flex-1 space-y-6 p-3 overflow-y-auto custom-scrollbar">
            {/* Home (Synthesia-Muster): fuehrt zur PulseNorth-Startseite (Hub).
                ROOT-absolutes <a> — next/link wuerde den basePath /coach anhaengen. */}
            <a
              href="/"
              title={collapsed ? t.nav.home : undefined}
              className={cx(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors group text-muted-foreground hover:bg-muted hover:text-foreground',
                collapsed && 'justify-center'
              )}
            >
              <HomeIcon className="h-5 w-5 shrink-0 group-hover:scale-110 transition-transform" />
              {!collapsed && <span className="font-medium">{t.nav.home}</span>}
            </a>
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

          {/* Der Gradient-CTA »Neue Analyse« entfällt ersatzlos (W1-3):
              der Einstieg IST die Startaktion — sein permanentes Heraus-
              Navigieren aus laufenden Rollenspielen war Bruch 10. */}

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
              aria-label={collapsed ? t.common.expandSidebar : t.common.collapseSidebar}
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
                  {initialsOf(user.displayName, user.email)}
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
                    title={t.nav.settings}
                    aria-label={t.nav.settings}
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

            {/* L3 Look-and-Feel (Owner-Auftrag 15.08., Standard = Studio):
                Reihenfolge IMMER Credits → Sprache (Flagge + Wort) → rundes
                Avatar mit Menü. Verbindlich: pulsenorth-ops/
                SHELL-STANDARD-LOOK-AND-FEEL.md */}
            <div className="flex items-center gap-2 md:gap-3">
              {props.actions}
              <CreditBalance />
              <LanguageSwitcher />
              {user ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="flex items-center rounded-full transition-opacity hover:opacity-85"
                      aria-label={user.displayName || t.auth.user}
                    >
                      <Avatar className="h-8 w-8 border border-border">
                        <AvatarImage src={user.photoURL || ''} alt={user.displayName || t.auth.user} />
                        <AvatarFallback className="bg-gradient-to-br from-primary to-accent text-xs font-semibold text-white">
                          {initialsOf(user.displayName, user.email)}
                        </AvatarFallback>
                      </Avatar>
                    </button>
                  </DropdownMenuTrigger>
                  {/* Standard-Menue (Owner-Vorgabe 16.08., in ALLEN Apps
                      identisch): Name/E-Mail -> Profil -> Einstellungen ->
                      Abmelden. */}
                  <DropdownMenuContent align="end" className="w-56">
                    <div className="px-2 py-1.5">
                      <p className="truncate text-sm font-medium text-foreground">
                        {user.displayName || t.auth.user}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href="/profile" className="gap-2 cursor-pointer">
                        <UserRound className="h-4 w-4" />
                        {t.nav.profile}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/settings" className="gap-2 cursor-pointer">
                        <Settings className="h-4 w-4" />
                        {t.nav.settings}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={onSignOut}
                      className="gap-2 text-destructive focus:text-destructive cursor-pointer"
                    >
                      <LogOut className="h-4 w-4" />
                      {t.auth.signOut}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
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
