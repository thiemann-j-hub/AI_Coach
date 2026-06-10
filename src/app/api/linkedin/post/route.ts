import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { uploadImageToLinkedIn, createLinkedInPost } from "@/lib/linkedin";

export const runtime = "nodejs";
export const maxDuration = 30;

const schema = z.object({
  text: z.string().min(1).max(3000),
  imageBase64: z.string().optional(),
  imageMimeType: z.string().default("image/png"),
});

export async function POST(req: NextRequest) {
  try {
    // Get LinkedIn credentials from cookies
    const accessToken = req.cookies.get("linkedin_access_token")?.value;
    const personUrn = req.cookies.get("linkedin_person_urn")?.value;

    if (!accessToken || !personUrn) {
      return NextResponse.json(
        { error: "Not connected to LinkedIn. Please authorize first." },
        { status: 401 }
      );
    }

    const body = await req.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { text, imageBase64, imageMimeType } = parsed.data;

    let imageUrn: string | undefined;

    // Upload image to LinkedIn if provided
    if (imageBase64) {
      const imageBuffer = Buffer.from(imageBase64, "base64");
      imageUrn = await uploadImageToLinkedIn(
        accessToken,
        personUrn,
        imageBuffer,
        imageMimeType
      );
    }

    // Create the post
    const postId = await createLinkedInPost({
      accessToken,
      personUrn,
      text,
      imageUrn,
    });

    return NextResponse.json({
      success: true,
      postId,
      postUrl: `https://www.linkedin.com/feed/update/${postId}`,
    });
  } catch (err: any) {
    console.error("[linkedin-post] Error:", err?.message ?? err);

    // Check if token expired
    if (err?.message?.includes("401") || err?.message?.includes("Unauthorized")) {
      return NextResponse.json(
        { error: "LinkedIn token expired. Please reconnect.", tokenExpired: true },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: "Failed to post to LinkedIn", message: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
