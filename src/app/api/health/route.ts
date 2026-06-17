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
  return NextResponse.json({ ok: true, status: "alive" }, { status: 200 });
}
