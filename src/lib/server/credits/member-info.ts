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
    };
    const info: CentralMemberInfo = {
      workspaceId: j.workspaceId ?? null,
      role: j.role === "admin" ? "admin" : "member",
      apps: Array.isArray(j.apps) ? j.apps : [],
      disabled: j.disabled === true,
    };
    cache.set(oid, { at: Date.now(), info });
    return info;
  } catch {
    return null;
  }
}
