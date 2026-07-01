"use client";

import { useAuth } from "@/providers/auth-provider";
import { useTranslation } from "@/i18n/useTranslation";
import { useState } from "react";
import { Loader2, MessagesSquare, ArrowRight, BarChart3, ShieldCheck } from "lucide-react";
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
  const { t, locale } = useTranslation();
  const de = locale.startsWith("de");
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  // App-Texte (Du-Form, Website-konform). DE/EN inline wie die Feature-Cards;
  // andere Locales fallen auf EN zurueck (konsistent mit dem bestehenden Muster).
  const tagline = de
    ? "KI-Analyse für bessere Mitarbeitergespräche"
    : "AI analysis for better employee conversations";
  const description = de
    ? "Lade ein Gesprächs-Transkript hoch und erhalte in Minuten eine strukturierte Analyse mit Kompetenz-Scoring und konkretem, umsetzbarem Feedback."
    : "Upload a conversation transcript and get a structured analysis with competency scoring and concrete, actionable feedback in minutes.";

  // Legal-Links → zentrale Website (neuer Tab, App bleibt offen).
  const legalLinks: Array<[string, string]> = [
    [de ? "Datenschutz" : "Privacy", "datenschutz"],
    [de ? "AGB" : "Terms", "agb"],
    ["AVV", "avv"],
    [de ? "Impressum" : "Imprint", "impressum"],
  ];

  const features = [
    {
      Icon: MessagesSquare,
      title: de ? "Gesprächsanalyse" : "Conversation analysis",
      desc: de
        ? "KI-gestützte Analyse von Mitarbeitergesprächen mit konkretem, umsetzbarem Feedback."
        : "AI-powered analysis of employee conversations with concrete, actionable feedback.",
    },
    {
      Icon: BarChart3,
      title: de ? "Kompetenz-Scoring" : "Competency scoring",
      desc: de
        ? "Strukturierte Bewertung der Führungskompetenzen — mit Evidenz aus dem Transkript."
        : "Structured assessment of leadership competencies — grounded in the transcript.",
    },
    {
      Icon: ShieldCheck,
      title: de ? "DSGVO-konform" : "GDPR-compliant",
      desc: de
        ? "Anonymisierung im Browser vor der Analyse; Verarbeitung in der EU (Azure)."
        : "In-browser anonymization before analysis; processing in the EU (Azure).",
    },
  ];

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
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-card shadow-neon">
          <MessagesSquare className="h-7 w-7 text-primary" />
        </div>
        <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">
          <span className="text-foreground">PulseNorth</span>
          <span className="text-primary">.AI</span>
        </h1>
        <p className="mt-2 text-sm font-medium text-muted-foreground">Gesprächs-Coach</p>
        <p className="mt-3 text-lg font-medium text-gradient">{tagline}</p>
        <p className="mt-4 max-w-xl text-muted-foreground">{description}</p>

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

        {/* Feature-Cards (Angleich an die Pulscraft-Vorlage) */}
        <div className="mt-12 grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-border bg-card p-5 text-center shadow-card-light dark:shadow-card-dark"
            >
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <f.Icon className="h-5 w-5" />
              </div>
              <div className="font-semibold text-foreground">{f.title}</div>
              <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        <p>
          {de
            ? "100 % EU-Hosting · DSGVO-konform · Kein Training mit deinen Daten."
            : "100% EU hosting · GDPR-compliant · No training on your data."}
        </p>
        <nav className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          {legalLinks.map(([label, slug]) => (
            <a
              key={slug}
              href={`https://pulscraft-ai.azurewebsites.net/${slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary"
            >
              {label}
            </a>
          ))}
        </nav>
        <p className="mt-3">© {new Date().getFullYear()} PulseNorth.AI · Coach</p>
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
