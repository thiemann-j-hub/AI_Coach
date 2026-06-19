import "server-only";

import { creditTokensContainer } from "@/lib/cosmos";
import { OAUTH_SCOPE } from "@/lib/credit-scope";
import { logger } from "@/lib/logger";

/**
 * Server-seitiger Entra-Token-Store + Single-Flight-Refresh.
 *
 * Einheitlicher PULS-Standard (Blueprint CREDIT-TOKEN-STORE), 1:1 auf Cosmos.
 * Haelt das delegierte CreditService-Access-Token je Nutzer (Doc-ID = Entra-oid)
 * dauerhaft gueltig — UNABHAENGIG vom Session-Cookie.
 *
 * WARUM (der Bug, den das loest): die fruehere In-JWT-Rotation ist auf
 * next-auth 5.0.0-beta.31 latent kaputt — der no-args `await auth()`-Pfad
 * verwirft das Set-Cookie mit dem rotierten Token, also wird RT0 nie rotiert →
 * Entra-Reuse-Detection widerruft die Token-Familie → Wallet faellt ~1 h nach
 * dem ersten Refresh still aus. Persistente Rotation braucht einen Server-Store
 * (der ist zudem aus dem Cookie-losen Hintergrund schreibbar). Siehe Blueprint §0.
 *
 * SENSIBEL (Refresh-Token) → server-only; kein Client-RU-Key auf credit_tokens.
 * Der Aufrufer leitet `oid` IMMER aus der verifizierten Session ab (kein IDOR).
 */

export interface StoredEntraToken {
  /** aktuelles CreditService-Access-Token (aud = api://<creditservice>). */
  accessToken: string;
  /** langlebig (offline_access); ROTIERT bei jeder Einloesung. */
  refreshToken: string;
  /** ms-Epoch, Ablauf des accessToken. */
  accessTokenExpires: number;
  /** "" = ok; "refresh-failed" = Token tot → Re-Login noetig. */
  error?: string;
  /** ms-Epoch, letzte Schreiboperation (Diagnose). */
  updatedAt?: number;
}

export type CreditTokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; reason: "no-token" | "refresh-failed" };

/** Refreshe, sobald < 60 s Restlaufzeit (Clock-Skew-Marge). */
const SKEW_MS = 60_000;

// Zwei Maps pro Server-Instanz (Blueprint §3).
const tokenCache = new Map<string, StoredEntraToken>();
const inflightRefresh = new Map<string, Promise<CreditTokenResult>>();

function isUsable(t?: StoredEntraToken | null): boolean {
  return !!t && !!t.accessToken && !t.error && Date.now() < t.accessTokenExpires - SKEW_MS;
}

/** Hoehere Expiry gewinnt; cache-only-RT schlaegt veralteten Store-RT0 (Blueprint §4). */
function pickNewer(
  a: StoredEntraToken | null,
  b: StoredEntraToken | null
): StoredEntraToken | null {
  if (!a) return b;
  if (!b) return a;
  return (b.accessTokenExpires ?? 0) > (a.accessTokenExpires ?? 0) ? b : a;
}

/**
 * I/O-Seam — die EINZIGE plattformabhaengige Stelle (Blueprint §6). Als
 * Objekt-Member gehalten, damit Tests sie stubben koennen. `creditTokensContainer()`
 * wird LAZY pro Aufruf aufgeloest → Modul-Import beruehrt Cosmos nicht.
 */
export const io = {
  read: (oid: string): Promise<StoredEntraToken | null> =>
    creditTokensContainer()
      .item(oid, oid)
      .read<StoredEntraToken>()
      .then((r) => (r.resource as StoredEntraToken) ?? null)
      .catch((e: any) => {
        if (e?.code === 404) return null;
        throw e;
      }),
  write: (oid: string, t: StoredEntraToken): Promise<unknown> =>
    creditTokensContainer().items.upsert({ id: oid, oid, ...t, updatedAt: Date.now() }),
};

/**
 * Token-Endpoint aus dem Issuer ableiten (kein hartes /common!), damit
 * Tenant-Pinning beim Go-Live nicht still gegen den falschen Tenant refresht.
 */
export function tokenEndpoint(): string {
  const issuer =
    process.env.ENTRA_ISSUER ??
    `https://login.microsoftonline.com/${process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID ?? "common"}/v2.0`;
  return issuer.replace(/\/v2\.0\/?$/, "") + "/oauth2/v2.0/token";
}

