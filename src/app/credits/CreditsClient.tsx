'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AppShell from '@/components/app/app-shell';
import { authFetch } from '@/lib/api-client';
import { useTranslation } from '@/i18n/useTranslation';

type Pkg = { id: string; credits: number };
type CreditsState = {
  enabled: boolean;
  balance: number;
  workspaceId: string;
  packages: Pkg[];
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
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await authFetch('/api/credits', { method: 'GET' });
        const j = await res.json();
        if (active && j?.ok) {
          setState({ enabled: j.enabled, balance: j.balance, workspaceId: j.workspaceId, packages: j.packages });
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

  async function buy(packageId: string) {
    if (!state) return;
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

        {/* Saldo */}
        <div className="p-6 rounded-2xl bg-card border border-border">
          <div className="text-sm text-muted-foreground">{de ? 'Aktuelles Guthaben' : 'Current balance'}</div>
          <div className="mt-1 text-4xl font-bold">
            {loading ? '…' : (state?.balance ?? 0)}
            <span className="ml-2 text-base font-normal text-muted-foreground">
              {de ? 'Credits' : 'credits'}
            </span>
          </div>
          {state && !state.enabled && (
            <div className="mt-3 text-xs text-amber-400">
              {de
                ? 'Hinweis: Das Bezahlsystem ist noch nicht aktiviert.'
                : 'Note: the payment system is not active yet.'}
            </div>
          )}
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
      </div>
    </AppShell>
  );
}
