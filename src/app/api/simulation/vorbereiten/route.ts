import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateScenarioDraft } from "@/ai/flows/scenario-generator";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { checkAndConsumeBudget, estimateTokens } from "@/lib/server/cost-cap";
import {
  creditGateEnabled,
  reserveEntitlement,
  settleEntitlement,
  compensateEntitlement,
  kiSchalterBlockt,
  type EntitlementGrant,
} from "@/lib/server/credits/entitlement";
import { coachVorbereitenOn, simulationEnabled } from "@/lib/simulation/flags";
import {
  PRIVATE_SCENARIO_PREFIX,
  deletePrivateScenario,
  listPrivateScenarioDocs,
  upsertPrivateScenario,
} from "@/lib/server/scenario-store";
import { publicScenario } from "@/lib/simulation/scenarios";
import { withRetry, timeoutMs } from "@/lib/with-timeout";
import { logger } from "@/lib/logger";
import { aiErrorResponse } from "@/lib/server/request-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const LLM_TIMEOUT_MS = timeoutMs("BUILDER_LLM_TIMEOUT_MS", 90_000);

/** Mehr als drei vorbereitete Gespräche gleichzeitig braucht niemand; schützt Kosten und Liste. */
const MAX_PRIVATE_SCENARIOS = 3;

/**
 * Welle 4 (Owner-GO 30.10.2026, N4-240): „Mein echtes Gespräch vorbereiten“.
 * Lernende (kein Admin nötig) beschreiben Anlass, Gegenüber und Ziel in je ein bis drei Sätzen. Der Generator
 * baut daraus ein privates Szenario in der Partition der Person: nicht veröffentlicht, für niemanden sonst
 * sichtbar, nach 30 Tagen verfallen. 1 Credit je Vorbereitung (Point-of-Sale vor dem Modell, compensate bei
 * Fehlern — gespiegelt vom Builder). Schutz: der Generator ersetzt Namen echter Personen und Firmen durch
 * Rollenbezeichnungen; die Oberfläche bittet, Verhalten zu beschreiben, keine Personen.
 * Rückweg: COACH_VORBEREITEN=off → 503.
 */
const requestSchema = z.object({
  anlass: z.string().trim().min(20).max(1200),
  gegenueber: z.string().trim().min(20).max(1200),
  ziel: z.string().trim().max(600).optional(),
  locale: z.enum(["de", "en"]).optional(),
});

function gate() {
  if (!simulationEnabled()) return NextResponse.json({ ok: false, code: "SIMULATION_DISABLED" }, { status: 503 });
  if (!coachVorbereitenOn()) return NextResponse.json({ ok: false, code: "VORBEREITEN_OFF" }, { status: 503 });
  return null;
}

/** GET: die eigenen vorbereiteten Gespräche (öffentliche Projektion + Verfallsdatum). */
export async function GET(req: NextRequest) {
  const blocked = gate();
  if (blocked) return blocked;
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const docs = await listPrivateScenarioDocs(auth.uid);
    return NextResponse.json({
      ok: true,
      items: docs.map((d) => ({ scenario: publicScenario(d.scenario), expiresAt: d.expiresAt, createdAt: d.createdAt })),
    });
  } catch (err) {
    logger.apiError("/api/simulation/vorbereiten GET", err);
    return NextResponse.json({ ok: false, code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const blocked = gate();
  if (blocked) return blocked;
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const rl = checkRateLimit(rateLimitKey(req, "sim-vorbereiten"), 3, 60_000);
  if (rl) return rl;
  const ki = await kiSchalterBlockt();
  if (ki) return ki;

  const chargeId = crypto.randomUUID();
  let grant: EntitlementGrant | null = null;
  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
    }
    const d = parsed.data;

    const existing = await listPrivateScenarioDocs(auth.uid);
    if (existing.length >= MAX_PRIVATE_SCENARIOS) {
      return NextResponse.json({ ok: false, code: "PRIVATE_LIMIT", max: MAX_PRIVATE_SCENARIOS }, { status: 409 });
    }

    const brief = [
      d.locale === "en" ? "OCCASION (the conversation I am preparing for):" : "ANLASS (das Gespräch, das ich vorbereite):",
      d.anlass,
      "",
      d.locale === "en" ? "THE OTHER PERSON (how they behave, what they want):" : "MEIN GEGENÜBER (wie die Person sich verhält, was sie will):",
      d.gegenueber,
      ...(d.ziel ? ["", d.locale === "en" ? "MY GOAL:" : "MEIN ZIEL:", d.ziel] : []),
    ].join("\n");

    const budget = await checkAndConsumeBudget({ uid: auth.uid, email: auth.email, estimatedTokens: estimateTokens(brief) });
    if (!budget.allowed && budget.response) return budget.response;

    if (creditGateEnabled()) {
      const ent = await reserveEntitlement({ uid: auth.uid, email: auth.email, runId: chargeId });
      if (!ent.ok) return ent.response;
      grant = ent.grant;
    }

    const id = `${PRIVATE_SCENARIO_PREFIX}${crypto.randomBytes(4).toString("hex")}`;
    const scenario = await withRetry(
      () => generateScenarioDraft({ brief, id, locale: d.locale, difficulty: 2, privat: true }),
      { ms: LLM_TIMEOUT_MS, label: "gemini-scenario-vorbereiten", retries: 0 }
    );
    const doc = await upsertPrivateScenario(auth.uid, scenario, {
      eingabe: { anlass: d.anlass, gegenueber: d.gegenueber, ...(d.ziel ? { ziel: d.ziel } : {}) },
    });
    if (grant) await settleEntitlement(grant);

    logger.api("/api/simulation/vorbereiten", "ok", { uid: auth.uid, scenarioId: doc.id });
    return NextResponse.json({ ok: true, scenario: publicScenario(doc.scenario), expiresAt: doc.expiresAt });
  } catch (err) {
    if (grant) await compensateEntitlement(grant);
    return aiErrorResponse(err, req, "/api/simulation/vorbereiten");
  }
}

const deleteSchema = z.object({ id: z.string().regex(/^ws-mein-[a-z0-9-]+$/) });

export async function DELETE(req: NextRequest) {
  const blocked = gate();
  if (blocked) return blocked;
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const parsed = deleteSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
    const deleted = await deletePrivateScenario(auth.uid, parsed.data.id);
    return NextResponse.json({ ok: true, deleted });
  } catch (err) {
    logger.apiError("/api/simulation/vorbereiten DELETE", err);
    return NextResponse.json({ ok: false, code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
