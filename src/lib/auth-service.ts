"use client";

import { signIn as nextAuthSignIn, signOut as nextAuthSignOut } from "next-auth/react";
import { withBasePath } from "@/lib/base-path";
import { goToHubLogin, hubLoginEnabled, markAccountChoice, reLoginViaHub } from "@/lib/hub-login";

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

/**
 * „Neu anmelden" (Streifen „Sitzung abgelaufen", Analyse, Credits-Seite). `uid` ist die
 * Kennung der laufenden Sitzung. Ein PulseNorth-Konto (Anmeldung ohne Microsoft) geht
 * dafür NIE direkt zu Microsoft, sondern zur Anmeldekarte im Hub und kommt danach auf
 * diese Seite zurück. Microsoft-Konten: unverändert.
 */
export async function signInAgain(uid: string | null | undefined) {
  if (reLoginViaHub(uid)) {
    goToHubLogin();
    return { error: null };
  }
  return signInWithMicrosoft();
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
