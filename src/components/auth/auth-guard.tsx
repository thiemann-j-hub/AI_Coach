"use client";

import { Loader2 } from "lucide-react";

import { useAuth } from "@/providers/auth-provider";
import { LoginLanding } from "@/components/login-landing";
import { usePulseCraftLanding } from "@/components/app/landing-config";
import { LanguageSwitcher } from "@/components/language-switcher";

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * Schützt Seiten vor anonymem Zugriff. Abgemeldete Nutzer sehen das
 * einheitliche Anmelde-Fenster (LoginLanding) — gleicher Aufbau in allen
 * Apps — statt des früheren Login-Modals über leerer Seite.
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const { user, loading } = useAuth();
  const { config, signIn } = usePulseCraftLanding();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <LoginLanding
        config={config}
        onSignIn={signIn}
        navEnd={<LanguageSwitcher compact />}
      />
    );
  }

  return <>{children}</>;
}
