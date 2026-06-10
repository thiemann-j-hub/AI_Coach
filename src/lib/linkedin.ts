/**
 * LinkedIn API utilities - OAuth 2.0 + Posts API
 *
 * Handles the complete LinkedIn posting flow:
 * 1. OAuth 2.0 three-legged flow (auth URL → callback → token)
 * 2. Image upload to LinkedIn
 * 3. Post creation with image
 */

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID ?? "";
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET ?? "";
const LINKEDIN_REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI ?? "http://localhost:9002/api/linkedin/callback";
const LINKEDIN_API_VERSION = "202502";

/* ------------------------------------------------------------------ */
/*  OAuth 2.0                                                          */
/* ------------------------------------------------------------------ */

/**
 * Build the LinkedIn authorization URL for the three-legged OAuth flow.
 */
export function getAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: LINKEDIN_CLIENT_ID,
    redirect_uri: LINKEDIN_REDIRECT_URI,
    scope: "openid profile w_member_social",
    state,
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
}

/**
 * Exchange authorization code for access token.
 */
export async function exchangeCodeForToken(code: string): Promise<{
  access_token: string;
  expires_in: number;
  scope: string;
}> {
  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: LINKEDIN_CLIENT_ID,
      client_secret: LINKEDIN_CLIENT_SECRET,
      redirect_uri: LINKEDIN_REDIRECT_URI,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LinkedIn token exchange failed: ${res.status} ${text}`);
  }

  return res.json();
}

/* ------------------------------------------------------------------ */
/*  Profile                                                            */
/* ------------------------------------------------------------------ */

/**
 * Get the authenticated user's LinkedIn profile (sub = person URN).
 */
export async function getLinkedInProfile(accessToken: string): Promise<{
  sub: string;
  name: string;
  picture?: string;
}> {
  const res = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LinkedIn profile fetch failed: ${res.status} ${text}`);
  }

  return res.json();
}

/* ------------------------------------------------------------------ */
/*  Image Upload                                                       */
/* ------------------------------------------------------------------ */

/**
 * Register an image upload with LinkedIn and upload the image binary.
 * Returns the image URN for use in a post.
 */
export async function uploadImageToLinkedIn(
  accessToken: string,
  personUrn: string,
  imageBuffer: Buffer,
  mimeType: string = "image/png"
): Promise<string> {
  // Step 1: Register the upload
  const registerRes = await fetch(
    "https://api.linkedin.com/rest/images?action=initializeUpload",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "LinkedIn-Version": LINKEDIN_API_VERSION,
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        initializeUploadRequest: {
          owner: `urn:li:person:${personUrn}`,
        },
      }),
    }
  );

  if (!registerRes.ok) {
    const text = await registerRes.text();
    throw new Error(`LinkedIn image register failed: ${registerRes.status} ${text}`);
  }

  const registerData = await registerRes.json();
  const uploadUrl = registerData?.value?.uploadUrl;
  const imageUrn = registerData?.value?.image;

  if (!uploadUrl || !imageUrn) {
    throw new Error("LinkedIn image registration did not return uploadUrl or image URN");
  }

  // Step 2: Upload the binary image
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": mimeType,
    },
    body: imageBuffer,
  });

  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    throw new Error(`LinkedIn image upload failed: ${uploadRes.status} ${text}`);
  }

  return imageUrn;
}

/* ------------------------------------------------------------------ */
/*  Create Post                                                        */
/* ------------------------------------------------------------------ */

export interface LinkedInPostOptions {
  accessToken: string;
  personUrn: string;
  text: string;
  imageUrn?: string;
}

/**
 * Create a post on LinkedIn (with optional image).
 * Returns the post URN.
 */
export async function createLinkedInPost(opts: LinkedInPostOptions): Promise<string> {
  const body: any = {
    author: `urn:li:person:${opts.personUrn}`,
    commentary: opts.text,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
  };

  // Attach image if provided
  if (opts.imageUrn) {
    body.content = {
      media: {
        id: opts.imageUrn,
      },
    };
  }

  const res = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
      "LinkedIn-Version": LINKEDIN_API_VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LinkedIn post creation failed: ${res.status} ${text}`);
  }

  // The post ID is in the x-restli-id header
  const postId = res.headers.get("x-restli-id") ?? "unknown";
  return postId;
}

/* ------------------------------------------------------------------ */
/*  Validation                                                         */
/* ------------------------------------------------------------------ */

export function isLinkedInConfigured(): boolean {
  return !!(LINKEDIN_CLIENT_ID && LINKEDIN_CLIENT_SECRET);
}
