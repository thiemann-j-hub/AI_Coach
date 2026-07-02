import "server-only";

import { Container, CosmosClient } from "@azure/cosmos";
import { logger } from "@/lib/logger";
import {
  buildCoachMeasurementDoc,
  coachMeasurementDocId,
} from "@/lib/radar-contract";

/**
 * Radar-Emitter (Coach → Plattform-DB) — schreibt measurement-Events fuer den
 * Laengsschnitt („Privates Radar", Wirbelsäule V6 Kap. 6) in den Container
 * `radar-events` (pk /workspaceId) der zentralen Plattform-DB `pulsecraft`.
 * SSOT des Vertrags: Hub `src/lib/plug/radar.ts` (gespiegelt in
 * @/lib/radar-contract).
 *
 * FAIL-SOFT BY DESIGN: kein Fachpfad (Analyse/Loeschen) darf je an Radar
 * scheitern — Fehler werden geloggt und geschluckt, nie geworfen.
 *
 * FLAG-GATED: `RADAR_EMIT=on` aktiviert das Schreiben; Default = No-Op
 * ({skipped}) → das Feature bleibt INERT bis zum Cutover. Das LOESCHEN ist
 * bewusst NICHT flag-gated (Nutzer-Loeschrecht gilt unabhaengig davon, ob
 * gerade emittiert wird — Docs koennen aus Emit- ODER Backfill-Phase stammen).
 *
 * EIGENER lazy Cosmos-Client (Muster @/lib/cosmos): gleicher Account
 * (COSMOS_ENDPOINT/COSMOS_KEY gelten account-weit fuer pulsecraft-prod-cosmos),
 * aber DB `pulsecraft` (env RADAR_DATABASE) statt der Coach-DB `coach` —
 * deshalb NICHT der Client aus @/lib/cosmos.
 */

export function radarEmitEnabled(): boolean {
  return (process.env.RADAR_EMIT ?? "off").toLowerCase() === "on";
}

let client: CosmosClient | null = null;

function radarEventsContainer(): Container {
  if (!client) {
    const endpoint = process.env.COSMOS_ENDPOINT;
    const key = process.env.COSMOS_KEY;
    if (!endpoint || !key) {
      throw new Error("COSMOS_ENDPOINT / COSMOS_KEY sind nicht gesetzt.");
    }
    client = new CosmosClient({ endpoint, key });
  }
  return client
    .database(process.env.RADAR_DATABASE ?? "pulsecraft")
    .container("radar-events");
}

/** Minimaler Container-Ausschnitt, den der Emitter braucht (Test-Fake-faehig). */
export type RadarContainerLike = {
  items: { upsert: (doc: unknown) => Promise<unknown> };
  item: (id: string, partitionKey: string) => { delete: () => Promise<unknown> };
};

/** Test-Seam (Muster entra-token-store.io): Tests ersetzen io.container. */
export const io: { container: () => RadarContainerLike } = {
  container: () => radarEventsContainer(),
};

export type RadarEmitResult =
  | { ok: true; skipped: true; reason: "flag_off" | "invalid_input" | "no_observable_metrics" }
  | { ok: true; skipped: false }
  | { ok: false };

/**
 * Emittiert die MESSUNG eines Coach-Runs (idempotenter Upsert auf
 * `coach:${runId}`). GELOCKT: `createdAt` MUSS runDoc.createdAt sein (nie
 * Date.now); 0/null-Scores werden zu null gemappt; overall = Mittel der
 * beobachtbaren Werte (@/lib/radar-contract). Fail-soft: wirft NIE.
 */
export async function emitCoachMeasurement(args: {
  workspaceId: string;
  subjectId: string;
  runId: string;
  /** IMMER runDoc.createdAt (ISO-8601) — NIE Date.now() (Zeitstabilitaet). */
  createdAt: string;
  competencyRatings: unknown;
}): Promise<RadarEmitResult> {
  if (!radarEmitEnabled()) return { ok: true, skipped: true, reason: "flag_off" };
  try {
    if (!args.workspaceId || !args.subjectId || !args.runId || !args.createdAt) {
      // Sichtbar machen (kein stilles Datenloch), aber Fachpfad nie stoeren.
      logger.apiError("radar/emit", new Error("missing envelope field"), {
        runId: args.runId,
        hasWorkspace: !!args.workspaceId,
        hasSubject: !!args.subjectId,
        hasCreatedAt: !!args.createdAt,
      });
      return { ok: true, skipped: true, reason: "invalid_input" };
    }
    const doc = buildCoachMeasurementDoc(args);
    if (!doc) {
      // Kein beobachtbarer Wert in diesem Lauf → bewusst KEIN Event
      // (Leer-Events verzerren nichts, tragen aber auch nichts).
      return { ok: true, skipped: true, reason: "no_observable_metrics" };
    }
    await io.container().items.upsert(doc);
    logger.api("radar/emit", "measurement-upserted", {
      runId: args.runId,
      workspaceId: args.workspaceId,
    });
    return { ok: true, skipped: false };
  } catch (e) {
    logger.apiError("radar/emit", e, { runId: args.runId });
    return { ok: false };
  }
}

/**
 * Analyse löschen = auch Messpunkt löschen (Nutzer-Löschrecht schlägt
 * append-only). Wird IMMER versucht (unabhaengig vom RADAR_EMIT-Flag), denn
 * das Doc kann aus der Emit- ODER der Backfill-Phase existieren — ein 404 ist
 * der Normalfall und ok. Mehrere Kandidaten-Partitionen, weil Emit-Pfad
 * (grant.workspaceId) und Backfill (Owner-oid) unterschiedliche pk-Werte
 * geschrieben haben koennen. Fail-soft: wirft NIE.
 */
export async function deleteCoachMeasurement(
  runId: string,
  workspaceIdCandidates: Array<string | null | undefined>
): Promise<{ deleted: number }> {
  const candidates = [
    ...new Set(
      workspaceIdCandidates.filter(
        (w): w is string => typeof w === "string" && w.length > 0
      )
    ),
  ];
  let deleted = 0;
  for (const workspaceId of candidates) {
    try {
      await io.container().item(coachMeasurementDocId(runId), workspaceId).delete();
      deleted++;
      logger.api("radar/delete", "measurement-deleted", { runId, workspaceId });
    } catch (e) {
      if ((e as { code?: number })?.code === 404) continue; // kein Messpunkt hier — ok
      logger.apiError("radar/delete", e, { runId, workspaceId });
    }
  }
  return { deleted };
}
