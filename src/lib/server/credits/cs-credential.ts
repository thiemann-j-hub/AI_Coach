import "server-only";

/**
 * Ausweis gegenüber dem Credit-Dienst (Anmeldung-Umbau Schritt 2c, Owner-GO 02.10.2026).
 *
 * Bisher gab es genau einen Ausweis: das Microsoft-Token des Nutzers. Damit konnten Konten
 * ohne Microsoft (PulseNorth-Konten, Kennung `ml:…`) nichts abrufen — der Coach wies sie
 * deshalb ganz ab. Jetzt gibt es zwei:
 *
 *  - Microsoft-Konto  → `Authorization: Bearer <Entra-Token>` (unverändert; das Token kommt
 *    aus dem Server-Speicher, die Kennung IMMER aus der geprüften Sitzung).
 *  - PulseNorth-Konto → Dienst-Ausweis: `x-pn-service-secret` (PN_SERVICE_SECRET, dasselbe
 *    Geheimnis wie am Credit-Dienst) + `x-pn-subject` (die Kennung aus der Sitzung). Der
 *    Credit-Dienst nimmt ihn nur für VORHANDENE `ml:`-Mitglieder an, nie für
 *    Microsoft-Kennungen.
 *
 * Welcher Ausweis gilt, entscheidet allein die Kennung: `ml:…` = PulseNorth-Konto, alles
 * andere = Microsoft. Ein Konto kann nie den Ausweis der anderen Art bekommen.
 *
 * Das Geheimnis wird NUR hier gelesen (pnServiceSecret) und NUR hier in Kopfzeilen gesetzt
 * (csAuthHeaders). Es steht nie im Ausweis-Objekt, nie in einem Protokoll, nie im Browser
 * (`server-only`).
 *
 * Rückweg ohne Deploy: PN_SERVICE_AUTH=off (oder PN_SERVICE_SECRET entfernen). PulseNorth-
 * Konten werden dann wie vor dem Umbau abgewiesen (B12).
 */

export const PN_MEMBER_PREFIX = "ml:";
const MAX_MEMBER_ID_CHARS = 80;
const MIN_SERVICE_SECRET_CHARS = 32;

/**
 * Nur sichtbare ASCII-Zeichen, kein Leer- oder Steuerzeichen. Einen anderen Wert lehnt
 * `fetch` als Kopfzeile ab — und nennt ihn dabei in der Fehlermeldung, die im Protokoll
 * landen würde. Ein solches Geheimnis gilt deshalb als nicht gesetzt.
 */
const HEADER_SAFE_SECRET = /^[\x21-\x7e]+$/;

/** Kennung eines PulseNorth-Kontos? Gleiche Regel wie im Credit-Dienst (workspaceMapService). */
export function isPnMemberId(id: unknown): id is string {
  return (
    typeof id === "string" &&
    id.startsWith(PN_MEMBER_PREFIX) &&
    id.length > PN_MEMBER_PREFIX.length &&
    id.length <= MAX_MEMBER_ID_CHARS &&
    !/\s/.test(id)
  );
}

/** Das Dienst-Geheimnis oder null (nicht gesetzt, zu kurz, unbrauchbar oder per Schalter aus). */
export function pnServiceSecret(): string | null {
  if ((process.env.PN_SERVICE_AUTH ?? "on").toLowerCase() === "off") return null;
  const s = process.env.PN_SERVICE_SECRET ?? "";
  return s.length >= MIN_SERVICE_SECRET_CHARS && HEADER_SAFE_SECRET.test(s) ? s : null;
}

/** Sind PulseNorth-Konten als vollwertige Konten eingeschaltet? */
export function pnAccountsEnabled(): boolean {
  return pnServiceSecret() !== null;
}

export type CsCredential =
  | { kind: "entra"; accessToken: string }
  | { kind: "pn"; memberId: string };

/**
 * `transient` wie im Token-Speicher (B26): Störung statt abgelehntem Token — nur OHNE
 * `transient` steht fest, dass eine neue Anmeldung nötig ist.
 */
export type CsCredentialResult =
  | { ok: true; credential: CsCredential }
  | { ok: false; reason: "no-token" | "refresh-failed"; transient?: true };

/**
 * Ausweis zu einer Kennung AUS DER GEPRÜFTEN SITZUNG (nie aus dem Request).
 *  - `ml:…`  → Dienst-Ausweis, wenn eingeschaltet und die Kennung gültig ist; sonst
 *              `no-token`. Eine Kennung mit diesem Präfix erreicht NIE den Token-Speicher.
 *  - sonst   → Microsoft-Token aus dem Server-Speicher (wie bisher).
 */
export async function csCredentialFor(oid: string | null | undefined): Promise<CsCredentialResult> {
  if (typeof oid !== "string" || !oid) return { ok: false, reason: "no-token" };
  if (oid.startsWith(PN_MEMBER_PREFIX)) {
    return isPnMemberId(oid) && pnAccountsEnabled()
      ? { ok: true, credential: { kind: "pn", memberId: oid } }
      : { ok: false, reason: "no-token" };
  }
  // Dynamischer Import: Der Token-Speicher (Cosmos) bleibt aus dem Modulgraph des Tors
  // (api-auth), und für ein PulseNorth-Konto wird er gar nicht erst geladen.
  const { getValid } = await import("@/lib/server/credits/entra-token-store");
  const tok = await getValid(oid);
  if (tok.ok) return { ok: true, credential: { kind: "entra", accessToken: tok.accessToken } };
  return tok.transient
    ? { ok: false, reason: tok.reason, transient: true }
    : { ok: false, reason: tok.reason };
}

/**
 * Die EINE Stelle, an der der Coach die Ausweis-Kopfzeilen für den Credit-Dienst baut.
 * Das Geheimnis steht nie im Ausweis-Objekt (das wandert durch den Code), sondern wird
 * erst hier gelesen. Die Fehlermeldung ist fest und nennt weder Geheimnis noch Kennung.
 */
export function csAuthHeaders(cred: CsCredential): Record<string, string> {
  if (cred.kind === "entra") return { Authorization: `Bearer ${cred.accessToken}` };
  const secret = pnServiceSecret();
  if (!secret || !isPnMemberId(cred.memberId)) throw new Error("pn_service_auth_unavailable");
  return { "x-pn-service-secret": secret, "x-pn-subject": cred.memberId };
}
