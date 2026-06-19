import { type DefaultSession } from "next-auth";

/**
 * Modul-Augmentation fuer den zentralen CreditService:
 * - session.accessToken  — Bearer fuer die CreditService-Calls
 * - session.user.oid     — app-uebergreifend stabile Entra Object-ID
 * - session.user.id      — lokale uid (= OIDC sub), unveraendert
 */
declare module "next-auth" {
  interface Session {
    accessToken?: string;
    /** "RefreshFailed" -> Token konnte nicht erneuert werden; Re-Login noetig. */
    error?: string;
    user: DefaultSession["user"] & {
      id?: string;
      oid?: string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    oid?: string;
    accessToken?: string;
    /** Refresh-Token-Rotation: das Access-Token lebt ~1h, die Session 30 Tage. */
    refreshToken?: string;
    /** Ablauf des Access-Tokens in ms (epoch). */
    accessTokenExpires?: number;
    /** "RefreshFailed" -> Refresh schlug fehl; Session erzwingt Re-Login. */
    error?: string;
  }
}
