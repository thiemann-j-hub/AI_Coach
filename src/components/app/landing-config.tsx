"use client";

import { Activity, ShieldCheck, TrendingUp } from "lucide-react";

import type { LoginLandingConfig } from "@/components/login-landing";
import { signInWithMicrosoft } from "@/lib/auth-service";
import { useTranslation } from "@/i18n/useTranslation";

/**
 * App-spezifische Konfiguration des einheitlichen Anmelde-Fensters
 * (PulseCraft AI Coach). Texte kommen lokalisiert aus den Dictionaries —
 * pro App ändert sich nur dieses Objekt, nie die LoginLanding-Komponente.
 */
export function usePulseCraftLanding(): {
  config: LoginLandingConfig;
  signIn: () => Promise<void>;
} {
  const { t } = useTranslation();

  const config: LoginLandingConfig = {
    appName: "PulseCraft AI",
    title: "PulseCraft AI Coach",
    subtitle: t.landing.subtitle,
    description: t.landing.description,
    signInLabel: t.auth.signInWithMicrosoft,
    provider: "microsoft",
    features: [
      { icon: Activity, title: t.landing.f1Title, description: t.landing.f1Desc },
      { icon: TrendingUp, title: t.landing.f2Title, description: t.landing.f2Desc },
      { icon: ShieldCheck, title: t.landing.f3Title, description: t.landing.f3Desc },
    ],
    footer: "© 2026 PulseCraft AI Coach",
    signInErrorLabel: t.landing.signInError,
  };

  async function signIn() {
    const { error } = await signInWithMicrosoft();
    if (error) throw error;
  }

  return { config, signIn };
}
