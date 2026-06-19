import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getApiMessages } from "./server/get-request-locale";

/**
 * Auth-Helfer für API-Routen — NextAuth-Session (HTTP-only-Cookie) statt
 * Firebase-Bearer-Token. Vertragsform bewusst identisch zum früheren
 * Firebase-Helfer ({ uid, email } | 401-Response), damit die Routen
 * unverändert bleiben (Playbook-Leitprinzip „Vertragstreue").
 */
export async function verifyAuthToken(_req: NextRequest | Request) {
  const session = await auth();
  const uid = (session?.user as { id?: string } | undefined)?.id;
  if (!uid) return null;
  return {
    uid,
    email: session?.user?.email ?? null,
    // App-uebergreifend stabile Entra Object-ID = Schluessel in den Server-Token-Store
    // (entra-token-store). Das Access-Token liegt NICHT mehr in der Session.
    oid: (session?.user as { oid?: string } | undefined)?.oid ?? null,
  };
}

/**
 * Returns a 401 JSON response for unauthenticated requests.
 */
export function unauthorizedResponse(message = "Authentication required") {
  return NextResponse.json(
    { ok: false, error: message, code: "UNAUTHORIZED" },
    { status: 401 }
  );
}

/**
 * Convenience: verify session and return uid, or send 401.
 * Usage in API routes:
 *   const auth = await requireAuth(req);
 *   if (auth instanceof NextResponse) return auth;
 *   const { uid } = auth;
 */
export async function requireAuth(req: NextRequest | Request) {
  const decoded = await verifyAuthToken(req);
  if (!decoded) return unauthorizedResponse(getApiMessages(req).unauthorized);
  return {
    uid: decoded.uid,
    email: decoded.email,
    oid: decoded.oid,
    decoded,
  };
}
