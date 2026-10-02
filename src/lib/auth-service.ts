"use client";

import { signIn as nextAuthSignIn, signOut as nextAuthSignOut } from "next-auth/react";
import { withBasePath } from "@/lib/base-path";
import { hubLoginEnabled, markAccountChoice } from "@/lib/hub-login";

/**
 * Auth-Aktionen (NextAuth v5 + Microsoft Entra ID).
 * Ersetzt die früheren Firebase-Flows (E-Mail/Passwort, Google-Popup).
 */

export async function signInWithMicrosoft() {
  try {
    await nextAuthSignIn("microsoft-entra-id");
    return { error: null };
  } catch (error) {
    return { error: error as Error };
  }
}

export async function signOut() {
  try {
    // Eine Anmeldung im Hub (02.10.2026): nach dem Abmelden zur Anmeldekarte dort; die
    // nächste Anmeldung fragt nach dem Konto.
    markAccountChoice();
    await nextAuthSignOut({ redirectTo: hubLoginEnabled() ? "/" : withBasePath("/analyze") });
    return { error: null };
  } catch (error) {
    return { error: error as Error };
  }
}
