import "server-only";

import { getValid } from "@/lib/server/credits/entra-token-store";

/**
 * P3 App-Freigaben (ROLLEN-Blueprint 15.08.) — zentrale Mitglieds-Info aus
 * resolve-workspace (liefert seit P1 role/apps/disabled). 60s-Cache je oid;
 * Dienststoerung/inert -> null (fail-soft: der Aufrufer laesst die lokale
 * Wahrheit gelten — Verfuegbarkeit vor Strenge, wie der Charge-Pfad).
 */

export interface CentralMemberInfo {
  workspaceId: string | null;
  role: "admin" | "member";
  apps: string[];
  disabled: boolean;
  /** Zentrales Profil (16.08.): Bild + Anzeigename, EINMAL gesetzt, ueberall gleich. */
  avatarUrl: string | null;
  displayName: string | null;
}

const BASE_URL = (
  process.env.CREDIT_SERVICE_URL ?? "https://pulscraft-credit-service.azurewebsites.net/api"
).replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.CREDIT_SERVICE_TIMEOUT_MS ?? 5_000);

function centralOn(): boolean {
  return (process.env.CREDITS_CENTRAL ?? "off").toLowerCase() === "on";
}

const cache = new Map<string, { at: number; info: CentralMemberInfo }>();
const TTL_MS = 60_000;

export async function getCentralMemberInfo(oid: string): Promise<CentralMemberInfo | null> {
  if (!centralOn()) return null;
  const hit = cache.get(oid);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.info;
  try {
    const tok = await getValid(oid);
    if (!tok.ok) return null;
    const res = await fetch(`${BASE_URL}/resolve-workspace`, {
      headers: { Authorization: `Bearer ${tok.accessToken}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      workspaceId?: string | null;
      role?: string;
      apps?: string[];
      disabled?: boolean;
      avatarUrl?: string | null;
      displayName?: string | null;
    };
    const info: CentralMemberInfo = {
      workspaceId: j.workspaceId ?? null,
      role: j.role === "admin" ? "admin" : "member",
      apps: Array.isArray(j.apps) ? j.apps : [],
      disabled: j.disabled === true,
      avatarUrl: typeof j.avatarUrl === "string" ? j.avatarUrl : null,
      displayName: typeof j.displayName === "string" ? j.displayName : null,
    };
    cache.set(oid, { at: Date.now(), info });
    return info;
  } catch {
    return null;
  }
}

/**
 * Zentrales Selbst-Service-Profil setzen (16.08.): Bild und/oder Anzeigename
 * durchschreiben — "einmal aendern, ueberall gleich". Fail-soft (false);
 * invalidiert den 60s-Cache, damit die App die Aenderung sofort liest.
 */
export async function setCentralSelfProfile(
  oid: string,
  patch: { avatarUrl?: string | null; displayName?: string }
): Promise<boolean> {
  if (!centralOn()) return false;
  try {
    const tok = await getValid(oid);
    if (!tok.ok) return false;
    const res = await fetch(`${BASE_URL}/me/profile`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${tok.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patch),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) cache.delete(oid);
    return res.ok;
  } catch {
    return false;
  }
}
