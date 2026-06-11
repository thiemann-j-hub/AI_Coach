"use client";

import * as React from "react";
import { ArrowRight, Loader2 } from "lucide-react";

/**
 * Einheitliches Anmelde-Fenster für alle Apps (Referenz: AI Jobmap Moderator,
 * Anleitung: docs/login-landing/ANLEITUNG.md). Helles Design: Navbar mit Logo,
 * zentrierter Hero (Icon-Badge, Titel, Untertitel, Beschreibung, dunkler
 * Anmelde-Button mit Provider-Logo), 3 Feature-Karten auf grauem Band, Footer.
 *
 * Bewusst auth- und framework-agnostisch: nur React + Tailwind + lucide-react.
 * Pro App ändern sich ausschließlich `config` und `onSignIn` — der Look bleibt
 * identisch. Feste slate-Farbpalette, unabhängig vom Theme der Host-App.
 */

export type LoginLandingFeature = {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
};

export type LoginLandingConfig = {
  /** Navbar oben links */
  appName: string;
  /** Große Überschrift */
  title: string;
  /** Zeile unter dem Titel */
  subtitle: string;
  /** Absatz unter dem Untertitel (2–4 Sätze) */
  description: string;
  /** Button-Text, z. B. "Mit Microsoft anmelden" */
  signInLabel: string;
  /** Logo im Button */
  provider: "microsoft" | "google" | "none";
  /** Genau 3 Karten auf dem grauen Band */
  features: LoginLandingFeature[];
  /** Fußzeile, z. B. "© 2026 …" */
  footer: string;
  /** Optionales Bild-Logo (URL); ohne Angabe wird das Icon des ersten Features verwendet */
  logoSrc?: string;
  /** Fehlertext, falls onSignIn wirft (sonst englischer Fallback) */
  signInErrorLabel?: string;
};

function MicrosoftLogo({ className }: { className?: string }) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 23 23" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="10" height="10" fill="#f25022" />
      <rect x="12" y="1" width="10" height="10" fill="#7fba00" />
      <rect x="1" y="12" width="10" height="10" fill="#00a4ef" />
      <rect x="12" y="12" width="10" height="10" fill="#ffb900" />
    </svg>
  );
}

function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
    </svg>
  );
}

function BrandMark({
  config,
  className,
  imgClassName,
}: {
  config: LoginLandingConfig;
  className?: string;
  imgClassName?: string;
}) {
  if (config.logoSrc) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={config.logoSrc} alt={config.appName} className={imgClassName} />;
  }
  const Icon = config.features[0]?.icon;
  return Icon ? <Icon className={className} /> : null;
}

export function LoginLanding({
  config,
  onSignIn,
  navEnd,
}: {
  config: LoginLandingConfig;
  onSignIn: () => void | Promise<void>;
  /** Optionaler Slot rechts in der Navbar (z. B. Sprachumschalter) */
  navEnd?: React.ReactNode;
}) {
  const [pending, setPending] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  async function handleClick() {
    if (pending) return;
    setFailed(false);
    setPending(true);
    try {
      await onSignIn();
      // pending bleibt true — der Browser navigiert i. d. R. zum Identity-Provider
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-white text-slate-900 font-sans">
      {/* Navbar */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <BrandMark config={config} className="h-5 w-5 text-slate-900" imgClassName="h-7 w-auto" />
            <span className="text-base font-semibold tracking-tight">{config.appName}</span>
          </div>
          {navEnd}
        </div>
      </header>

      {/* Hero */}
      <main className="flex flex-1 items-center justify-center bg-white px-4 py-16 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mb-8 inline-flex items-center justify-center rounded-2xl bg-slate-100 p-4">
            <BrandMark config={config} className="h-7 w-7 text-slate-900" imgClassName="h-9 w-auto" />
          </div>

          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">{config.title}</h1>
          <p className="mt-4 text-lg text-slate-600">{config.subtitle}</p>
          <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-slate-500 sm:text-base">
            {config.description}
          </p>

          <button
            type="button"
            onClick={handleClick}
            disabled={pending}
            className="mt-9 inline-flex items-center gap-2.5 rounded-lg bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-70"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : config.provider === "microsoft" ? (
              <MicrosoftLogo className="h-4 w-4" />
            ) : config.provider === "google" ? (
              <GoogleLogo className="h-4 w-4" />
            ) : null}
            {config.signInLabel}
            {!pending && <ArrowRight className="h-4 w-4" />}
          </button>

          {failed && (
            <p className="mt-3 text-sm text-red-600">
              {config.signInErrorLabel ?? "Sign-in failed. Please try again."}
            </p>
          )}
        </div>
      </main>

      {/* Feature-Band */}
      <section className="border-t border-slate-200 bg-slate-50 px-4 py-14">
        <div className="mx-auto grid max-w-5xl gap-10 text-center sm:grid-cols-3">
          {config.features.slice(0, 3).map((f, i) => {
            const Icon = f.icon;
            return (
              <div key={i}>
                <div className="mb-4 inline-flex items-center justify-center rounded-xl bg-slate-200/70 p-3">
                  <Icon className="h-5 w-5 text-slate-700" />
                </div>
                <h2 className="text-sm font-semibold text-slate-900">{f.title}</h2>
                <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-slate-500">
                  {f.description}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-6 text-center text-sm text-slate-400">
        {config.footer}
      </footer>
    </div>
  );
}
