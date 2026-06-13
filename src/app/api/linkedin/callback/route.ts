import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken, getLinkedInProfile, getRedirectUri } from "@/lib/linkedin";
import { saveLinkedInConnection, verifySignedState } from "@/lib/server/linkedin-connection";

export const runtime = "nodejs";

// Cookies der alten Cookie-only-Token-Speicherung (vor LI-E3)
const LEGACY_COOKIES = ["linkedin_access_token", "linkedin_person_urn", "linkedin_name"];

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

  // CSRF-Schutz: state muss dem Cookie entsprechen UND gueltig signiert sein.
  // Die Signatur traegt die Firebase-uid, der dieses Token gehoert (LI-E3).
  const storedState = req.cookies.get("linkedin_oauth_state")?.value;
  if (!storedState || storedState !== state) {
    return redirectWith("linkedin_error", "invalid_state");
  }
  const verified = verifySignedState(state);
  if (!verified) {
    return redirectWith("linkedin_error", "invalid_state");
  }

  try {
    // Exchange code for access token
    const tokenData = await exchangeCodeForToken(code, getRedirectUri(req.url));

    // Get the user's LinkedIn profile to extract the person URN
    const profile = await getLinkedInProfile(tokenData.access_token);

    // Token verschluesselt pro User in Cosmos ablegen —
    // multi-device-faehig, Server liest beim Posten (LI-E3)
    await saveLinkedInConnection(verified.uid, {
      accessToken: tokenData.access_token,
      personUrn: profile.sub,
      name: profile.name ?? "",
      expiresAt: Date.now() + tokenData.expires_in * 1000,
      scope: tokenData.scope,
    });

    const response = redirectWith("linkedin_connected", "1");
    for (const name of LEGACY_COOKIES) response.cookies.delete(name);
    return response;
  } catch (err: any) {
    console.error("[linkedin-callback] Error:", err?.message ?? err);
    return redirectWith("linkedin_error", err?.message ?? "token_exchange_failed");
  }
}
