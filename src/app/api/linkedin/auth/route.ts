import { NextRequest, NextResponse } from "next/server";
import { getAuthorizationUrl, getRedirectUri, isLinkedInConfigured } from "@/lib/linkedin";
import { createSignedState } from "@/lib/server/linkedin-connection";
import { requireAuth } from "@/lib/api-auth";

export const runtime = "nodejs";

/** Nur app-interne Pfade zulassen (Open-Redirect-Schutz). */
function sanitizeReturnTo(value: unknown): string {
  if (typeof value === "string" && value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  return "/analyze";
}

/**
 * Startet den OAuth-Flow: POST mit Firebase-Auth (statt GET-Navigation),
 * damit der HMAC-signierte state die uid traegt — der Callback ordnet das
 * Token darueber dem richtigen User in Firestore zu (LI-E3).
 * Die Card navigiert selbst zur zurueckgegebenen authUrl.
 */
export async function POST(req: NextRequest) {
  if (!isLinkedInConfigured()) {
    return NextResponse.json(
      { error: "LinkedIn is not configured. Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET." },
      { status: 503 }
    );
  }

  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const returnTo = sanitizeReturnTo(body?.returnTo);

  // Signierter state: CSRF-Schutz (Cookie-Vergleich im Callback) + uid-Bindung
  const state = createSignedState(auth.uid);
  const authUrl = getAuthorizationUrl(state, getRedirectUri(req.url));

  const response = NextResponse.json({ authUrl });
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 600, // 10 minutes
    path: "/",
  };
  response.cookies.set("linkedin_oauth_state", state, cookieOpts);
  response.cookies.set("linkedin_return_to", returnTo, cookieOpts);

  return response;
}
