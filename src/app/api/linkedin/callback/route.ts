import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken, getLinkedInProfile, getRedirectUri } from "@/lib/linkedin";

export const runtime = "nodejs";

/** Nur app-interne Pfade zulassen (Open-Redirect-Schutz). */
function sanitizeReturnTo(value: string | undefined): string {
  if (value && value.startsWith("/") && !value.startsWith("//")) return value;
  return "/analyze";
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  // Zurück dorthin, wo der Connect gestartet wurde (Cookie aus /api/linkedin/auth)
  const returnTo = sanitizeReturnTo(req.cookies.get("linkedin_return_to")?.value);

  function redirectWith(param: "linkedin_connected" | "linkedin_error", value: string) {
    const dest = new URL(returnTo, req.url);
    dest.searchParams.set(param, value);
    const response = NextResponse.redirect(dest);
    response.cookies.delete("linkedin_oauth_state");
    response.cookies.delete("linkedin_return_to");
    return response;
  }

  // Handle errors from LinkedIn
  if (error) {
    const desc = req.nextUrl.searchParams.get("error_description") ?? "Unknown error";
    return redirectWith("linkedin_error", desc);
  }

  if (!code) {
    return redirectWith("linkedin_error", "no_code");
  }

  // Verify state to prevent CSRF
  const storedState = req.cookies.get("linkedin_oauth_state")?.value;
  if (!storedState || storedState !== state) {
    return redirectWith("linkedin_error", "invalid_state");
  }

  try {
    // Exchange code for access token
    const tokenData = await exchangeCodeForToken(code, getRedirectUri(req.url));

    // Get the user's LinkedIn profile to extract the person URN
    const profile = await getLinkedInProfile(tokenData.access_token);

    // Store token and profile in cookies (httpOnly for security)
    // In production, store in Firestore instead
    const response = redirectWith("linkedin_connected", "1");

    // Store the access token (expires in ~60 days typically)
    response.cookies.set("linkedin_access_token", tokenData.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: tokenData.expires_in,
      path: "/",
    });

    // Store the person URN (sub from OpenID)
    response.cookies.set("linkedin_person_urn", profile.sub, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: tokenData.expires_in,
      path: "/",
    });

    // Store display info (not sensitive)
    response.cookies.set("linkedin_name", profile.name ?? "", {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: tokenData.expires_in,
      path: "/",
    });

    return response;
  } catch (err: any) {
    console.error("[linkedin-callback] Error:", err?.message ?? err);
    return redirectWith("linkedin_error", err?.message ?? "token_exchange_failed");
  }
}
