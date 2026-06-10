import "server-only";

import { getAuth } from "firebase-admin/auth";
import { getAdminApp } from "./firebase-admin";
import { getApiMessages } from "./server/get-request-locale";
import { NextRequest, NextResponse } from "next/server";

/**
 * Verifies Firebase ID token from the Authorization header.
 * Returns the decoded token (with uid) or null if invalid/missing.
 */
export async function verifyAuthToken(req: NextRequest | Request) {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;

  const idToken = header.slice(7);
  if (!idToken) return null;

  try {
    const auth = getAuth(getAdminApp());
    const decoded = await auth.verifyIdToken(idToken);
    return decoded;
  } catch {
    return null;
  }
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
 * Convenience: verify auth and return uid, or send 401.
 * Usage in API routes:
 *   const auth = await requireAuth(req);
 *   if (auth instanceof NextResponse) return auth;
 *   const { uid } = auth;
 */
export async function requireAuth(req: NextRequest | Request) {
  const decoded = await verifyAuthToken(req);
  if (!decoded) return unauthorizedResponse(getApiMessages(req).unauthorized);
  return { uid: decoded.uid, email: decoded.email ?? null, decoded };
}
