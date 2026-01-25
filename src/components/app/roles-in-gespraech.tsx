'use client';

import React, { useEffect, useMemo } from 'react';

type Props = {
  speakers: string[];

  leader: string;
  employee: string;

  setLeader: (v: string) => void;
  setEmployee: (v: string) => void;

  anonymize: boolean;
  setAnonymize: (v: boolean) => void;

  autoSave: boolean;
  setAutoSave: (v: boolean) => void;

  onAnalyze: () => void;
  canAnalyze: boolean;
  loading?: boolean;
};

function ChevronDown() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5 text-muted-foreground"
      fill="none"
    >
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Sparkles() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
    >
      <path
        d="M12 2l1.2 4.2L17.4 7.4 13.2 8.6 12 12.8 10.8 8.6 6.6 7.4l4.2-1.2L12 2Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M19 12l.8 2.7 2.7.8-2.7.8L19 19l-.8-2.7-2.7-.8 2.7-.8L19 12Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function RolesInGespraech(props: Props) {
  const {
    speakers,
    leader,
    employee,
    setLeader,
    setEmployee,
    anonymize,
    setAnonymize,
    autoSave,
    setAutoSave,
    onAnalyze,
    canAnalyze,
    loading,
  } = props;

  const cleanSpeakers = useMemo(() => {
    return (speakers ?? []).map((s) => String(s ?? '').trim()).filter(Boolean);
  }, [speakers]);

  // Auto-preset for classic FK/MA transcripts
  useEffect(() => {
    if (leader?.trim()) return;
    if (cleanSpeakers.length === 2 && cleanSpeakers.includes('FK') && cleanSpeakers.includes('MA')) {
      setLeader('FK');
      setEmployee('MA');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanSpeakers.join('|')]);

  // If exactly 2 speakers: employee is always "the other one"
  useEffect(() => {
    if (!leader?.trim()) return;
    if (cleanSpeakers.length !== 2) return;

    const other = cleanSpeakers.find((s) => s !== leader) ?? '';
    if (other && other !== employee) setEmployee(other);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leader, cleanSpeakers.length, cleanSpeakers.join('|')]);

  const derivedEmployee = useMemo(() => {
    if (employee?.trim()) return employee;
    if (!leader?.trim()) return '';
    return cleanSpeakers.find((s) => s !== leader) ?? '';
  }, [employee, leader, cleanSpeakers]);

  const showEmployeeSelect = cleanSpeakers.length > 2;

  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-5 shadow-sm">
      <div className="text-xs font-semibold tracking-widest text-muted-foreground">
        ROLLEN IM GESPRÄCH
      </div>

      <div className="mt-4 space-y-5">
        <div>
          <div className="text-sm text-muted-foreground">Führungskraft</div>

          <div className="relative mt-2">
            <select
              value={leader}
              onChange={(e) => setLeader(e.target.value)}
              className="h-12 w-full appearance-none rounded-xl border border-border/60 bg-background/20 px-4 pr-10 text-base font-medium text-foreground outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">Bitte auswählen…</option>
              {cleanSpeakers.map((sp) => (
                <option key={sp} value={sp}>
                  {sp}
                </option>
              ))}
            </select>

            <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
              <ChevronDown />
            </div>
          </div>

          {!cleanSpeakers.length ? (
            <div className="mt-2 text-xs text-muted-foreground">
              (Sprecher werden nach Upload / Einfügen des Transkripts erkannt.)
            </div>
          ) : null}
        </div>

        <div>
          <div className="text-sm text-muted-foreground">Mitarbeitende</div>

          {showEmployeeSelect ? (
            <div className="relative mt-2">
              <select
                value={employee}
                onChange={(e) => setEmployee(e.target.value)}
                className="h-12 w-full appearance-none rounded-xl border border-border/60 bg-background/20 px-4 pr-10 text-base font-medium text-foreground outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">Bitte auswählen…</option>
                {cleanSpeakers
                  .filter((s) => s !== leader)
                  .map((sp) => (
                    <option key={sp} value={sp}>
                      {sp}
                    </option>
                  ))}
              </select>

              <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                <ChevronDown />
              </div>

              <div className="mt-2 text-xs text-muted-foreground">
                Mehr als 2 Sprecher erkannt – bitte Mitarbeitende explizit wählen.
              </div>
            </div>
          ) : (
            <input
              value={derivedEmployee}
              readOnly
              className="mt-2 h-12 w-full rounded-xl border border-border/60 bg-background/10 px-4 text-base font-medium text-foreground/90"
              placeholder="(wird automatisch gesetzt)"
            />
          )}
        </div>

        <div className="rounded-2xl border border-border/60 bg-background/10 p-4">
          <div className="flex items-center justify-between gap-4 py-2">
            <div>
              <div className="text-sm font-medium text-foreground">Anonymisierung</div>
              <div className="text-xs text-muted-foreground">PII entfernen</div>
            </div>

            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={!!anonymize}
                onChange={(e) => setAnonymize(e.target.checked)}
              />
              <div className="h-6 w-11 rounded-full bg-muted/60 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-background after:transition-all peer-checked:bg-primary/70 peer-checked:after:translate-x-full peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/30" />
            </label>
          </div>

          <div className="my-2 h-px w-full bg-border/60" />

          <div className="flex items-center justify-between gap-4 py-2">
            <div>
              <div className="text-sm font-medium text-foreground">Auto‑Save</div>
              <div className="text-xs text-muted-foreground">nach Analyse speichern</div>
            </div>

            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={!!autoSave}
                onChange={(e) => setAutoSave(e.target.checked)}
              />
              <div className="h-6 w-11 rounded-full bg-muted/60 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-background after:transition-all peer-checked:bg-primary/70 peer-checked:after:translate-x-full peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/30" />
            </label>
          </div>
        </div>

        <button
          type="button"
          onClick={onAnalyze}
          disabled={!canAnalyze || !!loading}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 text-base font-semibold text-primary-foreground shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Sparkles />
          {loading ? 'Analyse läuft…' : 'Analyse starten'}
        </button>
      </div>
    </div>
  );
}
