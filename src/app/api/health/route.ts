// src/app/api/health/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness-Probe: 200, solange der Prozess laeuft. Keine externen Dependencies
 * (bewusst), damit ein langsames Cosmos/Gemini die Liveness NICHT rot faerbt —
 * dafuer ist /api/ready zustaendig. Oeffentlich + ungeauthet (Plattform-Check).
 */
export async function GET() {
  // A3 Deploy-Provenienz: BUILD_SHA/BUILD_BRANCH/BUILD_STAMPED_AT = App-Service-
  // App-Settings (Runtime, gesetzt beim Deploy via az) → Prod-Wahrheit sichtbar.
  return NextResponse.json(
    {
      ok: true,
      status: "alive",
      // App-Setting BUILD_SHA wird vom GitHub-Deploy nicht mehr gepflegt (stand
      // auf Juli) — Fallback ist die zur Build-Zeit eingebackene SHA.
      sha:
        process.env.BUILD_SHA ??
        (process.env.NEXT_PUBLIC_BUILD_SHA ? process.env.NEXT_PUBLIC_BUILD_SHA.slice(0, 7) : "unstamped"),
      branch: process.env.BUILD_BRANCH ?? null,
      stampedAt: process.env.BUILD_STAMPED_AT ?? null,
    },
    { status: 200 }
  );
}
