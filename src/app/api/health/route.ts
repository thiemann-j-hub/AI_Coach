// src/app/api/health/route.ts
import { NextResponse } from "next/server";
import { resolveWriterModelId } from "@/ai/model-id";
import { buildStamp } from "@/lib/server/build-stamp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness-Probe: 200, solange der Prozess laeuft. Keine externen Dependencies
 * (bewusst), damit ein langsames Cosmos/Gemini die Liveness NICHT rot faerbt —
 * dafuer ist /api/ready zustaendig. Oeffentlich + ungeauthet (Plattform-Check).
 */
export async function GET() {
  // A3 Deploy-Provenienz: Stand aus dem Bau (build-stamp.ts), nicht mehr aus den App-Settings BUILD_*.
  const stamp = buildStamp();
  return NextResponse.json(
    {
      ok: true,
      status: "alive",
      sha: stamp.sha,
      branch: stamp.branch,
      stampedAt: stamp.builtAt,
      // 27.09.: Schreiber-Modell sichtbar (App-Setting GEMINI_TEXT_MODEL) — der
      // Modellwechsel ist damit ohne Credit nachweisbar.
      writerModel: resolveWriterModelId(),
    },
    { status: 200 }
  );
}
