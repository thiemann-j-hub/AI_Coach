"use client";

import { signIn as nextAuthSignIn, signOut as nextAuthSignOut } from "next-auth/react";

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
    await nextAuthSignOut({ redirectTo: "/analyze" });
    return { error: null };
  } catch (error) {
    return { error: error as Error };
  }
}
