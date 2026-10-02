import "server-only";

import { csAuthHeaders, csCredentialFor } from "@/lib/server/credits/cs-credential";
import { loginRequired } from "@/lib/server/credits/login-gate";
import { logger } from "@/lib/logger";

/**
 * P3 App-Freigaben (ROLLEN-Blueprint 15.08.) — zentrale Mitglieds-Info aus
 * resolve-workspace (liefert seit P1 role/apps/disabled). 60s-Cache je oid;
 * Dienststoerung/inert -> null (fail-soft: der Aufrufer laesst die lokale
 * Wahrheit gelten — Verfuegbarkeit vor Strenge, wie der Charge-Pfad).
 *
 * Anmeldung-Umbau Schritt 2c (02.10.2026): Der Abruf zeigt den Ausweis aus cs-credential —
 * Microsoft-Token wie bisher oder, für PulseNorth-Konten (Kennung `ml:…`), den
 * Dienst-Ausweis. Für PulseNorth-Konten gilt fail-soft NICHT: requireAuth lässt sie nur
 * mit einer Auskunft des Registers hinein.
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

/**
 * B26 (02.10.2026): Warum es KEINE Mitglieds-Info gibt, entscheidet jetzt mit.
 *  - info           = Auskunft des Registers liegt vor.
 *  - login-required = die Sitzung hat kein gueltiges Entra-Token mehr (abgelaufen,
 *                     widerrufen oder nie hinterlegt). Vorher wurde das Tor dann
 *                     uebersprungen — auch fuer deaktivierte Personen. Jetzt: neu anmelden.
 *  - unavailable    = Zentrale aus, Token-Speicher oder Dienst gestoert → wie bisher
 *                     fail-soft (Verfuegbarkeit vor Strenge).
 *  - denied         = NUR PulseNorth-Konten (02.10.2026): Das Register hat den
 *                     Dienst-Ausweis abgewiesen (401) — es kennt die Kennung nicht (mehr),
 *                     oder das Geheimnis stimmt nicht. Kein Zugang, und kein „neu anmelden":
 *                     ein PulseNorth-Konto hat kein Token, das ablaufen kann.
 */
export type CentralMemberState =
  | { kind: "info"; info: CentralMemberInfo }
  | { kind: "login-required" }
  | { kind: "denied" }
  | { kind: "unavailable" };

export async function getCentralMemberInfo(oid: string): Promise<CentralMemberInfo | null> {
  const state = await getCentralMemberState(oid);
  return state.kind === "info" ? state.info : null;
}

export async function getCentralMemberState(oid: string): Promise<CentralMemberState> {
  if (!centralOn()) return { kind: "unavailable" };
  const hit = cache.get(oid);
  if (hit && Date.now() - hit.at < TTL_MS) return { kind: "info", info: hit.info };
  try {
    const tok = await csCredentialFor(oid);
    if (!tok.ok) return loginRequired(tok) ? { kind: "login-required" } : { kind: "unavailable" };
    const res = await fetch(`${BASE_URL}/resolve-workspace`, {
      headers: { ...csAuthHeaders(tok.credential), Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      if (tok.credential.kind === "pn" && res.status === 401) {
        // Sichtbar machen (ohne Geheimnis): Bei einem falschen PN_SERVICE_SECRET träfe das
        // ALLE PulseNorth-Konten — im Protokoll muss stehen, warum niemand hineinkommt.
        logger.apiError(
          "member-info/resolve-workspace",
          new Error("register rejected the service credential (401)"),
          { oid }
        );
        return { kind: "denied" };
      }
      return { kind: "unavailable" };
    }
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
    return { kind: "info", info };
  } catch {
    return { kind: "unavailable" };
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
    const tok = await csCredentialFor(oid);
    if (!tok.ok) return false;
    const res = await fetch(`${BASE_URL}/me/profile`, {
      method: "PUT",
      headers: {
        ...csAuthHeaders(tok.credential),
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
