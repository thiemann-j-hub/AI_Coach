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
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: `https://login.microsoftonline.com/${process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID ?? "common"}/v2.0`,
    }),
  ],
  callbacks: {
    jwt({ token, profile }) {
      // Stabile User-ID: OIDC sub des Microsoft-Kontos (ersetzt Firebase-uid)
      if (profile?.sub) token.uid = profile.sub;
      return token;
    },
    session({ session, token }) {
      if (session.user && token.uid) {
        (session.user as { id?: string }).id = String(token.uid);
      }
      return session;
    },
  },
});
