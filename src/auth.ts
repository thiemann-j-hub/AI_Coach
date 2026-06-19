import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

/**
 * NextAuth v5 — Microsoft Entra ID (OIDC).
 *
 * Tenant "common" + Audience AzureADandPersonalMicrosoftAccount in der
 * App-Registrierung: erlaubt Organisations- UND persönliche Microsoft-Konten
 * (Playbook Gotcha 10). Session als JWT im HTTP-only-Cookie — die API-Routen
 * lesen sie über requireAuth() (gleiche Vertragsform wie der frühere
 * Firebase-Helfer).
 */
/**
 * Scope fuer den zentralen, app-uebergreifenden CreditService (Bearer-Calls).
 * Aus ENV ueberschreibbar; Default = die gemeinsame Entra-App.
 */
const CREDIT_SERVICE_SCOPE =
  process.env.CREDIT_SERVICE_SCOPE ??
  "api://7ecf46aa-f47d-4491-a8ce-fe92c368e6f2/access_as_user";

const OAUTH_SCOPE = `openid profile email offline_access ${CREDIT_SERVICE_SCOPE}`;
const ENTRA_TENANT = process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID ?? "common";

/**
 * Holt mit dem refresh_token ein frisches access_token (Entra v2). Bei Erfolg
 * werden access_token + Ablauf (und ggf. das rotierte refresh_token) im JWT
 * aktualisiert; bei Fehler markiert token.error="RefreshFailed" -> Re-Login.
 * Das Access-Token lebt ~1h, die Auth.js-Session 30 Tage — ohne diese Rotation
 * reicht der Server ein abgelaufenes Token an den CreditService weiter (401).
 */
async function refreshAccessToken(token: any): Promise<any> {
  try {
    if (!token?.refreshToken) throw new Error("no refresh_token in session");
    const res = await fetch(
      `https://login.microsoftonline.com/${ENTRA_TENANT}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: String(token.refreshToken),
          client_id: process.env.AUTH_MICROSOFT_ENTRA_ID_ID ?? "",
          client_secret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET ?? "",
          scope: OAUTH_SCOPE,
        }),
        cache: "no-store",
      }
    );
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`refresh ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return {
      ...token,
      accessToken: data.access_token,
      accessTokenExpires: Date.now() + Number(data.expires_in ?? 3600) * 1000,
      // Entra rotiert das refresh_token — das neue uebernehmen, sonst altes behalten.
      refreshToken: data.refresh_token ?? token.refreshToken,
      error: undefined,
    };
  } catch (e) {
    console.error("[auth] token refresh failed:", e);
    return { ...token, error: "RefreshFailed" };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: `https://login.microsoftonline.com/${process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID ?? "common"}/v2.0`,
      // openid/profile/email = OIDC-Basis; offline_access = Refresh-Token;
      // access_as_user = delegierter Zugriff auf den zentralen CreditService.
      authorization: {
        params: {
          scope: `openid profile email offline_access ${CREDIT_SERVICE_SCOPE}`,
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, profile, account }) {
      // (1) Erstanmeldung: account + profile vorhanden -> alles erfassen.
      if (account) {
        // Stabile lokale User-ID: OIDC sub (ersetzt Firebase-uid; bleibt die
        // lokale Identitaet, das alte Coach-Datenmodell schluesselt darauf).
        if (profile?.sub) token.uid = profile.sub;
        // Entra Object-ID: app-uebergreifend stabil -> CreditService-Mapping.
        const oid = (profile as { oid?: string } | undefined)?.oid;
        if (oid) token.oid = oid;
        // Access-/Refresh-Token + Ablauf fuer die CreditService-Bearer-Calls.
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.accessTokenExpires = account.expires_at
          ? Number(account.expires_at) * 1000
          : Date.now() + Number(account.expires_in ?? 3600) * 1000;
        token.error = undefined;
        return token;
      }

      // (2) Folge-Requests: noch gueltig (mit 60s-Puffer)? -> unveraendert.
      if (
        typeof token.accessTokenExpires === "number" &&
        Date.now() < token.accessTokenExpires - 60_000
      ) {
        return token;
      }

      // (3) Abgelaufen (oder ohne Ablaufmarke) -> per refresh_token erneuern.
      return await refreshAccessToken(token);
    },
    session({ session, token }) {
      if (session.user && token.uid) {
        (session.user as { id?: string }).id = String(token.uid);
      }
      if (session.user && token.oid) {
        (session.user as { oid?: string }).oid = String(token.oid);
      }
      if (token.accessToken) {
        (session as { accessToken?: string }).accessToken = String(token.accessToken);
      }
      // Refresh-Fehler an den Client/Server-Pfad durchreichen -> Re-Login statt
      // stiller „0 Credits".
      if (token.error) {
        (session as { error?: string }).error = String(token.error);
      }
      return session;
    },
  },
});
