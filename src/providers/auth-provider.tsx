"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { SessionProvider, useSession } from "next-auth/react";
import {
  defaultLocale,
  locales,
  type Locale,
} from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries";
import { createLanguageSwitcher, type ActiveLanguage } from "@/i18n/load-dictionary";
import { getLocaleCookie, setLocaleCookie } from "@/i18n/locale-cookie";
import { TranslationContext } from "@/i18n/useTranslation";
import { toast } from "@/hooks/use-toast";
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
  /** Lädt das Wörterbuch nach, schaltet dann um und merkt die Sprache in Cookie und Cosmos-Profil. */
  updateLanguage: (locale: Locale) => Promise<void>;
}

/** Start aus dem Wurzel-Layout: die Sprache aus dem Cookie NEXT_LOCALE und das Wörterbuch dazu. */
interface LanguageStart {
  initialLocale: Locale;
  initialDictionary: Dictionary;
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

function InnerAuthProvider({
  children,
  initialLocale,
  initialDictionary,
}: LanguageStart & { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  // Paket 6, C21 (12.11.2026): Sprache und Wörterbuch stehen in EINEM Zustand und wechseln immer zusammen.
  // Der Start kommt vom Server, damit schon der erste Bildaufbau in der richtigen Sprache steht
  // (vorher: erst Englisch, nach dem Laden die Sprache aus dem Cookie, und alle 22 Wörterbücher im Bündel).
  const [language, setLanguage] = useState<ActiveLanguage>(() => ({
    locale: initialLocale,
    t: initialDictionary,
  }));
  // Derselbe Stand für die Wege, die nach einem Warten weiterlaufen (Wechsel, Meldung in der alten Sprache).
  const languageRef = useRef(language);
  const [switchTo] = useState(() => createLanguageSwitcher());

  /** Lädt das Wörterbuch nach und schaltet erst dann um. Scheitert das Laden, bleibt die alte Sprache. */
  const switchLanguage = useCallback(
    async (next: Locale) => {
      const result = await switchTo(next, languageRef.current);
      if (result.status === "ok" && next !== languageRef.current.locale) {
        languageRef.current = { locale: next, t: result.t };
        setLanguage(languageRef.current);
      }
      return result.status;
    },
    [switchTo]
  );
  // Zentrales Profil (16.08.): Bild + Anzeigename kommen aus dem Mandanten-
  // Register (via /api/users/profile) und gewinnen gegen die Session-Werte —
  // "einmal aendern, ueberall gleich".
  const [centralAvatar, setCentralAvatar] = useState<string | null>(null);
  const [centralName, setCentralName] = useState<string | null>(null);

  // Wie bisher gewinnt das Cookie im Browser. Vom Server-Start weicht es nur ab, wenn es erst mit dieser
  // Antwort gesetzt wurde (erster Besuch ohne Cookie: die Middleware liest die Sprache des Browsers).
  useEffect(() => {
    const cookieLocale = getLocaleCookie();
    if (cookieLocale !== initialLocale) void switchLanguage(cookieLocale);
  }, [initialLocale, switchLanguage]);

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
          // Erst nachladen, dann Cookie und Anzeige zusammen umstellen. Bild und Name warten nicht darauf.
          void switchLanguage(lang as Locale).then((result) => {
            if (result === "ok") setLocaleCookie(lang as Locale);
          });
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
  }, [uid, switchLanguage]);

  // Referenzielle Stabilität (Playbook Gotcha 3): Funktionen in useCallback,
  // Context-Value in useMemo — sonst Endlos-Refetch in den Konsumenten.
  const updateLanguage = useCallback(
    async (newLocale: Locale) => {
      const result = await switchLanguage(newLocale);
      if (result === "failed") {
        // Die alte Sprache bleibt, auch in Cookie und Profil. Die Meldung steht in der alten Sprache.
        toast({ variant: "destructive", title: languageRef.current.t.common.languageLoadFailed });
      }
      if (result !== "ok") return;
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
    [uid, switchLanguage]
  );

  const value = useMemo(
    () => ({
      user,
      loading: status === "loading",
      locale: language.locale,
      updateLanguage,
    }),
    [user, status, language.locale, updateLanguage]
  );

  return (
    <AuthContext.Provider value={value}>
      <TranslationContext.Provider value={language}>{children}</TranslationContext.Provider>
    </AuthContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export function AuthProvider({ children, ...start }: LanguageStart & { children: React.ReactNode }) {
  // basePath der Auth.js-API: unter dem Front Door liegt sie unter
  // `/coach/api/auth` — ohne diesen Prop wuerde next-auth/react `/api/auth/session`
  // (404) abfragen → Session laedt nie → SSO bricht. Setzt zugleich den basePath
  // fuer signIn/signOut (modulglobaler __NEXTAUTH-Context).
  return (
    <SessionProvider basePath={`${BASE_PATH}/api/auth`}>
      <InnerAuthProvider {...start}>{children}</InnerAuthProvider>
    </SessionProvider>
  );
}

export const useAuth = () => useContext(AuthContext);
