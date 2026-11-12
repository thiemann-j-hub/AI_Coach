'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AppShell from '@/components/app/app-shell';
import { authFetch } from '@/lib/api-client';
import { withBasePath } from '@/lib/base-path';
import { signInAgain } from '@/lib/auth-service';
import { useAuth } from '@/providers/auth-provider';
import { useTranslation } from '@/i18n/useTranslation';
import { localeBcp47, type Locale } from '@/i18n/config';
import { Download, FileText, LogIn } from 'lucide-react';

type CreditsState = {
  enabled: boolean;
  /** null = Saldo unbekannt (Dienst gestoert / Sitzung abgelaufen), nicht 0. */
  balance: number | null;
  /** null im zentralen Modus, wenn der Workspace nicht aufgeloest werden konnte. */
  workspaceId: string | null;
  /** CREDITS_CENTRAL: Saldo kommt zentral, Kauf laeuft ueber die Website (topUpUrl). */
  central?: boolean;
  topUpUrl?: string | null;
  /** Refresh fehlgeschlagen -> Re-Login statt stiller „0". */
  sessionExpired?: boolean;
};
type Invoice = {
  invoiceNumber: string;
  issuedAt: string;
  netCents: number;
  taxCents: number;
  grossCents: number;
  taxRate: number;
  taxTreatment: string;
  currency: string;
};

// KK-1-Nachzügler (GL-Aufräumer 31.07.): Die alten Anzeige-Pakete
// (Einzel-Credit/5er-Paket) stammten aus der Vor-Zentral-Ära und zeigten
// einen Katalog, den es zentral nicht gibt (real: Starter/Team/Scale auf
// der Website). Der Kauf lief ohnehin nur noch über topUpUrl — die Kacheln
// sind ersatzlos durch EINEN zentralen Top-up-CTA ersetzt.

