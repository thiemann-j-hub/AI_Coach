import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runPersonaOpening } from "@/ai/flows/simulation-persona";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { checkAndConsumeBudget, estimateTokens } from "@/lib/server/cost-cap";
import { simulationEnabled } from "@/lib/simulation/flags";
import { getScenarioForUser } from "@/lib/server/scenario-store";
import { withRetry, timeoutMs } from "@/lib/with-timeout";

const LLM_TIMEOUT_MS = timeoutMs("LLM_TIMEOUT_MS", 45_000);
import {
  countFinishedForScenario,
  createSimulation,
} from "@/lib/server/simulation-store";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  scenarioId: z.string().min(1).max(100),
  /**
   * Fokus-Retry (D2): EIN Vorsatz aus dem letzten Debrief; optional.
   * Grosszuegig annehmen und serverseitig kappen — ein langer nextStep darf
   * den Retry NIE scheitern lassen (User-Test-Fund 04.08.: 340-Zeichen-Hebel
   * lief in max(300) → 400 → generischer Fehler beim Nutzer).
   */
  focus: z.string().max(2000).optional(),
  /**
   * Gesprächssprache (Synthesia-Muster, Owner-Vorgabe 04.08.): EN/ES/FR/DE.
   * Fehlt sie oder entspricht sie der Autorensprache, eröffnet die statische
   * openingLine; sonst erzeugt die Persona ihre Eröffnung in der Zielsprache.
   */
  locale: z.enum(["de", "en", "es", "fr"]).optional(),
  /** B2: Übungs- (Default) oder Prüfungsmodus. */
  mode: z.enum(["practice", "check"]).optional(),
  /** B2: Härtegrad der Persona (Default standard). */
  hardness: z.enum(["mild", "standard", "hart"]).optional(),
});

/** Harte Kappe fuer den gespeicherten Fokus (Prompt-Injektion + Doc-Groesse). */
const FOCUS_MAX_CHARS = 300;

/** POST: neue Simulation anlegen — die Persona eröffnet mit ihrer openingLine. */
export async function POST(req: NextRequest) {
  if (!simulationEnabled()) {
    return NextResponse.json(
      { ok: false, code: "SIMULATION_DISABLED" },
      { status: 503 }
    );
  }
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const rl = checkRateLimit(rateLimitKey(req, "sim-start"), 5, 60_000);
  if (rl) return rl;

  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const scenario = await getScenarioForUser(auth.uid, parsed.data.scenarioId);
    if (!scenario) {
      return NextResponse.json(
        { ok: false, code: "UNKNOWN_SCENARIO" },
        { status: 404 }
      );
    }

    // Versuchszählung fuer Historie/Delta (D2) — best effort, blockiert nie.
    let attempt = 1;
    try {
      attempt = (await countFinishedForScenario(auth.uid, scenario.id)) + 1;
    } catch {
      /* Zählung optional */
    }
    const focus = parsed.data.focus?.trim().slice(0, FOCUS_MAX_CHARS) || null;
    const convoLocale = parsed.data.locale ?? scenario.locale;
    const mode = parsed.data.mode ?? "practice";
    const hardness = parsed.data.hardness ?? "standard";

    // Eroeffnung: Autorensprache = statisch (kein LLM-Call); abweichende
    // Gesprächssprache = Persona eröffnet sinngemäß in der Zielsprache.
    let openingText = scenario.personaDna.openingLine;
    if (convoLocale !== scenario.locale) {
      const budget = await checkAndConsumeBudget({
        uid: auth.uid,
        email: auth.email,
        estimatedTokens: estimateTokens(scenario.personaDna.openingLine),
      });
      if (!budget.allowed && budget.response) return budget.response;
      openingText = await withRetry(
        () => runPersonaOpening({ scenario, convoLocale, hardness }),
        { ms: LLM_TIMEOUT_MS, label: "gemini-sim-opening", retries: 1 }
      );
    }

    const simId = crypto.randomUUID();
    const doc = await createSimulation({
      simId,
      uid: auth.uid,
      scenarioId: scenario.id,
      attempt,
      focus,
      convoLocale,
      mode,
      hardness,
      openingTurn: {
        role: "persona",
        text: openingText,
        ts: new Date().toISOString(),
      },
    });

    logger.api("/api/simulation/start", "created", {
      uid: auth.uid,
      simId,
      scenarioId: scenario.id,
      attempt,
    });
    return NextResponse.json({
      ok: true,
      simulation: {
        id: doc.id,
        scenarioId: doc.scenarioId,
        status: doc.status,
        turns: doc.turns,
        attempt,
        focus,
        mode,
        hardness,
        // W2-1: Client-Uhr rechnet ab createdAt (Server bleibt die Wahrheit).
        createdAt: doc.createdAt,
      },
    });
  } catch (err) {
    logger.apiError("/api/simulation/start", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
