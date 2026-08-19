import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { draftIdFromBrief, generateScenarioDraft } from "@/ai/flows/scenario-generator";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { checkAndConsumeBudget, estimateTokens } from "@/lib/server/cost-cap";
import {
  creditGateEnabled,
  reserveEntitlement,
  settleEntitlement,
  compensateEntitlement,
  type EntitlementGrant,
} from "@/lib/server/credits/entitlement";
import { simulationEnabled } from "@/lib/simulation/flags";
import { requireWorkspaceAdmin } from "@/lib/server/scenario-admin";
import {
  listWorkspaceScenarioDocs,
  scenarioPartitionKey,
  SCENARIO_DOC_TYPE,
  upsertWorkspaceScenario,
} from "@/lib/server/scenario-store";
import { readItem, runsContainer } from "@/lib/cosmos";
import type { ScenarioDoc } from "@/lib/server/scenario-store";
import { withRetry, timeoutMs } from "@/lib/with-timeout";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const LLM_TIMEOUT_MS = timeoutMs("BUILDER_LLM_TIMEOUT_MS", 90_000);

/** Kappe je Workspace — schützt Katalog-UX und Kosten (Owner-Stellschraube). */
const MAX_SCENARIOS_PER_WORKSPACE = 30;

const requestSchema = z.object({
  /** Pflicht (>=30 Zeichen) NUR bei Neuanlage — die Überarbeitung trägt ihren
   *  Kontext im bisherigen Entwurf (Fix 19.08.: 400 bei Revise-Runden). */
  brief: z.string().trim().max(4000).optional(),
  material: z.string().trim().max(20_000).optional(),
  category: z
    .enum(["mitarbeiterfuehrung", "zusammenarbeit", "vertrieb", "stakeholder"])
    .optional(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  locale: z.enum(["de", "en"]).optional(),
  /** Überarbeitungs-Runde: bestehende Draft-Id + Änderungswunsch. */
  reviseScenarioId: z.string().regex(/^ws-[a-z0-9-]+$/).optional(),
  reviseNote: z.string().trim().max(2000).optional(),
}).superRefine((d, ctx) => {
  if (!d.reviseScenarioId && (d.brief?.length ?? 0) < 30) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["brief"], message: "Brief (>=30 Zeichen) fehlt" });
  }
  if (d.reviseScenarioId && (d.reviseNote?.trim().length ?? 0) < 5) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reviseNote"], message: "Änderungswunsch fehlt" });
  }
});

/**
 * Welle C — POST: Szenario-Entwurf generieren (oder überarbeiten).
 * Admin-only, kostet 1 Credit je Lauf (Point-of-Sale VOR dem LLM-Call,
 * compensate bei Fehlern — gespiegelt von /api/simulation/finish).
 * Ergebnis wird IMMER als draft gespeichert; Freischaltung ist ein eigener,
 * bewusster Schritt (Review-Prinzip aus B3b).
 */
export async function POST(req: NextRequest) {
  if (!simulationEnabled()) {
    return NextResponse.json({ ok: false, code: "SIMULATION_DISABLED" }, { status: 503 });
  }
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const rl = checkRateLimit(rateLimitKey(req, "sim-builder-gen"), 4, 60_000);
  if (rl) return rl;
  const gate = await requireWorkspaceAdmin(auth);
  if (gate instanceof NextResponse) return gate;

  const chargeId = crypto.randomUUID();
  let grant: EntitlementGrant | null = null;

  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
    }
    const d = parsed.data;

    // Überarbeitung: bisherigen Entwurf laden (muss im eigenen Workspace liegen).
    let previousDraft: ScenarioDoc | null = null;
    if (d.reviseScenarioId) {
      previousDraft = await readItem<ScenarioDoc>(
        runsContainer(),
        d.reviseScenarioId,
        scenarioPartitionKey(gate.workspaceId)
      );
      if (!previousDraft || previousDraft.docType !== SCENARIO_DOC_TYPE) {
        return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
      }
    } else {
      const existing = await listWorkspaceScenarioDocs(gate.workspaceId);
      if (existing.length >= MAX_SCENARIOS_PER_WORKSPACE) {
        return NextResponse.json(
          { ok: false, code: "SCENARIO_LIMIT", max: MAX_SCENARIOS_PER_WORKSPACE },
          { status: 409 }
        );
      }
    }

    const budget = await checkAndConsumeBudget({
      uid: auth.uid,
      email: auth.email,
      estimatedTokens: estimateTokens(d.brief ?? "", d.material ?? ""),
    });
    if (!budget.allowed && budget.response) return budget.response;

    if (creditGateEnabled()) {
      const ent = await reserveEntitlement({ uid: auth.uid, email: auth.email, runId: chargeId });
      if (!ent.ok) return ent.response;
      grant = ent.grant;
    }

    const id =
      previousDraft?.id ?? draftIdFromBrief(d.brief ?? "", crypto.randomBytes(3).toString("hex"));
    const briefForRun =
      d.brief && d.brief.length >= 30
        ? d.brief
        : previousDraft
          ? `${previousDraft.scenario.title} — ${previousDraft.scenario.teaser}`
          : (d.brief ?? "");
    const scenario = await withRetry(
      () =>
        generateScenarioDraft({
          brief: briefForRun,
          id,
          sourceDocument: d.material,
          category: d.category,
          difficulty: d.difficulty,
          locale: d.locale,
          previousDraft: previousDraft?.scenario,
          reviseNote: d.reviseNote,
        }),
      { ms: LLM_TIMEOUT_MS, label: "gemini-scenario-builder", retries: 0 }
    );

    const doc = await upsertWorkspaceScenario(gate.workspaceId, scenario, {
      status: "draft",
      createdByUid: auth.uid,
    });
    if (grant) await settleEntitlement(grant);

    logger.api("/api/simulation/builder/generate", "ok", {
      uid: auth.uid,
      workspaceId: gate.workspaceId,
      scenarioId: doc.id,
      revised: Boolean(previousDraft),
    });
    return NextResponse.json({
      ok: true,
      item: { id: doc.id, status: doc.status, scenario: doc.scenario },
    });
  } catch (err) {
    if (grant) await compensateEntitlement(grant);
    logger.apiError("/api/simulation/builder/generate", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
