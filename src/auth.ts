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
    jwt({ token, profile, account }) {
      // Stabile User-ID: OIDC sub des Microsoft-Kontos (ersetzt Firebase-uid).
      // BLEIBT die lokale Identitaet — das alte Coach-Datenmodell ist in Phase 1
      // weiter die Quelle der Wahrheit; nichts daran wird umgeschluesselt.
      if (profile?.sub) token.uid = profile.sub;
      // Entra Object-ID: app-uebergreifend STABIL (anders als das pairwise sub).
      // Der zentrale CreditService schluesselt darauf -> fuer den Dual-Write +
      // das Reconcile-Mapping (sub -> oid) noetig.
      const oid = (profile as { oid?: string } | undefined)?.oid;
      if (oid) token.oid = oid;
      // Access-Token fuer Bearer-Calls an den CreditService — nur beim Sign-in
      // im `account` vorhanden. Phase-1-Dual-Write nutzt es best-effort: laeuft
      // es mid-session ab, scheitert NUR der Schatten-Write (geloggt), nie der
      // User-Flow. (Refresh-Token-Rotation = spaetere Haertung.)
      if (account?.access_token) token.accessToken = account.access_token;
      return token;
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
      return session;
    },
  },
});
