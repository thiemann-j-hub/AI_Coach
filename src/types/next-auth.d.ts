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
  }
}
