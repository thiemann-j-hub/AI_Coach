"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { LoginLanding } from "@/components/login-landing";
import { usePulseCraftLanding } from "@/components/app/landing-config";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useAuth } from "@/providers/auth-provider";

/**
 * Startseite = einheitliches Anmelde-Fenster (alle Apps gleicher Aufbau).
 * Angemeldete Nutzer landen direkt im Analyse-Flow.
 */
export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { config, signIn } = usePulseCraftLanding();

  useEffect(() => {
    if (!loading && user) router.replace("/analyze");
  }, [loading, user, router]);

  if (loading || user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <LoginLanding
      config={config}
      onSignIn={signIn}
      navEnd={<LanguageSwitcher compact />}
    />
  );
}
