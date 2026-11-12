import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { draftIdFromBrief, generateScenarioDraft } from "@/ai/flows/scenario-generator";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkAndConsumeBudget, estimateTokens } from "@/lib/server/cost-cap";
import {
  creditGateEnabled,
  reserveEntitlement,
  settleEntitlement,
  compensateEntitlement,
  type EntitlementGrant,
} from "@/lib/server/credits/entitlement";
import {
  buchenMitVermerk,
  rueckbuchenMitVermerk,
  vermerkAustragen,
  type Buchungsvermerk,
} from "@/lib/server/credits/buchungsvermerk";
import { getApiMessages } from "@/lib/server/get-request-locale";
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
import { aiErrorResponse } from "@/lib/server/request-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 200;

// 12.11.2026: 170 statt 90 Sekunden. Ein Versuch dauert live rund 55 Sekunden; scheitert der erste an Schema oder
// Regeln, braucht der zweite noch einmal so lange. Mit 90 Sekunden endete das immer in Fehler und Rückbuchung.
// Die Strecke davor trägt das: Front Door wartet 240 Sekunden, der App Service 230.
const LLM_TIMEOUT_MS = timeoutMs("BUILDER_LLM_TIMEOUT_MS", 170_000);

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
  /** Paket 5, S15: nur noch Rückfall. Die Sprache des Auftrags entscheidet (siehe `zielSprache` im Generator). */
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
 * compensate bei Fehlern). S3 (Go-Live-Prüfung 12.11.2026): mit Buchungsvermerk. Bleibt ein Credit
 * ohne Entwurf hängen, listet ihn `scripts/credits-abgleich.mts`.
 * Ergebnis wird IMMER als draft gespeichert; Freischaltung ist ein eigener,
 * bewusster Schritt (Review-Prinzip aus B3b).
 */
export async function POST(req: NextRequest) {
  if (!simulationEnabled()) {
    return NextResponse.json({ ok: false, code: "SIMULATION_DISABLED" }, { status: 503 });
  }
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  // S4 (Go-Live-Prüfung 12.11.2026): Begrenzung je Person statt je Adresse.
  const rl = checkRateLimit(`sim-builder-gen:${auth.uid}`, 4, 60_000, getApiMessages(req).rateLimited);
  if (rl) return rl;
  const gate = await requireWorkspaceAdmin(auth);
  if (gate instanceof NextResponse) return gate;

  const chargeId = crypto.randomUUID();
  let grant: EntitlementGrant | null = null;
  // S3: Spur der Buchung, bis der Entwurf gespeichert oder der Credit zurück ist (siehe buchungsvermerk.ts).
  let vermerk: Buchungsvermerk | null = null;
  // true, sobald der Entwurf gespeichert ist: Ab dann ist der Credit verbraucht und wird nicht mehr zurückgebucht.
  let gespeichert = false;

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
      const buchung = await buchenMitVermerk({ uid: auth.uid, art: "builder", kennung: chargeId }, (kennung) =>
        reserveEntitlement({ uid: auth.uid, email: auth.email, runId: kennung })
      );
      vermerk = buchung.vermerk;
      if (!buchung.ent.ok) return buchung.ent.response;
      grant = buchung.ent.grant;
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
    gespeichert = true;
    if (grant) await settleEntitlement(grant);
    await vermerkAustragen(vermerk);

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
    // Fehler nach der Buchung, bevor der Entwurf gespeichert ist: zurückbuchen. Scheitert das, bleibt der Vermerk
    // stehen und der Abgleich listet ihn.
    if (grant && !gespeichert) {
      const gebucht = grant;
      await rueckbuchenMitVermerk({ art: "builder", kennung: chargeId, vermerk }, () => compensateEntitlement(gebucht));
    }
    // W1-1/W1-2: KI-Fehlerart + Fehler-Nr. statt „Internal server error“ (Rückweg AI_ERROR_CONTRACT=off).
    return aiErrorResponse(err, req, "/api/simulation/builder/generate");
  }
}
