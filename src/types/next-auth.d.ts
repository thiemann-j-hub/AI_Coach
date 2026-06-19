import { type DefaultSession } from "next-auth";

/**
 * Modul-Augmentation. Die Session traegt NUR Identitaet — KEIN Token mehr
 * (access/refresh_token liegen ausschliesslich im Server-Store, entra-token-store.ts):
 * - session.user.oid — app-uebergreifend stabile Entra Object-ID (Store-Key)
 * - session.user.id  — lokale uid (= OIDC sub), unveraendert
 */
declare module "next-auth" {
  interface Session {
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
  }
}
