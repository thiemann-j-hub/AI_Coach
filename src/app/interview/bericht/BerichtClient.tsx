'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { FileText, Loader2, Lock } from 'lucide-react';
import AppShell from '@/components/app/app-shell';
import { authFetch } from '@/lib/api-client';
import { useTranslation } from '@/i18n/useTranslation';

interface Kurs {
  id: string;
  titel: string;
  fertig: number;
  offen: number;
  letzte: string | null;
}

interface Bericht {
  kurzfassung: string;
  themen: Array<{ titel: string; beschreibung: string; anzahl: number; zitate: string[] }>;
  staerken: string[];
  verbesserungen: string[];
  vorhaben: string[];
}

/** Welle 6 — Admin-Sicht: Kurse mit Interviews, Themenbericht ab der Mindestgruppe. Keine Einzelantworten. */
export default function BerichtClient() {
  const { t, locale } = useTranslation();
  const ti = t.interview;
  const params = useSearchParams();
  const [kurse, setKurse] = useState<Kurs[] | null>(null);
  const [mindest, setMindest] = useState(5);
  const [gewaehlt, setGewaehlt] = useState<string | null>(params.get('kurs'));
  const [bericht, setBericht] = useState<{ anzahl: number; bericht: Bericht | null; erstellt?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await authFetch('/api/interview/bericht');
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (res.status === 403) {
          setError(json?.code === 'INTERVIEW_NOT_ENABLED' ? ti.notEnabled : ti.adminOnly);
          setKurse([]);
          return;
        }
        if (!res.ok || !json?.ok) throw new Error('list');
        setKurse(json.kurse ?? []);
        setMindest(json.mindest ?? 5);
      } catch {
        if (!cancelled) {
          setError(ti.errorGeneric);
          setKurse([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ti.adminOnly, ti.errorGeneric, ti.notEnabled]);

  const laden = useCallback(
    async (kursId: string) => {
      setGewaehlt(kursId);
      setBericht(null);
      setBusy(true);
      setError(null);
      try {
        const res = await authFetch(`/api/interview/bericht?kurs=${encodeURIComponent(kursId)}&locale=${locale === 'en' ? 'en' : 'de'}`);
        const json = await res.json().catch(() => null);
        // A4 (31.10.2026): KI für das Unternehmen aus — neu erzeugen geht nicht, die Meldung des Servers zeigen.
        if (res.status === 403 && json?.code === 'KI_AUS') {
          setError(json.error || ti.errorGeneric);
          return;
        }
        if (!res.ok || !json?.ok) throw new Error('bericht');
        setBericht({ anzahl: json.anzahl, bericht: json.bericht, erstellt: json.erstellt });
      } catch {
        setError(ti.errorGeneric);
      } finally {
        setBusy(false);
      }
    },
    [locale, ti.errorGeneric]
  );

  useEffect(() => {
    if (gewaehlt && kurse && kurse.length && !bericht && !busy) void laden(gewaehlt);
    // nur beim ersten Laden mit ?kurs=
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kurse]);

  const kurs = kurse?.find((k) => k.id === gewaehlt) ?? null;

  return (
    <AppShell title={ti.berichtTitle} subtitle={ti.berichtIntro.replace('{k}', String(mindest))}>
      <div className="max-w-3xl mx-auto space-y-4">
        {error && (
          <div className="pn-none rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-800 dark:text-rose-300" role="alert">
            {error}
          </div>
        )}
        {kurse === null ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> {ti.berichtLoading}
          </p>
        ) : kurse.length === 0 ? (
          !error && <p className="text-sm text-muted-foreground">{ti.berichtNone}</p>
        ) : (
          <section className="pn-tile glass-panel rounded-2xl border border-border p-4">
            <ul className="divide-y divide-border">
              {kurse.map((k) => (
                <li key={k.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{k.titel}</div>
                    <div className="text-xs text-muted-foreground">{ti.berichtCount.replace('{n}', String(k.fertig)).replace('{open}', String(k.offen))}</div>
                  </div>
                  {k.fertig >= mindest ? (
                    <button
                      type="button"
                      onClick={() => void laden(k.id)}
                      disabled={busy}
                      className="pn-none rounded-lg border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/15 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <FileText className="h-3.5 w-3.5" /> {ti.berichtShow}
                    </button>
                  ) : (
                    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Lock className="h-3.5 w-3.5" /> {ti.berichtTooFew.replace('{n}', String(k.fertig)).replace('{k}', String(mindest))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {busy && (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> {ti.berichtBuilding}
          </p>
        )}

        {bericht && kurs && (
          <section className="space-y-4" data-testid="interview-bericht">
            <div className="pn-tile glass-panel rounded-2xl border border-border p-5 space-y-2">
              <h2 className="text-lg font-bold tracking-tight">{kurs.titel}</h2>
              <p className="text-xs text-muted-foreground">
                {ti.berichtBasis.replace('{n}', String(bericht.anzahl))}
                {bericht.erstellt ? ` · ${ti.berichtCreated.replace('{date}', new Date(bericht.erstellt).toLocaleDateString())}` : ''}
              </p>
              {bericht.bericht ? (
                <p className="text-sm leading-relaxed">{bericht.bericht.kurzfassung}</p>
              ) : (
                <p className="text-sm text-muted-foreground">{ti.berichtTooFew.replace('{n}', String(bericht.anzahl)).replace('{k}', String(mindest))}</p>
              )}
            </div>
            {bericht.bericht && (
              <>
                <div className="pn-tile glass-panel rounded-2xl border border-border p-5 space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{ti.berichtThemes}</h3>
                  <ul className="space-y-3">
                    {bericht.bericht.themen.map((th, i) => (
                      <li key={i} className="pn-none rounded-xl border border-border bg-muted/30 p-3 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold">{th.titel}</span>
                          <span className="text-xs text-muted-foreground">{ti.berichtMentions.replace('{n}', String(th.anzahl))}</span>
                        </div>
                        <p className="text-sm text-muted-foreground leading-relaxed">{th.beschreibung}</p>
                        {th.zitate.length > 0 && (
                          <ul className="mt-1 space-y-1">
                            {th.zitate.map((z, j) => (
                              <li key={j} className="text-sm italic text-foreground/90">»{z}«</li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  {(
                    [
                      [ti.berichtStrengths, bericht.bericht.staerken],
                      [ti.berichtImprove, bericht.bericht.verbesserungen],
                      [ti.berichtPlans, bericht.bericht.vorhaben],
                    ] as Array<[string, string[]]>
                  ).map(([titel, liste]) => (
                    <div key={titel} className="pn-tile glass-panel rounded-2xl border border-border p-4 space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titel}</h3>
                      {liste.length === 0 ? (
                        <p className="text-sm text-muted-foreground">–</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {liste.map((x, i) => (
                            <li key={i} className="text-sm leading-relaxed">• {x}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}
