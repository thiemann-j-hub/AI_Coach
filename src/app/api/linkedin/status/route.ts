import { NextRequest, NextResponse } from "next/server";
import { isLinkedInConfigured } from "@/lib/linkedin";
import { verifyAuthToken } from "@/lib/api-auth";
import { getLinkedInConnection } from "@/lib/server/linkedin-connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Status-Check für die LinkedIn-Card: ist die Integration konfiguriert und
 * besteht für den angemeldeten User eine Verbindung (Firestore, LI-E3)?
 * Auth ist optional — ohne gültigen Token wird nur `configured` geliefert,
 * `expired: true` signalisiert der Card den Reconnect-Hinweis.
 */
export async function GET(req: NextRequest) {
  const configured = isLinkedInConfigured();
  let connected = false;
  let expired = false;
  let name: string | null = null;

  if (configured) {
    const decoded = await verifyAuthToken(req);
    if (decoded) {
      const connection = await getLinkedInConnection(decoded.uid).catch(() => null);
      if (connection) {
        expired = connection.expired;
        connected = !connection.expired;
        name = connection.name || null;
      }
    }
  }

  return NextResponse.json({ configured, connected, expired, name });
}