export default function CreditsClient() {
  const { locale, t } = useTranslation();
  const { user } = useAuth();
  // Go-Live-Prüfung (12.11.2026): Texte aus dem Wörterbuch, Zahlen und Datum in der Sprache der Oberfläche
  // (vorher eine Weiche Deutsch/Englisch, die 20 Sprachen auf Englisch ließ).
  const c = t.creditsPage;
  const bcp47 = localeBcp47[locale as Locale] ?? 'en-US';
  const searchParams = useSearchParams();
  const status = searchParams.get('status'); // success | cancelled

  const [state, setState] = useState<CreditsState | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  // Der Fehler steht als Kennung im Zustand; der Text entsteht beim Anzeigen und folgt so einem Sprachwechsel.
  const [error, setError] = useState<'load' | 'signIn' | 'buy' | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [credRes, invRes] = await Promise.all([
          authFetch('/api/credits', { method: 'GET' }),
          authFetch('/api/invoices', { method: 'GET' }),
        ]);
        const cj = await credRes.json();
        if (active && cj?.ok) {
          setState({
            enabled: cj.enabled,
            balance: typeof cj.balance === 'number' ? cj.balance : null,
            workspaceId: cj.workspaceId,
            central: cj.central === true,
            topUpUrl: cj.topUpUrl ?? null,
            sessionExpired: cj.sessionExpired === true,
          });
        }
        const ij = await invRes.json().catch(() => null);
        if (active && ij?.ok && Array.isArray(ij.invoices)) {
          setInvoices(ij.invoices);
        }
      } catch {
        if (active) setError('load');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function eur(cents: number, currency: string) {
    return new Intl.NumberFormat(bcp47, {
      style: 'currency',
      currency: (currency || 'eur').toUpperCase(),
    }).format((cents ?? 0) / 100);
  }
  function dateFmt(iso: string) {
    try {
      return new Date(iso).toLocaleDateString(bcp47, {
        day: '2-digit', month: '2-digit', year: 'numeric',
      });
    } catch {
      return iso;
    }
  }

  async function relogin() {
    try {
      // PulseNorth-Konto: zur Anmeldekarte im Hub, nie direkt zu Microsoft (signInAgain).
      await signInAgain(user?.uid);
    } catch {
      setError('signIn');
    }
  }

  // KK-1: Der lokale Stripe-Checkout (/api/checkout) wurde mit dem lokalen
  // Geld-Stack abgebaut. Kauf laeuft ausschliesslich zentral ueber die Website
  // (topUpUrl); ohne central/topUpUrl sind die Kauf-Buttons ohnehin disabled
  // (enabled:false) bzw. zeigt der Hinweis auf die Website.
  function buy(_packageId: string) {
    if (!state) return;
    if (state.central && state.topUpUrl) {
      window.location.href = state.topUpUrl;
      return;
    }
    setError('buy');
  }

  const errorText =
    error === 'load' ? c.loadFailed : error === 'signIn' ? t.auth.loginFailed : error === 'buy' ? c.buyOnWebsite : null;

  return (
    <AppShell title={c.title} subtitle={c.subtitle}>
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        {status === 'success' && (
          <div className="pn-none p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-sm">
            {c.paymentSuccess}
          </div>
        )}
        {status === 'cancelled' && (
          <div className="pn-none p-4 rounded-xl bg-muted/30 border border-border text-muted-foreground text-sm">
            {c.paymentCancelled}
          </div>
        )}
        {errorText && (
          <div className="pn-none p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-800 dark:text-red-400 text-sm">{errorText}</div>
        )}

        {/* Sitzung abgelaufen -> Re-Login statt stiller „0". */}
        {state?.sessionExpired && (
          <div className="pn-none p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-sm flex flex-wrap items-center justify-between gap-3">
            <span>{t.common.sessionExpired}</span>
            <button
              onClick={relogin}
              className="pn-none inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 px-3 py-1.5 text-sm font-medium text-amber-800 dark:text-amber-200 transition-colors hover:bg-amber-400/10"
            >
              <LogIn className="h-4 w-4" />
              {t.common.reLogin}
            </button>
          </div>
        )}

        {/* Saldo */}
        <div className="pn-tile p-6 rounded-2xl bg-card border border-border">
          <div className="text-sm text-muted-foreground">{c.currentBalance}</div>
          <div className="mt-1 text-4xl font-bold">
            {loading
              ? '…'
              : state?.balance === null || state?.balance === undefined
                ? '—'
                : state.balance}
            <span className="ml-2 text-base font-normal text-muted-foreground">
              {c.unit}
            </span>
          </div>
          {state?.sessionExpired ? (
            <div className="mt-3 text-xs text-amber-800 dark:text-amber-400">
              {c.balanceUnknown}
            </div>
          ) : state && !state.central && !state.enabled ? (
            <div className="mt-3 text-xs text-amber-800 dark:text-amber-400">
              {c.paymentInactive}
            </div>
          ) : null}
        </div>

        {/* Guthaben aufladen — zentraler Kauf über die Website (ein Wallet für alle Apps) */}
        <div>
          <h2 className="text-lg font-semibold mb-1">{t.common.topUp}</h2>
          <p className="text-sm text-muted-foreground mb-4">
            {c.platformWide}
          </p>
          {/* B28 (03.10.2026): Credits kauft nur der Admin (der Credit-Dienst erzwingt es).
              Ein Mitglied bekommt zentral keinen Kauf-Link (topUpUrl fehlt) — dann steht hier
              kein Knopf, der ins Leere führt, sondern wer kauft. */}
          {state?.central && !state.topUpUrl && !state.sessionExpired && !loading ? (
            <p className="text-sm text-muted-foreground" data-testid="credits-admin-buys">
              {t.common.adminBuys}
            </p>
          ) : (
            <button
              className="py-2.5 px-6 rounded-xl btn-gradient text-white font-semibold disabled:opacity-50 disabled:pointer-events-none"
              onClick={() => buy('topup')}
              disabled={!state?.enabled}
            >
              {t.common.topUp}
            </button>
          )}
        </div>

        {/* Rechnungen */}
        <div>
          <h2 className="text-lg font-semibold mb-1">{c.invoices}</h2>
          <p className="text-sm text-muted-foreground mb-4">
            {c.invoicesIntro}
          </p>
          {invoices.length === 0 ? (
            <div className="pn-none glass-panel rounded-xl p-6 text-sm text-muted-foreground">
              {c.noInvoices}
            </div>
          ) : (
            <div className="pn-surface glass-panel rounded-xl divide-y divide-white/5">
              {invoices.map((inv) => {
                const reverseCharge = inv.taxTreatment === 'reverse_charge';
                return (
                  <div key={inv.invoiceNumber} className="flex items-center gap-4 p-4">
                    <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{inv.invoiceNumber}</div>
                      <div className="text-xs text-muted-foreground">{dateFmt(inv.issuedAt)}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{eur(inv.grossCents, inv.currency)}</div>
                      <span
                        className={
                          reverseCharge
                            ? 'inline-block rounded-full bg-accent/10 px-2 py-0.5 text-[11px] text-accent'
                            : 'inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary'
                        }
                      >
                        {reverseCharge
                          ? c.reverseCharge
                          : c.vatRate.replace('{rate}', String(Math.round(inv.taxRate * 100)))}
                      </span>
                    </div>
                    <a
                      href={withBasePath(`/api/invoices/${encodeURIComponent(inv.invoiceNumber)}`)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={c.downloadPdf}
                      className="pn-none inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground hover:border-primary/30"
                    >
                      <Download className="h-4 w-4" />
                      PDF
                    </a>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
