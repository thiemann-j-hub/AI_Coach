"use client";

import { useEffect, useState } from "react";
import { Coins } from "lucide-react";
import { authFetch } from "@/lib/api-client";
import { useTranslation } from "@/i18n/useTranslation";
import { withBasePath } from "@/lib/base-path";

/**
 * Header-Live-Zähler des zentralen Guthabens (analog E-Learning CreditBalance).
 * Holt beim Mount /api/credits. Rendert NICHTS, wenn inert: CREDITS_CENTRAL=off
 * (kein central:true), kein Entra-Token / Dienst-Störung (degraded), oder
 * unauth (401). Klick führt zur Website-Preisseite (CREDIT_TOPUP_URL).
 */
type CreditState = { balance: number; topUpUrl: string | null };

/**
 * Andere Komponenten stossen nach einer Abbuchung einen Refresh an
 * (User-Test-Fund 04.08.: nach der Simulations-Auswertung stand der alte
 * Saldo im Header, bis man die Seite neu lud).
 */
export const CREDITS_REFRESH_EVENT = "pn:credits-refresh";

// Unter dieser Schwelle wird der Chip zum sichtbaren Aufladen-Button
// (Owner-Vorgabe 04.08., einheitlich in Coach/Jobmap/Studio).
const LOW_BALANCE_THRESHOLD = 10;

export function CreditBalance() {
  const { t } = useTranslation();
  const [state, setState] = useState<CreditState | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
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
    };
    void load();
    const onRefresh = () => void load();
    window.addEventListener(CREDITS_REFRESH_EVENT, onRefresh);
    return () => {
      active = false;
      window.removeEventListener(CREDITS_REFRESH_EVENT, onRefresh);
    };
  }, []);

  if (!state) return null;

  // Welle F (IA-Masterplan 15.08.): OHNE topUpUrl (zentrale Rolle member) gibt
  // es KEINE Kauf-Handlung — der Chip wird rein informativ; bei knappem
  // Guthaben traegt er die neutrale "Admin ist informiert"-Botschaft.
  const canTopUp = !!state.topUpUrl;
  const href = state.topUpUrl || withBasePath("/credits");
  const external = /^https?:\/\//i.test(href);

  // Unter der Schwelle wird der Chip zum sichtbaren Aufladen-Button (Owner-
  // Vorgabe 04.08.) — aber nur fuer die Rolle, die kaufen kann.
  if (state.balance < LOW_BALANCE_THRESHOLD) {
    if (!canTopUp) {
      return (
        <span
          title={t.common.balanceEmptyMember}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-sm font-medium text-amber-400"
        >
          <Coins className="h-4 w-4" />
          <span className="tabular-nums">{state.balance}</span>
        </span>
      );
    }
    return (
      <a
        href={href}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        title={t.common.topUp}
        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/50 bg-amber-500/15 px-3 py-1.5 text-sm font-semibold text-amber-400 transition-colors hover:bg-amber-500/25 hover:border-amber-400/70"
      >
        <Coins className="h-4 w-4" />
        <span className="tabular-nums">{state.balance}</span>
        <span aria-hidden>·</span>
        <span>{t.common.topUp}</span>
      </a>
    );
  }

  if (!canTopUp) {
    return (
      <span
        title="Credits"
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-card/50 px-3 py-1.5 text-sm font-medium"
      >
        <Coins className="h-4 w-4" />
        <span className="tabular-nums">{state.balance}</span>
      </span>
    );
  }

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
