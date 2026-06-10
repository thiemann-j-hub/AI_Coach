import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken, getLinkedInProfile } from "@/lib/linkedin";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  // Handle errors from LinkedIn
  if (error) {
    const desc = req.nextUrl.searchParams.get("error_description") ?? "Unknown error";
    return NextResponse.redirect(
      new URL(`/?linkedin_error=${encodeURIComponent(desc)}`, req.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/?linkedin_error=no_code", req.url)
    );
  }

  // Verify state to prevent CSRF
  const storedState = req.cookies.get("linkedin_oauth_state")?.value;
  if (!storedState || storedState !== state) {
    return NextResponse.redirect(
      new URL("/?linkedin_error=invalid_state", req.url)
    );
  }

  try {
    // Exchange code for access token
    const tokenData = await exchangeCodeForToken(code);

    // Get the user's LinkedIn profile to extract the person URN
    const profile = await getLinkedInProfile(tokenData.access_token);

    // Store token and profile in cookies (httpOnly for security)
    // In production, store in Firestore instead
    const response = NextResponse.redirect(new URL("/?linkedin_connected=1", req.url));

    // Clear the OAuth state cookie
    response.cookies.delete("linkedin_oauth_state");

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
    return NextResponse.redirect(
      new URL(`/?linkedin_error=${encodeURIComponent(err?.message ?? "token_exchange_failed")}`, req.url)
    );
  }
}
