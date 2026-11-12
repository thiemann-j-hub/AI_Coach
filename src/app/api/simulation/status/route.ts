import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { simulationEnabled } from "@/lib/simulation/flags";
import { getSimulation } from "@/lib/server/simulation-store";
import { cleanupStaleFinish, finishIsStale, typicalFinishMs } from "@/lib/server/simulation-finish-job";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET ?simId= — Stand der Auswertung (Paket 3, C4 / U12, 12.11.2026). Leichte Abfrage: Die Auswertungsseite ruft
 * sie alle 2 s, solange der Lauf auf `finishing` steht (Ownership steckt im Partition-Read).
 *
 * Antwort `{ ok, status, finishError, startedAt, typicalMs }`:
 *   `status`      `active` | `finishing` | `finished` | `aborted`
 *   `finishError` letzter Fehlschlag `{ code, requestId, at }` oder null; `code` = Fehlerart der KI oder `STALE`
 *   `startedAt`   Beginn der laufenden Rechnung (`finishing.since`), sonst null
 *   `typicalMs`   erwartete Dauer — der Wert kommt vom Server, die Seite rät nicht
 *
 * Aufräumen: Hängt ein Lauf länger als 6 Minuten in `finishing` (Neustart des Servers mitten in der Rechnung),
 * stellt diese Route ihn zurück: Rückbuchung, `active`, `finishError.code = "STALE"`.
 */
export async function GET(req: NextRequest) {
  if (!simulationEnabled()) {
    return NextResponse.json({ ok: false, code: "SIMULATION_DISABLED" }, { status: 503 });
  }
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const simId = req.nextUrl.searchParams.get("simId") ?? "";
  if (!/^[A-Za-z0-9-]{8,64}$/.test(simId)) {
    return NextResponse.json({ ok: false, code: "BAD_SIM_ID" }, { status: 400 });
  }

  try {
    let doc = await getSimulation(auth.uid, simId);
    if (!doc) {
      return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
    }
    if (finishIsStale(doc)) doc = await cleanupStaleFinish({ uid: auth.uid, oid: auth.oid, doc });
    return NextResponse.json({
      ok: true,
      status: doc.status,
      finishError: doc.finishError ?? null,
      startedAt: doc.status === "finishing" ? (doc.finishing?.since ?? null) : null,
      typicalMs: typicalFinishMs(),
    });
  } catch (err) {
    logger.apiError("/api/simulation/status", err);
    return NextResponse.json({ ok: false, error: "Internal server error", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
