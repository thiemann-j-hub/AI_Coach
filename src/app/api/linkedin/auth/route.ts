import { NextRequest, NextResponse } from "next/server";
import { getAuthorizationUrl, isLinkedInConfigured } from "@/lib/linkedin";
import crypto from "crypto";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isLinkedInConfigured()) {
    return NextResponse.json(
      { error: "LinkedIn is not configured. Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET." },
      { status: 503 }
    );
  }

  // Generate a random state parameter for CSRF protection
  const state = crypto.randomBytes(16).toString("hex");

  const authUrl = getAuthorizationUrl(state);

  // Set state in a cookie for verification in the callback
  const response = NextResponse.redirect(authUrl);
  response.cookies.set("linkedin_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  return response;
}
