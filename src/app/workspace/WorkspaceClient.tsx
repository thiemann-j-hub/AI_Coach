'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/app/app-shell';
import { authFetch } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useTranslation } from '@/i18n/useTranslation';
import {
  Crown,
  Loader2,
  Mail,
  Trash2,
  UserPlus,
  Users,
  Wallet,
  ArrowRight,
  LogOut,
} from 'lucide-react';

type Member = { uid: string; email: string; role: 'owner' | 'member'; addedAt: string };
type Invite = { email: string; invitedAt: string };
type WorkspaceState = {
  enabled: boolean;
  isOwner: boolean;
  workspaceId: string;
  ownerUid?: string;
  maxMembers: number;
  members: Member[];
  pendingInvites: Invite[];
  seatsRemaining: number;
  balance: number;
};

export default function WorkspaceClient() {
  const { locale } = useTranslation();
  const { user } = useAuth();
  const de = locale.startsWith('de');

  const [state, setState] = useState<WorkspaceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null); // 'invite' | 'revoke:<email>' | 'remove:<uid>' | 'leave'
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null); // member uid

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/workspace', { method: 'GET' });
      const j = await res.json();
      if (j?.ok) {
        setState(j as WorkspaceState);
        setError(null);
      } else {
        setError(de ? 'Konnte Team nicht laden.' : 'Could not load team.');
      }
    } catch {
      setError(de ? 'Konnte Team nicht laden.' : 'Could not load team.');
    } finally {
      setLoading(false);
    }
  }, [de]);

  useEffect(() => {
    void load();
  }, [load]);

  function mapError(code: string | undefined): string {
    switch (code) {
      case 'full':
        return de ? 'Team ist voll (max. 3 Plätze).' : 'Team is full (max 3 seats).';
      case 'exists':
        return de
          ? 'Diese Person ist bereits Mitglied oder eingeladen.'
          : 'This person is already a member or invited.';
      case 'not_owner':
        return de ? 'Nur der Inhaber kann das tun.' : 'Only the owner can do that.';
      case 'is_owner':
        return de ? 'Der Inhaber kann nicht entfernt werden.' : 'The owner cannot be removed.';
      case 'owner_cannot_leave':
        return de
          ? 'Als Inhaber kannst du das Team nicht verlassen.'
          : 'As the owner you cannot leave the team.';
      default:
        return de ? 'Bitte erneut versuchen.' : 'Please try again.';
    }
  }

  async function post(url: string, body?: unknown): Promise<boolean> {
    setError(null);
    try {
      const res = await authFetch(url, {
        method: 'POST',
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const j = await res.json().catch(() => null);
      if (j?.ok) return true;
      setError(mapError(j?.code));
      return false;
    } catch {
      setError(de ? 'Bitte erneut versuchen.' : 'Please try again.');
      return false;
    }
  }

  async function onInvite(e: React.FormEvent) {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;
    setBusy('invite');
    const ok = await post('/api/workspace/invite', { email });
    if (ok) setInviteEmail('');
    await load();
    setBusy(null);
  }

  async function onRevoke(email: string) {
    setBusy('revoke:' + email);
    await post('/api/workspace/invite/revoke', { email });
    await load();
    setBusy(null);
  }

  async function onRemove(memberUid: string) {
    setBusy('remove:' + memberUid);
    await post('/api/workspace/remove', { memberUid });
    setConfirmRemove(null);
    await load();
    setBusy(null);
  }

  async function onLeave() {
    setBusy('leave');
    await post('/api/workspace/leave');
    await load();
    setBusy(null);
  }

  const title = de ? 'Team' : 'Team';
  const subtitle = de ? 'Geteilter Credit-Pool' : 'Shared credit pool';

  const members = state?.members ?? [];
  const invites = state?.pendingInvites ?? [];
  const isOwner = !!state?.isOwner;
  const seatsRemaining = state?.seatsRemaining ?? 0;
  const maxMembers = state?.maxMembers ?? 3;
  const isMember = !isOwner && members.some((m) => m.uid === user?.uid);

  return (
    <AppShell title={title} subtitle={subtitle}>
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {state && !state.enabled && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm">
            {de
              ? 'Hinweis: Team-Workspaces sind noch nicht aktiviert. Diese Seite ist eine Vorschau.'
              : 'Note: team workspaces are not active yet. This page is a preview.'}
          </div>
        )}

        {/* Geteilter Saldo */}
        <div className="p-6 rounded-2xl bg-card border border-border flex items-center gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
            <Wallet className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm text-muted-foreground">
              {de ? 'Geteiltes Guthaben' : 'Shared balance'}
            </div>
            <div className="text-2xl font-bold">
              {loading ? '…' : (state?.balance ?? 0)}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {de ? 'Credits' : 'credits'}
              </span>
            </div>
          </div>
          <Link
            href="/credits"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground hover:border-primary/30"
          >
            {de ? 'Credits verwalten' : 'Manage credits'}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {/* Mitglieder */}
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">{de ? 'Mitglieder' : 'Members'}</h2>
            <span className="text-sm text-muted-foreground">
              {members.length}/{maxMembers}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            {de
              ? 'Alle Mitglieder teilen sich denselben Credit-Pool.'
              : 'All members share the same credit pool.'}
          </p>

          {loading ? (
            <div className="glass-panel rounded-xl p-6 text-sm text-muted-foreground">
              {de ? 'Lädt…' : 'Loading…'}
            </div>
          ) : (
            <div className="glass-panel rounded-xl divide-y divide-white/5">
              {members.map((m) => {
                const you = m.uid === user?.uid;
                const removing = busy === 'remove:' + m.uid;
                return (
                  <div key={m.uid} className="flex items-center gap-3 p-4">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground shrink-0">
                      {m.role === 'owner' ? (
                        <Crown className="h-4 w-4 text-amber-400" />
                      ) : (
                        <Mail className="h-4 w-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">
                        {m.email || m.uid}
                        {you && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            ({de ? 'Du' : 'you'})
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {m.role === 'owner'
                          ? de
                            ? 'Inhaber'
                            : 'Owner'
                          : de
                            ? 'Mitglied'
                            : 'Member'}
                      </div>
                    </div>
                    {/* Owner darf Nicht-Owner entfernen */}
                    {isOwner && m.role !== 'owner' && (
                      <>
                        {confirmRemove === m.uid ? (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => onRemove(m.uid)}
                              disabled={removing}
                              className="rounded-lg bg-red-500/15 px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/25 disabled:opacity-50"
                            >
                              {removing ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : de ? (
                                'Bestätigen'
                              ) : (
                                'Confirm'
                              )}
                            </button>
                            <button
                              onClick={() => setConfirmRemove(null)}
                              disabled={removing}
                              className="rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                            >
                              {de ? 'Abbrechen' : 'Cancel'}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmRemove(m.uid)}
                            title={de ? 'Entfernen' : 'Remove'}
                            className="inline-flex items-center justify-center rounded-lg border border-white/10 p-2 text-muted-foreground transition-colors hover:text-red-400 hover:border-red-500/30"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Offene Einladungen (nur Owner sieht/verwaltet sie) */}
        {isOwner && invites.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3">
              {de ? 'Offene Einladungen' : 'Pending invites'}
            </h2>
            <div className="glass-panel rounded-xl divide-y divide-white/5">
              {invites.map((inv) => {
                const revoking = busy === 'revoke:' + inv.email;
                return (
                  <div key={inv.email} className="flex items-center gap-3 p-4">
                    <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{inv.email}</div>
                      <div className="text-xs text-muted-foreground">
                        {de ? 'wartet auf ersten Login' : 'awaiting first sign-in'}
                      </div>
                    </div>
                    <button
                      onClick={() => onRevoke(inv.email)}
                      disabled={revoking}
                      className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:text-red-400 disabled:opacity-50"
                    >
                      {revoking ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : de ? (
                        'Zurückziehen'
                      ) : (
                        'Revoke'
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Einladen (nur Owner) */}
        {isOwner && (
          <div>
            <h2 className="text-lg font-semibold mb-1">{de ? 'Person einladen' : 'Invite someone'}</h2>
            <p className="text-sm text-muted-foreground mb-4">
              {de
                ? `Sie wird beim ersten Login automatisch dem Team zugeordnet. Noch ${seatsRemaining} Platz/Plätze frei.`
                : `They will be added to the team automatically on first sign-in. ${seatsRemaining} seat(s) left.`}
            </p>
            <form onSubmit={onInvite} className="flex flex-col gap-3 sm:flex-row">
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder={de ? 'kollege@firma.de' : 'colleague@company.com'}
                disabled={seatsRemaining <= 0 || !state?.enabled || busy === 'invite'}
                className="flex-1 rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary/50 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={seatsRemaining <= 0 || !state?.enabled || busy === 'invite'}
                className="inline-flex items-center justify-center gap-2 rounded-xl btn-gradient px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50 disabled:pointer-events-none"
              >
                {busy === 'invite' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UserPlus className="h-4 w-4" />
                )}
                {de ? 'Einladen' : 'Invite'}
              </button>
            </form>
            {state?.enabled && seatsRemaining <= 0 && (
              <p className="mt-2 text-xs text-amber-400">
                {de ? 'Alle Plätze belegt.' : 'All seats taken.'}
              </p>
            )}
          </div>
        )}

        {/* Team verlassen (nur Mitglieder, nicht Owner) */}
        {isMember && (
          <div className="border-t border-border pt-6">
            <button
              onClick={onLeave}
              disabled={busy === 'leave'}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-red-400 hover:border-red-500/30 disabled:opacity-50"
            >
              {busy === 'leave' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
              {de ? 'Team verlassen' : 'Leave team'}
            </button>
            <p className="mt-2 text-xs text-muted-foreground">
              {de
                ? 'Du kehrst zu deinem eigenen Konto zurück; dein bisheriges Guthaben bleibt geparkt erhalten.'
                : 'You return to your own account; your previous balance stays parked.'}
            </p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
