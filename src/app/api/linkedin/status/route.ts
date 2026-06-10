import { NextRequest, NextResponse } from "next/server";
import { isLinkedInConfigured } from "@/lib/linkedin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Leichter Status-Check für die LinkedIn-Card: ist die Integration
 * konfiguriert und besteht eine Verbindung (Token-Cookie)?
 * Bewusst ohne Auth — liefert nur zwei unkritische Booleans.
 */
export async function GET(req: NextRequest) {
  return NextResponse.json({
    configured: isLinkedInConfigured(),
    connected: !!req.cookies.get("linkedin_access_token")?.value,
  });
}
