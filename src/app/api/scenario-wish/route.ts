import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getApiMessages } from "@/lib/server/get-request-locale";
import { runsContainer, upsertItem } from "@/lib/cosmos";
import { scenarioWishSchema } from "@/lib/scenario-wish-schema";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Szenario-Wunsch der Geister-Karte (COACH-UX-BLUEPRINT §2.3, Owner 11.08.).
 * Kein Kummerkasten, sondern Nachfrage-Statistik: Der Kategorie-Kontext wird mitgespeichert,
 * damit die Bau-Priorisierung neuer Szenarien belegt statt geraten ist.
 * Paket 6 (12.11.2026): Das Feld `weakestC` (schwächste Kompetenz C1–C10) ist entfallen; der Browser schickt es
 * seit der Empfehlung aus den Fähigkeiten (U15) nicht mehr.
 * Kein neuer Container — PK-Trick wie bei den Simulations-Docs.
 */
const requestSchema = scenarioWishSchema;

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const rl = checkRateLimit(`scenario-wish:${auth.uid}`, 5, 60_000, getApiMessages(req).rateLimited);
  if (rl) return rl;

  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const d = parsed.data;
    await upsertItem(runsContainer(), {
      id: crypto.randomUUID(),
      sessionId: `wish:${auth.uid}`,
      docType: "scenario_wish",
      uid: auth.uid,
      ts: new Date().toISOString(),
      wishText: d.wishText,
      category: d.category ?? null,
      locale: d.locale ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.apiError("/api/scenario-wish", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
