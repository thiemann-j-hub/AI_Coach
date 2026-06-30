'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AppShell from '@/components/app/app-shell';
import { authFetch } from '@/lib/api-client';
import { withBasePath } from '@/lib/base-path';
import { signInWithMicrosoft } from '@/lib/auth-service';
import { useTranslation } from '@/i18n/useTranslation';
import { Download, FileText, LogIn } from 'lucide-react';

type Pkg = { id: string; credits: number };
type CreditsState = {
  enabled: boolean;
  /** null = Saldo unbekannt (Dienst gestoert / Sitzung abgelaufen), nicht 0. */
  balance: number | null;
  /** null im zentralen Modus, wenn der Workspace nicht aufgeloest werden konnte. */
  workspaceId: string | null;
  packages: Pkg[];
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

const PACKAGE_LABEL: Record<string, { de: string; en: string }> = {
  single: { de: 'Einzel-Credit', en: 'Single credit' },
  pack_5: { de: '5er-Paket', en: '5-pack' },
};

export default function CreditsClient() {
  const { locale } = useTranslation();
  const de = locale.startsWith('de');
  const searchParams = useSearchParams();
  const status = searchParams.get('status'); // success | cancelled

  const [state, setState] = useState<CreditsState | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
            packages: cj.packages,
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
        if (active) setError(de ? 'Konnte Guthaben nicht laden.' : 'Could not load balance.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [de]);

  function eur(cents: number, currency: string) {
    return new Intl.NumberFormat(de ? 'de-DE' : 'en-US', {
      style: 'currency',
      currency: (currency || 'eur').toUpperCase(),
    }).format((cents ?? 0) / 100);
  }
  function dateFmt(iso: string) {
    try {
      return new Date(iso).toLocaleDateString(de ? 'de-DE' : 'en-US', {
        day: '2-digit', month: '2-digit', year: 'numeric',
      });
    } catch {
      return iso;
    }
  }

  async function relogin() {
    try {
      await signInWithMicrosoft();
    } catch {
      setError(de ? 'Anmeldung fehlgeschlagen.' : 'Sign-in failed.');
    }
  }

  async function buy(packageId: string) {
    if (!state) return;
    // CREDITS_CENTRAL: Kauf laeuft zentral ueber die Website -> dorthin leiten.
    if (state.central) {
      if (state.topUpUrl) {
        window.location.href = state.topUpUrl;
      } else {
        setError(de ? 'Kauf erfolgt auf der Website.' : 'Purchase happens on the website.');
      }
      return;
    }
    setBuying(packageId);
    setError(null);
    try {
      const res = await authFetch('/api/checkout', {
        method: 'POST',
        body: JSON.stringify({ packageId, workspaceId: state.workspaceId }),
      });
      const j = await res.json();
      if (j?.ok && j?.url) {
        window.location.href = j.url; // zur von Stripe gehosteten Bezahlseite
        return;
      }
      setError(j?.error ? String(j.error) : de ? 'Checkout fehlgeschlagen.' : 'Checkout failed.');
    } catch {
      setError(de ? 'Checkout fehlgeschlagen.' : 'Checkout failed.');
    } finally {
      setBuying(null);
    }
  }

  return (
    <AppShell title={de ? 'Credits' : 'Credits'} subtitle={de ? 'Guthaben & Kauf' : 'Balance & purchase'}>
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        {status === 'success' && (
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm">
            {de
              ? 'Zahlung erfolgreich — deine Credits wurden gutgeschrieben. Die Rechnung findest du in deiner Übersicht.'
              : 'Payment successful — your credits have been added. Your invoice is available in your overview.'}
          </div>
        )}
        {status === 'cancelled' && (
          <div className="p-4 rounded-xl bg-muted/30 border border-border text-muted-foreground text-sm">
            {de ? 'Kauf abgebrochen — es wurde nichts berechnet.' : 'Purchase cancelled — nothing was charged.'}
          </div>
        )}
        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
        )}

        {/* Sitzung abgelaufen -> Re-Login statt stiller „0". */}
        {state?.sessionExpired && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm flex flex-wrap items-center justify-between gap-3">
            <span>
              {de
                ? 'Sitzung abgelaufen — bitte melde dich neu an, um dein Guthaben zu sehen.'
                : 'Session expired — please sign in again to see your balance.'}
            </span>
            <button
              onClick={relogin}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 px-3 py-1.5 text-sm font-medium text-amber-200 transition-colors hover:bg-amber-400/10"
            >
              <LogIn className="h-4 w-4" />
              {de ? 'Neu anmelden' : 'Sign in again'}
            </button>
          </div>
        )}

        {/* Saldo */}
        <div className="p-6 rounded-2xl bg-card border border-border">
          <div className="text-sm text-muted-foreground">{de ? 'Aktuelles Guthaben' : 'Current balance'}</div>
          <div className="mt-1 text-4xl font-bold">
            {loading
              ? '…'
              : state?.balance === null || state?.balance === undefined
                ? '—'
                : state.balance}
            <span className="ml-2 text-base font-normal text-muted-foreground">
              {de ? 'Credits' : 'credits'}
            </span>
          </div>
          {state?.sessionExpired ? (
            <div className="mt-3 text-xs text-amber-400">
              {de
                ? 'Guthaben unbekannt — Sitzung abgelaufen.'
                : 'Balance unknown — session expired.'}
            </div>
          ) : state && !state.central && !state.enabled ? (
            <div className="mt-3 text-xs text-amber-400">
              {de
                ? 'Hinweis: Das Bezahlsystem ist noch nicht aktiviert.'
                : 'Note: the payment system is not active yet.'}
            </div>
          ) : null}
        </div>

        {/* Pakete */}
        <div>
          <h2 className="text-lg font-semibold mb-1">{de ? 'Credits kaufen' : 'Buy credits'}</h2>
          <p className="text-sm text-muted-foreground mb-4">
            {de ? 'Alle Preise exkl. MwSt.' : 'All prices excl. VAT.'} 1 Credit = 1 {de ? 'Analyse' : 'analysis'}.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(state?.packages ?? []).map((p) => {
              const lbl = PACKAGE_LABEL[p.id]?.[de ? 'de' : 'en'] ?? p.id;
              return (
                <div key={p.id} className="p-5 rounded-2xl bg-card border border-border flex flex-col gap-3">
                  <div className="text-base font-semibold">{lbl}</div>
                  <div className="text-3xl font-bold">
                    {p.credits}
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      {de ? (p.credits === 1 ? 'Credit' : 'Credits') : p.credits === 1 ? 'credit' : 'credits'}
                    </span>
                  </div>
                  <button
                    className="mt-auto py-2.5 px-4 rounded-xl btn-gradient text-white font-semibold disabled:opacity-50 disabled:pointer-events-none"
                    onClick={() => buy(p.id)}
                    disabled={!state?.enabled || buying !== null}
                  >
                    {buying === p.id ? (de ? 'Weiterleiten…' : 'Redirecting…') : de ? 'Kaufen' : 'Buy'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Rechnungen */}
        <div>
          <h2 className="text-lg font-semibold mb-1">{de ? 'Rechnungen' : 'Invoices'}</h2>
          <p className="text-sm text-muted-foreground mb-4">
            {de ? 'Deine §14-Rechnungen als PDF.' : 'Your §14 invoices as PDF.'}
          </p>
          {invoices.length === 0 ? (
            <div className="glass-panel rounded-xl p-6 text-sm text-muted-foreground">
              {de ? 'Noch keine Rechnungen.' : 'No invoices yet.'}
            </div>
          ) : (
            <div className="glass-panel rounded-xl divide-y divide-white/5">
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
                          ? de ? '0 % · Reverse-Charge' : '0% · reverse charge'
                          : `${Math.round(inv.taxRate * 100)} % ${de ? 'USt' : 'VAT'}`}
                      </span>
                    </div>
                    <a
                      href={withBasePath(`/api/invoices/${encodeURIComponent(inv.invoiceNumber)}`)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={de ? 'PDF herunterladen' : 'Download PDF'}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground hover:border-primary/30"
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
