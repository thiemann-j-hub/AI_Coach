import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import {
  creditGateEnabled,
  reserveEntitlement,
  settleEntitlement,
  compensateEntitlement,
  type EntitlementGrant,
} from "@/lib/server/credits/entitlement";
import { resolveWorkspaceIdForScenarios } from "@/lib/server/scenario-store";
import { interviewBuchungsKennung, readInterview, saveInterview } from "@/lib/server/interview-store";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({ id: z.string().uuid() });

/**
 * Welle 6 — POST: Interview abschließen. 1 Credit je Interview (Point-of-Sale hier, wie die Auswertung eines
 * Rollenspiels); das Doc wird erst nach erfolgreicher Buchung „finished“. Nur die Person selbst.
 *
 * 12.11.2026: Kennung der Buchung je Versuch (`intv:<id>`, nach einer Rückbuchung `intv:<id>:<n>`), wie bei der
 * Auswertung des Rollenspiels. Vorher war die Kennung fest: Nach einem technischen Fehler mit Rückbuchung traf der
 * zweite Versuch die alte, schon erstattete Buchung wieder, und das Interview schloss ohne Credit ab.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const rl = checkRateLimit(rateLimitKey(req, "interview-finish"), 5, 60_000);
  if (rl) return rl;
  let grant: EntitlementGrant | null = null;
  let offen: { workspaceId: string; id: string; rueckbuchungen: number } | null = null;
  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
    const workspaceId = await resolveWorkspaceIdForScenarios(auth.uid, auth.oid);
    const doc = await readInterview(workspaceId, parsed.data.id);
    if (!doc || doc.uid !== auth.uid) return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
    if (doc.status === "finished") return NextResponse.json({ ok: true, already: true });
    const antworten = doc.turns.filter((t) => t.role === "person").length;
    if (antworten < 3) return NextResponse.json({ ok: false, code: "TOO_SHORT", antworten }, { status: 409 });

    if (creditGateEnabled()) {
      offen = { workspaceId, id: doc.id, rueckbuchungen: doc.chargeRefunds ?? 0 };
      const ent = await reserveEntitlement({
        uid: auth.uid,
        email: auth.email,
        runId: interviewBuchungsKennung(doc.id, doc.chargeRefunds),
      });
      if (!ent.ok) return ent.response;
      grant = ent.grant;
    }
    doc.status = "finished";
    doc.fertig = true;
    doc.finishedAt = new Date().toISOString();
    if (grant) doc.centralSpendTxId = grant.centralTxId ?? null;
    await saveInterview(doc);
    if (grant) await settleEntitlement(grant);
    logger.api("/api/interview/finish", "finished", { uid: auth.uid, id: doc.id, kursId: doc.kurs.id, antworten });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (grant) {
      const zurueck = await compensateEntitlement(grant);
      // Rückbuchung gelungen: am Interview vermerken, damit der nächste Versuch neu bucht (bestmöglich).
      if (zurueck.ok && offen) {
        try {
          const frisch = await readInterview(offen.workspaceId, offen.id);
          if (frisch && frisch.status !== "finished" && (frisch.chargeRefunds ?? 0) === offen.rueckbuchungen) {
            frisch.chargeRefunds = offen.rueckbuchungen + 1;
            await saveInterview(frisch);
          }
        } catch (e) {
          logger.apiError("/api/interview/finish", e, { id: offen.id, schritt: "rueckbuchung-vermerken" });
        }
      }
    }
    logger.apiError("/api/interview/finish", err);
    return NextResponse.json({ ok: false, code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
