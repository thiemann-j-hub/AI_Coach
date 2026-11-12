'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/api-client';
import type { WorkspaceRole } from '@/lib/pricing-display';

/**
 * U23 (Owner-Entscheid 12.11.2026): Rolle der Person im Arbeitsbereich, für Preisangaben in der Oberfläche
 * (`showEurPrice` in pricing-display.ts) und die Builder-Karte am Einstieg.
 *
 * Quelle ist `/api/users/profile` (`workspaceRole` aus dem zentralen Register). Rückgabe:
 * `undefined` = lädt noch, `null` = nicht bestimmbar (Register ohne Auskunft, Abfrage gescheitert).
 * Je geladener Seite eine Abfrage für alle Komponenten; scheitert sie, fragt die nächste Komponente neu.
 */
let pending: Promise<WorkspaceRole | null> | null = null;

function loadRole(): Promise<WorkspaceRole | null> {
  if (!pending) {
    pending = (async () => {
      try {
        const res = await authFetch('/api/users/profile');
        if (!res.ok) throw new Error('profile');
        const j = await res.json().catch(() => null);
        const role = j?.profile?.workspaceRole;
        return role === 'admin' || role === 'member' ? role : null;
      } catch {
        pending = null;
        return null;
      }
    })();
  }
  return pending;
}

export function useWorkspaceRole(): WorkspaceRole | null | undefined {
  const [role, setRole] = useState<WorkspaceRole | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void loadRole().then((r) => {
      if (!cancelled) setRole(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return role;
}
