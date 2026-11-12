import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { coachLiveEnabledFor, simulationEnabled } from "@/lib/simulation/flags";
import { publicScenario, publicScenarios } from "@/lib/simulation/scenarios";
import { listScenariosForUser } from "@/lib/server/scenario-store";
import { weakestObservedSkill, type SkillRatingLike } from "@/lib/simulation/empfehlung";
import { bestByScenario, type PlayedInfo } from "@/lib/simulation/katalog";
import { queryItems, runsContainer } from "@/lib/cosmos";
import { SIM_DOC_TYPE, listSimulations, simPartitionKey } from "@/lib/server/simulation-store";
import { aufraeumenAnstossen } from "@/lib/server/aufraeumen";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Die eigenen abgeschlossenen Läufe liegen in einer Partition: beide Abfragen unten sind partitions-lokal. */
function finishedParams(uid: string) {
  return [
    { name: "@pk", value: simPartitionKey(uid) },
    { name: "@dt", value: SIM_DOC_TYPE },
    { name: "@st", value: "finished" },
  ];
}

/** U15 (12.11.2026): jüngste Rollenspiel-Auswertung — nur Szenario, Rubrik und Schlüssel des „Größten Hebels“. */
async function latestEvaluation(
  uid: string
): Promise<{ scenarioId?: string; rubric?: unknown; nextStepKey?: unknown } | null> {
  const rows = await queryItems<{ scenarioId?: string; rubric?: unknown; nextStepKey?: unknown }>(
    runsContainer(),
    "SELECT TOP 1 c.scenarioId, c.feedbackJson.rubric AS rubric, c.feedbackJson.nextStepKey AS nextStepKey FROM c WHERE c.sessionId = @pk AND c.docType = @dt AND c.status = @st ORDER BY c.createdAt DESC",
    finishedParams(uid)
  );
  return rows[0] ?? null;
}

/** U21 (12.11.2026): Szenario und Gesamtwert aller abgeschlossenen Läufe — ohne die Gespräche zu laden. */
async function finishedResults(uid: string): Promise<Array<{ scenarioId?: string; overall?: number | null }>> {
  return queryItems<{ scenarioId?: string; overall?: number | null }>(
    runsContainer(),
    "SELECT c.scenarioId, c.debriefJson.overall AS overall FROM c WHERE c.sessionId = @pk AND c.docType = @dt AND c.status = @st",
    finishedParams(uid)
  );
}

/**
 * GET: Szenario-Katalog (öffentliche Projektion) + letzte Simulationen des Users
 * + Einstiegs-Insight (COACH-UX-BLUEPRINT §3/W1-4, seit U15 aus den Fähigkeiten): schwächste beobachtete
 *   Fähigkeit der jüngsten eigenen Rollenspiel-Auswertung, dazu deren Szenario (steht in der Empfehlung nicht zuerst)
 * + `played` (U21): bestes Ergebnis je Szenario aus den eigenen abgeschlossenen Läufen.
 * + `liveAvailable` je Szenario (Paket 4, 12.11.2026): Das Briefing bietet „Sprechen“ nur an, wo das Live-Gespräch geht.
 * Fail-soft: ohne Insight bleibt der Einstieg Cold Start, ohne `played` fehlt nur das Zeichen an der Karte.
 */
export async function GET(req: NextRequest) {
  if (!simulationEnabled()) {
    return NextResponse.json(
      { ok: false, code: "SIMULATION_DISABLED" },
      { status: 503 }
    );
  }
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const recent = await listSimulations(auth.uid, 10);

    let insight: { skill: string; label: string | null; scenarioId: string | null } | null = null;
    let played: Record<string, PlayedInfo> = {};
    const [latest, results] = await Promise.allSettled([latestEvaluation(auth.uid), finishedResults(auth.uid)]);
    if (latest.status === "fulfilled") {
      const ev = latest.value;
      const weakest = ev
        ? weakestObservedSkill(
            ev.rubric as SkillRatingLike[] | null,
            typeof ev.nextStepKey === "string" ? ev.nextStepKey : null
          )
        : null;
      if (ev && weakest) {
        insight = {
          skill: weakest.key,
          label: weakest.label,
          scenarioId: typeof ev.scenarioId === "string" ? ev.scenarioId : null,
        };
      }
    } else {
      // Insight ist Komfort, nie Blocker — Einstieg degradiert auf Cold Start.
      logger.apiError("/api/simulation/scenarios insight", latest.reason);
    }
    if (results.status === "fulfilled") played = bestByScenario(results.value);
    else logger.apiError("/api/simulation/scenarios played", results.reason);

    // B3a: Workspace-Szenarien des Mandanten hinter den Katalog hängen —
    // dieselbe Anti-Leak-Projektion (publicScenario), fail-soft leere Liste.
    const workspaceScenarios = (await listScenariosForUser(auth.uid, auth.oid)).map(publicScenario);
    // Paket 2, C19 (12.11.2026): höchstens einmal pro Stunde abgelaufene private Szenarien und alte abgebrochene
    // Läufe aller Personen wegräumen; läuft neben der Antwort.
    aufraeumenAnstossen();
    return NextResponse.json({
      ok: true,
      scenarios: [...publicScenarios(), ...workspaceScenarios].map((s) => ({ ...s, liveAvailable: coachLiveEnabledFor(s.id) })),
      recent,
      insight,
      played,
    });
  } catch (err) {
    logger.apiError("/api/simulation/scenarios", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
