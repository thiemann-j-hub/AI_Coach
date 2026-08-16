"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { SessionProvider, useSession } from "next-auth/react";
import {
  defaultLocale,
  locales,
  type Locale,
} from "@/i18n/config";
import { getLocaleCookie, setLocaleCookie } from "@/i18n/locale-cookie";
import { authFetch } from "@/lib/api-client";
import { BASE_PATH } from "@/lib/base-path";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Schlanker User-Shim — Feldnamen wie beim früheren Firebase-User, damit
 *  die Konsumenten (user-nav, AuthGuard, Cards) unverändert bleiben. */
export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  language?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  locale: Locale;
  /** Persist locale to cookie + Cosmos-Profil and update UI instantly */
  updateLanguage: (locale: Locale) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  locale: defaultLocale,
  updateLanguage: async () => {},
});

/* ------------------------------------------------------------------ */
/*  Inner Provider (braucht SessionProvider-Kontext)                   */
/* ------------------------------------------------------------------ */

function InnerAuthProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const [locale, setLocale] = useState<Locale>(defaultLocale);
  // Zentrales Profil (16.08.): Bild + Anzeigename kommen aus dem Mandanten-
  // Register (via /api/users/profile) und gewinnen gegen die Session-Werte —
  // "einmal aendern, ueberall gleich".
  const [centralAvatar, setCentralAvatar] = useState<string | null>(null);
  const [centralName, setCentralName] = useState<string | null>(null);

  // Initialise locale from cookie on mount (client-side only)
  useEffect(() => {
    setLocale(getLocaleCookie());
  }, []);

  const uid = (session?.user as { id?: string } | undefined)?.id ?? null;

  // User-Shim aus der NextAuth-Session ableiten
  const user: AuthUser | null = useMemo(() => {
    if (!uid) return null;
    return {
      uid,
      email: session?.user?.email ?? null,
      displayName: centralName ?? session?.user?.name ?? null,
      photoURL: centralAvatar ?? session?.user?.image ?? null,
    };
  }, [uid, session?.user?.email, session?.user?.name, session?.user?.image, centralAvatar, centralName]);

  // Nach Login: frisches Profil aus Cosmos holen (provisioniert beim ersten
  // Mal) und gespeicherte Sprache in Cookie + State syncen.
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch("/api/users/profile");
        const j = await res.json().catch(() => null);
        const lang = j?.profile?.language;
        if (!cancelled && lang && locales.includes(lang as Locale)) {
          setLocaleCookie(lang as Locale);
          setLocale(lang as Locale);
        }
        // Zentrales Profil uebernehmen (null = nichts gesetzt).
        if (!cancelled && typeof j?.profile?.avatarUrl === "string" && j.profile.avatarUrl) {
          setCentralAvatar(j.profile.avatarUrl);
        }
        if (!cancelled && typeof j?.profile?.displayName === "string" && j.profile.displayName) {
          setCentralName(j.profile.displayName);
        }
      } catch {
        // Cookie-Locale bleibt maßgeblich
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  // Referenzielle Stabilität (Playbook Gotcha 3): Funktionen in useCallback,
  // Context-Value in useMemo — sonst Endlos-Refetch in den Konsumenten.
  const updateLanguage = useCallback(
    async (newLocale: Locale) => {
      setLocale(newLocale);
      setLocaleCookie(newLocale);
      try {
        document.documentElement.lang = newLocale;
      } catch {}
      if (uid) {
        try {
          await authFetch("/api/users/profile", {
            method: "PATCH",
            body: JSON.stringify({ language: newLocale }),
          });
        } catch {
          // Cosmos-Write fehlgeschlagen – Cookie + State greifen trotzdem
        }
      }
    },
    [uid]
  );

  const value = useMemo(
    () => ({
      user,
      loading: status === "loading",
      locale,
      updateLanguage,
    }),
    [user, status, locale, updateLanguage]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // basePath der Auth.js-API: unter dem Front Door liegt sie unter
  // `/coach/api/auth` — ohne diesen Prop wuerde next-auth/react `/api/auth/session`
  // (404) abfragen → Session laedt nie → SSO bricht. Setzt zugleich den basePath
  // fuer signIn/signOut (modulglobaler __NEXTAUTH-Context).
  return (
    <SessionProvider basePath={`${BASE_PATH}/api/auth`}>
      <InnerAuthProvider>{children}</InnerAuthProvider>
    </SessionProvider>
  );
}

export const useAuth = () => useContext(AuthContext);