/** Entra v2 Refresh-Grant. Liefert null → fail-closed beim Aufrufer. */
async function callRefresh(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string; expires: number } | null> {
  const clientId = process.env.ENTRA_CLIENT_ID ?? process.env.AUTH_MICROSOFT_ENTRA_ID_ID ?? "";
  const clientSecret =
    process.env.ENTRA_CLIENT_SECRET ?? process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET ?? "";

  const res = await fetch(tokenEndpoint(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret, // NUR server-seitig
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      // EXAKT der Login-Scope (geteilte Quelle) — kein leerer Resource-Fallback,
      // sonst falsche Audience ~1 h nach Login (Review-Befund, Blueprint §2/§4).
      scope: OAUTH_SCOPE,
    }),
    cache: "no-store",
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) return null; // → fail-closed
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken, // Fallback: alter RT, falls Entra keinen neuen liefert
    expires: Date.now() + (Number(data.expires_in) || 3600) * 1000, // expires_in = SEKUNDEN
  };
}

async function refreshAndStore(oid: string): Promise<CreditTokenResult> {
  let stored: StoredEntraToken | null;
  try {
    stored = await io.read(oid);
  } catch (e) {
    logger.apiError("credit-token-store/read", e, { oid });
    return { ok: false, reason: "no-token" }; // fail-open beim Read (kein Crash)
  }

  // Frischeste Quelle: ein voriger Refresh kann schon rotiert haben, ODER unser
  // Cache ist neuer als ein fehlgeschlagener Persist (hoehere Expiry gewinnt).
  const best = pickNewer(stored, tokenCache.get(oid) ?? null);
  if (isUsable(best)) return { ok: true, accessToken: best!.accessToken };
  if (!best?.refreshToken) return { ok: false, reason: "no-token" };

  let refreshed: Awaited<ReturnType<typeof callRefresh>> = null;
  try {
    refreshed = await callRefresh(best.refreshToken);
  } catch (e) {
    logger.apiError("credit-token-store/refresh", e, { oid });
  }

  if (!refreshed) {
    // FAIL-CLOSED beim TOKEN: nie ein totes Token weiterreichen → Re-Login-Signal.
    const dead: StoredEntraToken = {
      accessToken: "",
      refreshToken: best.refreshToken,
      accessTokenExpires: 0,
      error: "refresh-failed",
    };
    tokenCache.set(oid, dead); // Cache zuerst (kein toter RT0 mehr im Umlauf)
    try {
      await io.write(oid, dead);
    } catch {
      /* Cache haelt den dead-Marker auch ohne Persist */
    }
    return { ok: false, reason: "refresh-failed" };
  }

  const next: StoredEntraToken = {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken, // ROTIERTES RT uebernehmen
    accessTokenExpires: refreshed.expires,
    error: "",
  };
  tokenCache.set(oid, next); // Cache ZUERST → ueberlebt einen Persist-Fehler …
  try {
    await io.write(oid, next);
  } catch (e) {
    // … sonst re-deemt der naechste Aufruf RT0.
    logger.apiError("credit-token-store/persist", e, { oid });
  }
  return { ok: true, accessToken: refreshed.accessToken };
}

/**
 * Liefert ein gueltiges Access-Token fuer `oid` (refresht bei Bedarf).
 * Cache-Fast-Path + Single-Flight (genau EIN callRefresh je oid; weitere
 * gleichzeitige Aufrufer haengen sich an dasselbe Promise). Der Block zwischen
 * `inflightRefresh.get` und `.set` hat KEIN await → laeuft atomar in einem Tick.
 */
export async function getValid(oid: string): Promise<CreditTokenResult> {
  const cached = tokenCache.get(oid);
  if (isUsable(cached)) return { ok: true, accessToken: cached!.accessToken }; // 1. Fast-Path

  const inflight = inflightRefresh.get(oid);
  if (inflight) return inflight; // 2. an laufenden Refresh anhaengen
  const p = refreshAndStore(oid).finally(() => inflightRefresh.delete(oid));
  inflightRefresh.set(oid, p); //    (set() synchron, vor erstem await)
  return p;
}

/** Login-Seed (Blueprint §2/§4): schreibt Store UND Cache, setzt error:"". */
export async function put(
  oid: string,
  t: { accessToken: string; refreshToken: string; accessTokenExpires: number }
): Promise<void> {
  const full: StoredEntraToken = { ...t, error: "" };
  tokenCache.set(oid, full); // Cache mit-seeden → heilt einen toten Eintrag nach Re-Login sofort
  await io.write(oid, full);
}

/** Test-only: per-Instanz Cache + Inflight leeren. */
export function _reset(): void {
  tokenCache.clear();
  inflightRefresh.clear();
}
