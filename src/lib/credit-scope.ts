/**
 * EINE Scope-Quelle fuer Login (auth.ts) UND Token-Refresh (entra-token-store).
 *
 * Beide MUESSEN exakt denselben Scope anfordern. Faellt nur der Refresh-Pfad auf
 * einen leeren Resource-Scope zurueck (wie zuvor), liefert Entra ~1 h nach dem
 * Login still ein Token mit FALSCHER (resource-loser) Audience → CreditService
 * lehnt mit 401 ab. Daher der gemeinsame Default mit der geteilten Entra-App.
 * Siehe Blueprint CREDIT-TOKEN-STORE §2/§4.
 *
 * Kein "server-only" / keine schweren Importe — reine Konstanten, ueberall sicher.
 */
export const CREDIT_SERVICE_SCOPE =
  process.env.CREDIT_SERVICE_SCOPE ??
  "api://7ecf46aa-f47d-4491-a8ce-fe92c368e6f2/access_as_user";

/** Voller OAuth-Scope (Login = Refresh): OIDC-Basis + offline_access + CreditService. */
export const OAUTH_SCOPE = `openid profile email offline_access ${CREDIT_SERVICE_SCOPE}`;
