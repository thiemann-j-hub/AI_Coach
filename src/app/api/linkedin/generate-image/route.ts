import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateLinkedInImage } from "@/lib/nanobanana";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({
  headline: z.string().min(1).max(200),
  topic: z.string().min(1).max(500),
});

export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  // Rate limit: 3 Bild-Generierungen pro Minute (teuerster Endpoint)
  const rlResponse = checkRateLimit(rateLimitKey(req, "li-generate-image"), 3, 60_000);
  if (rlResponse) return rlResponse;

  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { headline, topic } = parsed.data;
    const result = await generateLinkedInImage(headline, topic);

    return NextResponse.json({
      imageBase64: result.imageBase64,
      mimeType: result.mimeType,
    });
  } catch (err: any) {
    console.error("[generate-image] Error:", err?.message ?? err);
    return NextResponse.json(
      { error: "Image generation failed", message: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
