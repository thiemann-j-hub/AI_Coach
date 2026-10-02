'use client';

/**
 * B26 (Rechte-Härtung, Owner-GO 02.10.2026): „Sitzung abgelaufen – bitte neu anmelden".
 *
 * Hat die Sitzung kein gültiges Entra-Token mehr, antwortet jede API-Route mit
 * 401 CENTRAL_REAUTH (Login-Tor in requireAuth). authFetch meldet das als Fenster-
 * Ereignis; dieser Streifen im App-Rahmen sagt, was los ist, und bietet den Weg zurück:
 * „Neu anmelden" startet die Microsoft-Anmeldung, danach geht es auf derselben Seite
 * weiter. Bewusst kein automatischer Sprung — eine angefangene Eingabe bleibt stehen.
 */
import { useEffect, useState } from 'react';
import { LogIn } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { signInWithMicrosoft } from '@/lib/auth-service';
import { SESSION_EXPIRED_EVENT, wasSessionExpiredSeen } from '@/lib/api-client';

export function SessionExpiredBanner() {
  const { t } = useTranslation();
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    // Meldung, die vor dem Aufbau dieses Rahmens kam (Seitenwechsel), nicht verlieren.
    if (wasSessionExpiredSeen()) setExpired(true);
    const onExpired = () => setExpired(true);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  if (!expired) return null;
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-center gap-3 border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm text-foreground"
      data-testid="session-expired"
    >
      <span className="inline-flex items-center gap-2 font-medium">
        <LogIn className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
        {t.common.sessionExpired}
      </span>
      <button
        type="button"
        onClick={() => {
          void signInWithMicrosoft();
        }}
        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-amber-950 transition-colors hover:bg-amber-400"
      >
        <LogIn className="h-4 w-4" aria-hidden /> {t.common.reLogin}
      </button>
    </div>
  );
}
