// src/app/api/ready/route.ts
import { NextResponse } from "next/server";
import { readItem, usersContainer } from "@/lib/cosmos";
import { withTimeout } from "@/lib/with-timeout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Readiness-Probe: prueft die kritische externe Dependency (Cosmos DB). Ein
 * Punkt-Read auf eine garantiert nicht existierende id liefert null (404), wenn
 * Cosmos erreichbar UND der Key gueltig ist; bei Verbindungs-/Auth-Fehler wirft
 * er. So kann Azure (App-Service-Health-Check auf /api/ready) eine Instanz mit
 * toter DB aus der Rotation nehmen, statt weiter 5xx auszuliefern.
 * Oeffentlich + ungeauthet, leakt keine Secrets (nur boolesche Check-Ergebnisse).
 */
export async function GET() {
  let cosmos = false;
  try {
    await withTimeout(
      readItem(usersContainer(), "__readiness_probe__", "__readiness_probe__"),
      3_000,
      "cosmos-readiness"
    );
    cosmos = true; // 404 -> readItem gibt null zurueck (kein Wurf) => erreichbar
  } catch {
    cosmos = false;
  }

  const ready = cosmos;
  return NextResponse.json(
    { ok: ready, ready, checks: { cosmos } },
    { status: ready ? 200 : 503 }
  );
}
