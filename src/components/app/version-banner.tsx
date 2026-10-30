"use client";

/**
 * W1-9 (14.10.2026): Banner „Neue Version, bitte neu laden“ — Muster wie SessionExpiredBanner.
 * Vorbild LXT (Anhang E §5.3) bricht bei Versionsabweichung still ab; wir sagen es und bieten das Neuladen an.
 */
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import { authFetch } from "@/lib/api-client";
import { installChunkErrorReload, startVersionWatch, type VersionInfo } from "@/lib/version-watch";
import { setToastRulesOn } from "@/lib/toast-rules";

export function VersionBanner() {
  const { t } = useTranslation();
  const [fresh, setFresh] = useState<string | null>(null);

  useEffect(() => {
    installChunkErrorReload();
    return startVersionWatch({
      fetchVersion: async () => {
        const res = await authFetch("/api/version");
        const info = res.ok ? ((await res.json()) as VersionInfo) : null;
        // W1-11: Meldungsregeln folgen dem Server-Schalter TOAST_RULES.
        setToastRulesOn(info?.toastRules !== false);
        return info;
      },
      onNewVersion: (sha) => setFresh(sha),
    });
  }, []);

  if (!fresh) return null;
  return (
    <div
      role="status"
      data-testid="version-banner"
      className="flex flex-wrap items-center justify-center gap-3 border-b border-sky-500/40 bg-sky-500/15 px-4 py-2 text-sm text-foreground"
    >
      <span className="inline-flex items-center gap-2 font-medium">
        <RefreshCw className="h-4 w-4 shrink-0 text-sky-800 dark:text-sky-500" aria-hidden />
        {t.version.newVersion}
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-sm font-semibold text-sky-950 transition-colors hover:bg-sky-400"
      >
        {t.version.reload}
      </button>
    </div>
  );
}
