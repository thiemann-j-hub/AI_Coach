// src/app/api/runs/delete/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { deleteRun, getOwnRun, sessionAccess } from "@/lib/server/runs-store";
import { creditsCentralEnabled, centralRefund } from "@/lib/server/credits/credit-service";
import { rueckbuchenMitVermerk, vermerkAnlegen, vermerkAustragen } from "@/lib/server/credits/buchungsvermerk";
import { refundWindowFrom } from "@/lib/refund-affordance";
import { deleteCoachMeasurement } from "@/lib/server/radar-emit";
import { getApiMessages } from "@/lib/server/get-request-locale";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  sessionId: z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/),
  runId: z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/),
});

/**
 * Analyse löschen. Seit S1 (Go-Live-Prüfung 12.11.2026) entfernt die Route das Dokument wirklich: Zusammenfassung,
 * Zitate und gespeichertes Transkript sind danach weg. Vorher blieb es mit `deleted: true` in der Datenbank liegen.
 *
 * Reihenfolge:
 *   1. Sitzung und Lauf gehören der Person (B3), sonst 403 oder 404.
 *   2. Ist eine Rückgabe fällig (Bezahlsystem an, Lauf jünger als 10 Minuten, Buchungsnummer am Lauf), steht VOR dem
 *      Löschen ein Vermerk ohne Inhalte (Lauf-Kennung, Buchungsnummer, Arbeitsbereich, Person, Zeit).
 *   3. Messpunkt und Dokument löschen. Nur der Aufruf, der das Dokument selbst entfernt hat, gibt den Credit zurück:
 *      Ein zweiter Klick findet nichts mehr und erstattet nicht noch einmal.
 *   4. Rückgabe gelungen: Vermerk weg. Gescheitert: Die Analyse bleibt gelöscht, der Vermerk bleibt stehen und
 *      `scripts/credits-abgleich.mts` listet ihn. Einen Nachlauf, der die Rückgabe von selbst nachholt, gibt es nicht.
 * Die Rückgabe selbst (Fenster, Betrag, Schlüssel `refund:<runId>`) ist unverändert.
 */
export async function POST(req: NextRequest) {
  const apiMsg = getApiMessages(req);

  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const { uid, oid } = authResult;

  // S4 (Go-Live-Prüfung 12.11.2026): je Person statt je Adresse.
  const rlResponse = checkRateLimit(`runs-delete:${uid}`, 20, 60_000, apiMsg.rateLimited);
  if (rlResponse) return rlResponse;

  try {
    const json = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
    }
    const { sessionId, runId } = parsed.data;

    // B3 (Go-Live-Prüfung 12.11.2026): Gelöscht wird nur mit eigenem Sitzungsdokument, und nur der eigene Lauf.
    const access = await sessionAccess(sessionId, uid);
    if (access === "foreign") {
      return NextResponse.json({ ok: false, error: apiMsg.accessDenied, code: "FORBIDDEN" }, { status: 403 });
    }
    const notFound = () => NextResponse.json({ ok: false, error: apiMsg.notFound, code: "NOT_FOUND" }, { status: 404 });
    const run = access === "own" ? await getOwnRun(sessionId, runId, uid) : null;
    if (!run) return notFound();

    // Rückgabe-Fenster (10 Min) aus der geteilten SSOT refund-affordance — dieselbe Rechnung steuert die Anzeige am
    // Löschknopf. Zurückgegeben wird zentral MIT der gespeicherten Buchungsnummer (Pflicht); ohne sie keine Rückgabe.
    // KK-1: Bei CREDITS_CENTRAL=off ist Löschen neutral (keine Rückgabe).
    const { withinWindow } = refundWindowFrom(run.createdAt, Date.now());
    const spendTxId = creditsCentralEnabled() && withinWindow ? run.centralSpendTxId : null;
    if (creditsCentralEnabled() && withinWindow && !spendTxId) {
      logger.api("/api/runs/delete", "central-refund-skipped-no-txid", { uid, sessionId, runId });
    }

    // Spur VOR dem Löschen: Endet der Prozess zwischen Löschen und Rückgabe, steht die fällige Rückgabe im Abgleich.
    const vermerk = spendTxId
      ? await vermerkAnlegen({ uid, art: "analyse-rueckgabe", kennung: runId, txId: spendTxId, workspaceId: run.workspaceId })
      : null;

    // Analyse löschen = auch Messpunkt löschen (Nutzer-Löschrecht schlägt
    // append-only): das radar-events-Doc `coach:${runId}` mit entfernen.
    // IMMER versuchen (unabhaengig vom RADAR_EMIT-Flag — das Doc kann aus der
    // Emit- ODER Backfill-Phase stammen), 404-tolerant, fail-soft (wirft nie).
    // Kandidaten-Partitionen: run.workspaceId (Emit-Pfad = zentraler Workspace
    // aus dem Grant) + eigene Entra-oid (Backfill-Altbestand des Owners).
    await deleteCoachMeasurement(runId, [run.workspaceId, oid]);

    let removed: boolean;
    try {
      removed = await deleteRun(sessionId, runId);
    } catch (e) {
      // Nicht gelöscht, also keine Rückgabe fällig: Der Vermerk wäre im Abgleich ein falscher Befund.
      await vermerkAustragen(vermerk);
      throw e;
    }
    // Das Dokument war schon weg: Ein anderer Aufruf (zweiter Klick, zweiter Tab) hat gelöscht und gibt zurück.
    // Dessen Vermerk bleibt unangetastet.
    if (!removed) return notFound();

    let refunded = false;
    if (spendTxId) {
      refunded = await rueckbuchenMitVermerk({ art: "analyse-rueckgabe", kennung: runId, vermerk }, () =>
        centralRefund({
          amount: 1,
          description: "coach:refund_user_delete",
          spendTransactionId: spendTxId,
          idempotencyKey: `refund:${runId}`,
        })
      );
    }

    logger.api("/api/runs/delete", "deleted", { uid, sessionId, runId, refunded });
    return NextResponse.json({ ok: true, deleted: true, refunded }, { status: 200 });
  } catch (err: any) {
    logger.apiError("/api/runs/delete", err);
    return NextResponse.json(
      { ok: false, error: apiMsg.internalError, code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
