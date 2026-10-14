"use client";

/**
 * W1-9 (LXT-Welle W1, Owner-GO 14.10.2026): Neue Version erkennen, Nachladefehler abfangen.
 *
 * Vorbild LXT (Anhang E §1.6, §5.3): Versionsabgleich Client/Server — aber nur beim Start, bei
 * Abweichung bricht die App still ab (Spinner), und `ChunkLoadError` wird nicht behandelt. Unsere
 * Fassung: Build-Kennung aus /api/version, geprüft beim Sichtbarwerden des Tabs und alle zehn
 * Minuten; weicht sie ab → Banner „Neue Version, bitte neu laden“ (kein stiller Stopp). Ein
 * Nachladefehler veralteter Bausteine (ChunkLoadError / „Failed to fetch dynamically imported
 * module“) lädt die Seite einmal neu statt weiß zu bleiben. Dieselbe Datei in allen Apps.
 * Rückweg: VERSION_BANNER=off am Server (`/api/version` meldet `banner:false`).
 */

export interface VersionInfo {
  sha?: string | null;
  banner?: boolean;
}

const UNSTAMPED = new Set(["", "unstamped", "dev", "null", "undefined"]);

function stamped(sha: string | null | undefined): sha is string {
  return typeof sha === "string" && !UNSTAMPED.has(sha.trim().toLowerCase());
}

/** Reine Entscheidung: neue Version, wenn beide Kennungen echt sind und sich unterscheiden. */
export function isNewVersion(baseline: string | null | undefined, current: string | null | undefined): boolean {
  return stamped(baseline) && stamped(current) && baseline.trim() !== current.trim();
}

export function startVersionWatch(opts: {
  fetchVersion: () => Promise<VersionInfo | null>;
  onNewVersion: (current: string, baseline: string) => void;
  intervalMs?: number;
}): () => void {
  if (typeof window === "undefined") return () => {};
  let baseline: string | null = null;
  let announced = false;
  let stopped = false;
  const check = async () => {
    if (stopped || announced) return;
    let info: VersionInfo | null = null;
    try {
      info = await opts.fetchVersion();
    } catch {
      return; // Netz weg → nächstes Mal
    }
    if (!info || info.banner === false) return;
    if (!stamped(info.sha)) return;
    if (baseline === null) {
      baseline = info.sha;
      return;
    }
    if (isNewVersion(baseline, info.sha)) {
      announced = true;
      opts.onNewVersion(info.sha, baseline);
    }
  };
  void check();
  const onVisible = () => {
    if (document.visibilityState === "visible") void check();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  const timer = setInterval(() => void check(), opts.intervalMs ?? 10 * 60_000);
  return () => {
    stopped = true;
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
    clearInterval(timer);
  };
}

const CHUNK_RE = /ChunkLoadError|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed|Unable to preload CSS/i;
const RELOAD_KEY = "pn:chunk-reload-at";

/** Reine Erkennung eines Nachladefehlers veralteter Bausteine. */
export function isChunkLoadError(input: unknown): boolean {
  const msg =
    input instanceof Error
      ? `${input.name} ${input.message}`
      : typeof input === "string"
        ? input
        : input && typeof input === "object" && "message" in input
          ? String((input as { message: unknown }).message)
          : "";
  return CHUNK_RE.test(msg);
}

/** Einmal je Seite: Nachladefehler → genau EIN Neuladen je 60 s (keine Endlosschleife). */
export function installChunkErrorReload(): void {
  if (typeof window === "undefined") return;
  const g = window as Window & { __pnChunkReload?: boolean };
  if (g.__pnChunkReload) return;
  g.__pnChunkReload = true;
  const reloadOnce = () => {
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    } catch {
      /* ohne Speicher */
    }
    if (Date.now() - last < 60_000) return;
    try {
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch {
      /* ohne Speicher */
    }
    window.location.reload();
  };
  window.addEventListener("error", (ev) => {
    if (isChunkLoadError(ev.error ?? ev.message)) reloadOnce();
  });
  window.addEventListener("unhandledrejection", (ev) => {
    if (isChunkLoadError((ev as PromiseRejectionEvent).reason)) reloadOnce();
  });
}
