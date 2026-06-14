"use client";

import { useAuth } from "@/providers/auth-provider";
import { useTranslation } from "@/i18n/useTranslation";
import { useState } from "react";
import { Loader2, MessagesSquare, ArrowRight } from "lucide-react";
import { signInWithMicrosoft } from "@/lib/auth-service";
import { useToast } from "@/hooks/use-toast";
import { LanguageSwitcher } from "@/components/language-switcher";
import { PulscraftWordmark } from "@/components/pulscraft-wordmark";

interface AuthGuardProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function AuthGuard({ children, fallback }: AuthGuardProps) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <>{fallback ?? <LoginScreen />}</>;
  }

  return <>{children}</>;
}

/** Pulscraft-Login-Pattern: dark Hero, Glas-Top-Bar, Wortmarke, Neon-MS-Button. */
function LoginScreen() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function onSignIn() {
    setBusy(true);
    try {
      const { error } = await signInWithMicrosoft();
      if (error) throw error;
      // bleibt busy — Browser navigiert zur Microsoft-Anmeldung
    } catch (e: any) {
      toast({
        title: t.auth.loginFailed,
        description: e?.message || t.auth.genericError,
        variant: "destructive",
      });
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-background text-foreground">
      {/* Decorative background blobs */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-[500px] w-[500px] rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -right-40 top-1/3 h-[400px] w-[400px] rounded-full bg-accent/5 blur-3xl" />
      </div>

      {/* Top bar */}
      <header className="glass-header sticky top-0 z-30 flex h-16 items-center justify-between px-6">
        <PulscraftWordmark product="Coach" />
        <LanguageSwitcher compact />
      </header>

      {/* Hero */}
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-surface-dark shadow-neon">
          <MessagesSquare className="h-7 w-7 text-primary" />
        </div>
        <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">
          <span className="text-foreground">Pulscraft</span>{" "}
          <span className="text-primary">AI</span>
        </h1>
        <p className="mt-2 text-lg font-medium text-gradient">Gesprächs-Coach</p>
        <p className="mt-4 max-w-xl text-muted-foreground">{t.auth.authDescription}</p>

        <button
          type="button"
          onClick={onSignIn}
          disabled={busy}
          className="mt-8 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-medium text-white shadow-neon transition-all hover:bg-primary-dark hover:shadow-neon-hover disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MicrosoftMark />}
          {t.auth.signInWithMicrosoft}
          <ArrowRight className="h-4 w-4" />
        </button>

        <p className="mt-4 max-w-md text-xs text-muted-foreground">{t.auth.microsoftHint}</p>
      </main>

      <footer className="border-t border-white/5 py-6 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} Pulscraft AI · Coach
      </footer>
    </div>
  );
}

/** Microsoft-4-Quadrat-Mark fuer den SSO-Button. */
function MicrosoftMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}
