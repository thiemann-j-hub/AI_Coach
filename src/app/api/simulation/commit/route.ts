import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getApiMessages } from "@/lib/server/get-request-locale";
import { simulationEnabled } from "@/lib/simulation/flags";
import { updateSimulation } from "@/lib/server/simulation-store";
import { COMMITMENT_MAX_CHARS, type Commitment } from "@/lib/simulation/transfer";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  simId: z.string().min(8).max(64).regex(/^[A-Za-z0-9-]+$/),
  text: z.string().min(1).max(COMMITMENT_MAX_CHARS),
  /** N17 (11.10.2026): "model" = Vorschlag des Coachs unverändert übernommen, "user" = eigene Worte. */
  source: z.enum(["model", "user"]).optional(),
});

/**
 * POST: Micro-Transfer anpassen (O2). Der Debrief setzt beim Finish einen
 * Vorschlag als Vorsatz; hier überschreibt der Lernende ihn mit eigenen Worten.
 * Nur für abgeschlossene eigene Läufe; eine bereits beantwortete Nachfrage
 * bleibt bestehen (der Vorsatz danach zu ändern, verfälscht nichts — die
 * Rückmeldung bezieht sich auf den Stand zu ihrem Zeitpunkt).
 * Paket 2 (12.11.2026): C3 — der Vorsatz wird auf den frisch gelesenen Lauf angewandt (Versionsprüfung) statt
 * die alte Kopie ganz zu überschreiben; C5 — Begrenzung je Person statt je Adresse.
 */
export async function POST(req: NextRequest) {
  if (!simulationEnabled()) {
    return NextResponse.json({ ok: false, code: "SIMULATION_DISABLED" }, { status: 503 });
  }
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const rl = checkRateLimit(`sim-commit:${auth.uid}`, 30, 60_000, getApiMessages(req).rateLimited);
  if (rl) return rl;

  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
    }
    const text = parsed.data.text.trim().slice(0, COMMITMENT_MAX_CHARS);
    const source: Commitment["source"] = parsed.data.source ?? "user";
    const createdAt = new Date().toISOString();
    const doc = await updateSimulation(auth.uid, parsed.data.simId, (d) => {
      if (d.status !== "finished") return false;
      d.commitment = { text, source, createdAt, dueHint: d.commitment?.dueHint ?? null };
    });
    if (!doc) return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
    if (doc.status !== "finished") {
      return NextResponse.json({ ok: false, code: "NOT_FINISHED" }, { status: 409 });
    }
    logger.api("/api/simulation/commit", "ok", { uid: auth.uid, simId: doc.id, len: text.length });
    return NextResponse.json({ ok: true, commitment: doc.commitment });
  } catch (err) {
    logger.apiError("/api/simulation/commit", err);
    return NextResponse.json({ ok: false, error: "Internal server error", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
