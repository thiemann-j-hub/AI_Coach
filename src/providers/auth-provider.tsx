"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { User, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebaseClient";
import {
  defaultLocale,
  locales,
  type Locale,
} from "@/i18n/config";
import {
  getLocaleCookie,
  setLocaleCookie,
  getBrowserLocale,
} from "@/i18n/locale-cookie";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  language?: string;
  createdAt: string;
  updatedAt: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  locale: Locale;
  /** Persist locale to cookie + Firestore and update UI instantly */
  updateLanguage: (locale: Locale) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  locale: defaultLocale,
  updateLanguage: async () => {},
});

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [locale, setLocale] = useState<Locale>(defaultLocale);

  // Initialise locale from cookie on mount (client-side only)
  useEffect(() => {
    setLocale(getLocaleCookie());
  }, []);

  // ---- Auth state listener with Firestore profile sync ----
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);

      if (!firebaseUser) return;

      try {
        const userRef = doc(db, "users", firebaseUser.uid);
        const snap = await getDoc(userRef);

        if (snap.exists()) {
          const profile = snap.data() as UserProfile;

          if (
            profile.language &&
            locales.includes(profile.language as Locale)
          ) {
            // Sync Firestore language → cookie + state
            setLocaleCookie(profile.language as Locale);
            setLocale(profile.language as Locale);
          }
        } else {
          // First sign-in: create profile.
          // Prefer existing cookie (user may have just picked a language).
          const cookieLocale = getLocaleCookie();
          const initialLocale =
            cookieLocale !== defaultLocale ? cookieLocale : getBrowserLocale();
          const now = new Date().toISOString();
          const newProfile: UserProfile = {
            uid: firebaseUser.uid,
            email: firebaseUser.email ?? "",
            displayName: firebaseUser.displayName ?? "",
            photoURL: firebaseUser.photoURL ?? undefined,
            language: initialLocale,
            createdAt: now,
            updatedAt: now,
          };
          await setDoc(userRef, newProfile);
          setLocaleCookie(initialLocale);
          setLocale(initialLocale);
        }
      } catch (err) {
        console.error("[auth-provider] profile sync error:", err);
      }
    });

    return () => unsubscribe();
  }, []);

  // ---- updateLanguage ----
  const updateLanguage = async (newLocale: Locale) => {
    // 1. Update React state immediately → UI updates instantly
    setLocale(newLocale);

    // 2. Persist to cookie for next page load
    setLocaleCookie(newLocale);

    // 3. Persist to Firestore (if logged in)
    if (user) {
      try {
        const userRef = doc(db, "users", user.uid);
        await setDoc(
          userRef,
          { language: newLocale, updatedAt: new Date().toISOString() },
          { merge: true }
        );
      } catch {
        // Firestore write failed – cookie + state are still set
      }
    }

    // No reload needed – React state drives the UI
  };

  return (
    <AuthContext.Provider value={{ user, loading, locale, updateLanguage }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
