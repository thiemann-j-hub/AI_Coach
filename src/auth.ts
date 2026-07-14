import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { OAUTH_SCOPE } from "@/lib/credit-scope";

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
 * Scope (Login = Refresh) kommt aus @/lib/credit-scope — DIESELBE Quelle, die
 * der Token-Store fuer den Refresh nutzt. Sonst koennte der Refresh ein Token
 * mit falscher Audience holen (Blueprint §2/§4).
 */

/**
 * Token-Rotation laeuft NICHT mehr im JWT/Cookie (das war auf next-auth
 * 5.0.0-beta.31 latent kaputt: der no-args `auth()`-Pfad verwirft das Set-Cookie
 * mit dem rotierten Token → RT0 rotiert nie → Entra-Reuse-Detection widerruft die
 * Familie → Wallet faellt ~1 h nach dem ersten Refresh still aus). Stattdessen
 * seedet der Login einen SERVER-seitigen Token-Store (entra-token-store.ts), aus
 * dem der Wallet-/Spend-Pfad das (bei Bedarf refreshte) Token per getValid(oid)
 * zieht. Siehe Blueprint CREDIT-TOKEN-STORE §0/§2.
 */

/**
 * GETEILTES Session-Cookie fuer den Pulscraft-Hub-Front-Door (same origin,
 * `/` = Hub, `/coach/*` = Coach): exakt DIESELBE Cookie-Konfig wie der Hub —
 * gleicher Name + `path:"/"` + gleiches AUTH_SECRET. Dann liest Coach das vom
 * Hub gesetzte Cookie (Auth.js leitet den JWE-Schluessel via HKDF mit dem
 * Cookie-Namen als Salt ab → Name MUSS identisch sein) → SSO ohne Hub-IdP.
 * Secure-Praefix `__Secure-` nur unter https (AUTH_URL).
 */
const useSecureCookies = (process.env.AUTH_URL ?? "").startsWith("https://");
const SESSION_COOKIE = (useSecureCookies ? "__Secure-" : "") + "pulsenorth.session-token";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  // Auth.js-core-basePath = "/api/auth" (NICHT "/coach/api/auth"): Next strippt den
  // Front-Door-basePath (/coach) aus req.nextUrl, BEVOR die Auth-Route ihn sieht —
  // serverseitig kommt also immer "/api/auth/session" an. EXPLIZIT setzen, damit
  // AUTH_URL.pathname (= /coach) den basePath nicht faelschlich auf "/coach"
  // ueberschreibt (sonst UnknownAction). Der CLIENT (SessionProvider) nutzt dagegen
  // den vollen Browser-Pfad "/coach/api/auth".
  basePath: "/api/auth",
  session: { strategy: "jwt" },
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: useSecureCookies },
    },
  },
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: `https://login.microsoftonline.com/${process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID ?? "common"}/v2.0`,
      // openid/profile/email = OIDC-Basis; offline_access = Refresh-Token;
      // access_as_user = delegierter Zugriff auf den zentralen CreditService.
      // OAUTH_SCOPE = geteilte Quelle (identisch zum Refresh im Token-Store).
      authorization: {
        params: {
          scope: OAUTH_SCOPE,
        },
      },
    }),
  ],
  callbacks: {
    /**
     * R6 (Master-Blueprint §3.3) — Defense-in-Depth beim Sign-In. Lehnt NUR bei
     * EXPLIZIT `email_verified === false` ab (nicht bei fehlendem Claim), analog
     * zum Studio-Muster. BEWUSST KEIN hartes oid-Allowlist: PulseNorth ist
     * B2B-Self-Service (Kunde meldet sich an + zahlt) — ein Allowlist würde
     * Neukunden aussperren. Der fälschbare-E-Mail-Vektor (R2/R3) wird separat
     * über Invite-Token geschlossen; hier nur das unstrittige Anti-Spoofing.
     */
    async signIn({ profile }) {
      const p = (profile || {}) as Record<string, unknown>;
      if (p.email_verified === false || p.email_verified === "false") {
        const oid = typeof p.oid === "string" ? p.oid : "?";
        console.warn(`[auth.signIn] REJECT: email_verified === false (oid=${oid})`);
        // basePath-bewusst (Review-Fund, Studio-Muster): Auth.js loest den Return
        // gegen die ORIGIN-baseUrl auf (ohne /coach) — `false` landete sonst auf
        // der HUB-Fehlerseite. Coach hat keine /login-Route -> Coach-Wurzel.
        return "/coach?error=email-not-verified";
      }
      return true;
    },
    async jwt({ token, profile, account }) {
      // Nur bei der Erstanmeldung (OAuth-Callback) ist `account` gesetzt. Reihenfolge
      // wichtig: oid ZUERST festhalten, dann den Token-Store seeden (Blueprint §2).
      if (account) {
        // Stabile lokale User-ID: OIDC sub (ersetzt Firebase-uid; bleibt die
        // lokale Identitaet, das alte Coach-Datenmodell schluesselt darauf).
        if (profile?.sub) token.uid = profile.sub;
        // Entra Object-ID: app-uebergreifend stabil -> CreditService-Store-Key.
        const oid = (profile as { oid?: string } | undefined)?.oid;
        if (oid) token.oid = oid;

        // SERVER-Store seeden (kein Token mehr im JWT/Cookie). Best-effort:
        // ein Store-Fehler darf den Login NICHT brechen. Dynamic import haelt
        // Cosmos aus dem Modulgraph, bis tatsaechlich ein Login passiert.
        if (account.access_token && token.oid) {
          try {
            const { put } = await import("@/lib/server/credits/entra-token-store");
            await put(String(token.oid), {
              accessToken: account.access_token,
              refreshToken: account.refresh_token ?? "",
              accessTokenExpires: account.expires_at
                ? Number(account.expires_at) * 1000
                : Date.now() + 3600_000,
            });
          } catch (e) {
            console.error("[credits] initial token write failed:", e);
          }
        }
      }
      return token;
    },
    session({ session, token }) {
      // NUR Identitaet in die Session — NIEMALS access/refresh_token. Den Token
      // zieht der Server-Pfad ausschliesslich per getValid(oid) aus dem Store.
      if (session.user && token.uid) {
        (session.user as { id?: string }).id = String(token.uid);
      }
      if (session.user && token.oid) {
        (session.user as { oid?: string }).oid = String(token.oid);
      }
      return session;
    },
  },
});
