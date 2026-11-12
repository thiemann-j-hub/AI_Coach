import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { simulationEnabled } from "@/lib/simulation/flags";
import { getScenario } from "@/lib/simulation/scenarios";
import { getScenarioForUser, listScenariosForUser } from "@/lib/server/scenario-store";
import { listSimulations } from "@/lib/server/simulation-store";
import { aufraeumenAnstossen } from "@/lib/server/aufraeumen";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET ?limit= — Simulations-Historie fürs gemeinsame Verlaufs-Dashboard
 * (COACH-UX-BLUEPRINT §3/W1-6). Szenario-Titel wird serverseitig gejoint,
 * damit der Client keinen Katalog laden muss.
 */
export async function GET(req: NextRequest) {
  if (!simulationEnabled()) {
    return NextResponse.json(
      { ok: false, code: "SIMULATION_DISABLED" },
      { status: 503 }
    );
  }
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.trunc(rawLimit))) : 50;

  try {
    // B3a: Titel auch für Workspace-Szenarien auflösen (fail-soft).
    const wsById = new Map((await listScenariosForUser(auth.uid, auth.oid)).map((w) => [w.id, w]));
    const sims = await listSimulations(auth.uid, limit);
    // Go-Live-Prüfung 12.11.2026: Entwürfe aus dem Builder stehen nicht im Katalog. Ihr Titel wird einzeln
    // nachgeschlagen (höchstens zehn, fail-soft); vorher stand im Verlauf die Kennung `ws-…` statt des Titels.
    const offen = [...new Set(sims.map((r) => r.scenarioId))].filter((id) => id.startsWith("ws-") && !wsById.has(id)).slice(0, 10);
    const nach = await Promise.all(offen.map((id) => getScenarioForUser(auth.uid, id, auth.oid).catch(() => null)));
    offen.forEach((id, i) => {
      const s = nach[i];
      if (s) wsById.set(id, s);
    });
    const items = sims.map((r) => {
      const s = getScenario(r.scenarioId) ?? wsById.get(r.scenarioId);
      return {
        ...r,
        scenarioTitle: s?.title ?? r.scenarioId,
        personaName: s?.persona.name ?? null,
      };
    });
    // Paket 2, C19 (12.11.2026): höchstens einmal pro Stunde abgelaufene private Szenarien und alte abgebrochene
    // Läufe aller Personen wegräumen; läuft neben der Antwort.
    aufraeumenAnstossen();
    return NextResponse.json({ ok: true, items });
  } catch (err) {
    logger.apiError("/api/simulation/list", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
