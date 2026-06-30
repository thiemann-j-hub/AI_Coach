"use client";

import { useEffect, useState } from "react";
import { Coins } from "lucide-react";
import { authFetch } from "@/lib/api-client";
import { withBasePath } from "@/lib/base-path";

/**
 * Header-Live-Zähler des zentralen Guthabens (analog E-Learning CreditBalance).
 * Holt beim Mount /api/credits. Rendert NICHTS, wenn inert: CREDITS_CENTRAL=off
 * (kein central:true), kein Entra-Token / Dienst-Störung (degraded), oder
 * unauth (401). Klick führt zur Website-Preisseite (CREDIT_TOPUP_URL).
 */
type CreditState = { balance: number; topUpUrl: string | null };

export function CreditBalance() {
  const [state, setState] = useState<CreditState | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await authFetch("/api/credits", { method: "GET" });
        const j = await res.json().catch(() => null);
        // Nur im Zentral-Modus MIT echtem numerischem Saldo anzeigen. Bei
        // degraded (Dienst gestoert) oder sessionExpired (Re-Login noetig) ist
        // der Saldo unbekannt (null) -> Chip ausblenden statt „0/null" zeigen.
        if (
          active &&
          j?.ok &&
          j.central === true &&
          j.degraded !== true &&
          j.sessionExpired !== true &&
          typeof j.balance === "number"
        ) {
          setState({
            balance: j.balance,
            topUpUrl: j.topUpUrl ?? null,
          });
        }
      } catch {
        /* inert: nichts anzeigen */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!state) return null;

  const href = state.topUpUrl || withBasePath("/credits");
  // Externe Top-up-Seite (pulscraft-ai…/preise) in NEUEM Tab oeffnen, damit Coach
  // offen bleibt (Angleich an Jobmap). Der interne /credits-Fallback bleibt im
  // selben Tab (kein target).
  const external = /^https?:\/\//i.test(href);
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      title="Credits"
      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-card/50 px-3 py-1.5 text-sm font-medium transition-colors hover:border-primary/30 hover:text-primary"
    >
      <Coins className="h-4 w-4 text-primary" />
      <span>{state.balance}</span>
      <span className="text-xs text-muted-foreground">Credits</span>
    </a>
  );
}
