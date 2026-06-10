import { NextRequest, NextResponse } from "next/server";
import { getAuthorizationUrl, getRedirectUri, isLinkedInConfigured } from "@/lib/linkedin";
import crypto from "crypto";

export const runtime = "nodejs";

/** Nur app-interne Pfade zulassen (Open-Redirect-Schutz). */
function sanitizeReturnTo(value: string | null): string {
  if (value && value.startsWith("/") && !value.startsWith("//")) return value;
  return "/analyze";
}

export async function GET(req: NextRequest) {
  if (!isLinkedInConfigured()) {
    return NextResponse.json(
      { error: "LinkedIn is not configured. Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET." },
      { status: 503 }
    );
  }

  // Generate a random state parameter for CSRF protection
  const state = crypto.randomBytes(16).toString("hex");

  const returnTo = sanitizeReturnTo(req.nextUrl.searchParams.get("returnTo"));
  const authUrl = getAuthorizationUrl(state, getRedirectUri(req.url));

  // Set state in a cookie for verification in the callback
  const response = NextResponse.redirect(authUrl);
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
