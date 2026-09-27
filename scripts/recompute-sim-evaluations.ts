/**
 * Alt-Läufe nachrechnen (Blueprint COACH-OPTIMIERUNG 27.09.2026, O1b / N4-84).
 *
 *   npm run sim:recompute -- --ids <simId>[,<simId>…]          # Vorschau
 *   npm run sim:recompute -- --ids … --apply                   # schreibt Doc + Radar
 *   npm run sim:recompute -- --withheld --since=2026-08-01     # alle Läufe mit zurückgehaltenen Scores
 *
 * Läuft dieselbe Pipeline wie /api/simulation/finish erneut über die gespeicherten
 * Beiträge (Debrief + C1–C10 + Gate mit rohen Beiträgen + deterministische
 * Gesamtwertung). Grund: Das Gate hatte bis 27.09. wörtliche Belege verworfen
 * (Präfix „Teilnehmer:in:“) — die zurückgehaltenen Rubrik-Scores sind im Doc
 * überschrieben, nur ein erneuter Lauf stellt sie wieder her. Kein Credit.
 * Radar: der Messpunkt `coach:<simId>` wird mit denselben Hüllfeldern
 * (workspaceId, subjectId aus dem bestehenden Messpunkt) neu geschrieben.
 * Owner 27.09.: Alt-Läufe sind kleine Tests — Nachrechnen ja, Schlüsse nein.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { CosmosClient } from "@azure/cosmos";
import { runsContainer } from "../src/lib/cosmos";
import { getScenario } from "../src/lib/simulation/scenarios";
import { getScenarioForUser, scenarioPartitionKey } from "../src/lib/server/scenario-store";
import { readItem } from "../src/lib/cosmos";
import type { SimulationScenario } from "../src/lib/simulation/types";
import { assembleTranscript, type SimulationDoc } from "../src/lib/server/simulation-store";
import { generateSimulationFeedback } from "../src/ai/flows/simulation-feedback";
import { scoreCompetencies } from "../src/ai/flows/score-competencies";
import { normalizeCompetencyRatings } from "../src/lib/competency-model";
import { collectQualityNotes, type QualityNote } from "../src/lib/quality-core";
import { CHECK_PASS_THRESHOLD, computeDebrief } from "../src/lib/simulation/debrief";
import { emitCoachMeasurement } from "../src/lib/server/radar-emit";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const ids = (args.find((a) => a.startsWith("--ids="))?.split("=")[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const withheldMode = args.includes("--withheld");
const since = args.find((a) => a.startsWith("--since="))?.split("=")[1] ?? "2026-01-01";

async function loadDocs(): Promise<SimulationDoc[]> {
  const c = runsContainer();
  if (ids.length) {
    const { resources } = await c.items
      .query<SimulationDoc>({ query: "SELECT * FROM c WHERE c.docType = 'simulation' AND ARRAY_CONTAINS(@ids, c.id)", parameters: [{ name: "@ids", value: ids }] })
      .fetchAll();
    return resources;
  }
  if (withheldMode) {
    const { resources } = await c.items
      .query<SimulationDoc>({
        query: "SELECT * FROM c WHERE c.docType = 'simulation' AND c.status = 'finished' AND c.finishedAt >= @since AND ARRAY_CONTAINS(c.qualityNotes, { code: 'EVIDENCE_ALL_UNGROUNDED' }, true)",
        parameters: [{ name: "@since", value: since }],
      })
      .fetchAll();
    return resources;
  }
  throw new Error("Auswahl fehlt: --ids <a,b> oder --withheld [--since=YYYY-MM-DD]");
}

async function radarEnvelope(runId: string, workspaceId: string | undefined): Promise<{ subjectId: string } | null> {
  if (!workspaceId) return null;
  try {
    const client = new CosmosClient({ endpoint: process.env.COSMOS_ENDPOINT!, key: process.env.COSMOS_KEY! });
    const { resource } = await client
      .database(process.env.RADAR_DATABASE ?? "pulsecraft")
      .container("radar-events")
      .item(`coach:${runId}`, workspaceId)
      .read<{ subjectId?: string }>();
    return resource?.subjectId ? { subjectId: resource.subjectId } : null;
  } catch {
    return null;
  }
}

async function main() {
  const docs = await loadDocs();
  console.log(`── Nachrechnen: ${docs.length} Lauf/Läufe${apply ? " [APPLY]" : " [Vorschau]"} ──`);
  for (const doc of docs) {
    // Workspace-Szenarien: direkt über die im Lauf gespeicherte workspaceId lesen
    // (die Mitgliedschaft des Nutzers ist offline nicht auflösbar).
    const wsDoc = doc.workspaceId
      ? await readItem<{ scenario?: SimulationScenario }>(runsContainer(), doc.scenarioId, scenarioPartitionKey(doc.workspaceId)).catch(() => null)
      : null;
    const scenario = getScenario(doc.scenarioId) ?? wsDoc?.scenario ?? (await getScenarioForUser(doc.uid, doc.scenarioId, null));
    if (!scenario) {
      console.log(`SKIP ${doc.id.slice(0, 8)} — Szenario ${doc.scenarioId} nicht auflösbar`);
      continue;
    }
    const before = doc.debriefJson as { overall?: number | null; verdict?: string } | null;
    const beforeWithheld = (doc.qualityNotes as QualityNote[] | undefined)?.filter((n) => n.code === "EVIDENCE_ALL_UNGROUNDED").map((n) => n.field) ?? [];

    const transcript = assembleTranscript(doc.turns, scenario.persona.name);
    const [feedback, comp] = await Promise.all([
      generateSimulationFeedback({ scenario, turns: doc.turns, focus: doc.focus ?? undefined, convoLocale: doc.convoLocale ?? undefined, selfAssessment: doc.selfAssessment ?? undefined }),
      scoreCompetencies({ transcriptText: transcript, lang: doc.convoLocale ?? "de", leaderLabel: "Teilnehmer:in", employeeLabel: scenario.persona.name, scenarioCategory: scenario.category } as any),
    ]);
    let ratings = normalizeCompetencyRatings(comp, { lang: doc.convoLocale ?? "de", leaderLabel: "Teilnehmer:in", employeeLabel: scenario.persona.name });
    const rubricForCheck = feedback.rubric.map((r) => ({ id: r.key, score: r.score, evidence: r.evidence ?? [] }));
    const notes = collectQualityNotes({ summary: feedback.summary, competency_ratings: [...(ratings as any[]), ...rubricForCheck] }, doc.turns.map((t) => t.text).join("\n"));
    const fabricated = new Set(notes.filter((n) => n.severity === "error" && n.field).map((n) => n.field as string));
    const heldWhy = doc.convoLocale === "en" ? "evidence not verifiable in transcript — score withheld (quality gate)" : "Belege nicht im Transkript verifizierbar — Score zurückgehalten (Qualitäts-Gate)";
    if (fabricated.size) {
      ratings = ratings.map((c) => (fabricated.has(c.id) ? { ...c, score: null, evidence: [], why: heldWhy } : c));
      feedback.rubric = feedback.rubric.map((r) => (fabricated.has(r.key) ? { ...r, score: null, evidence: [], why: heldWhy } : r));
    }
    const weightByKey = new Map(scenario.assessment.competencies.map((c) => [c.key, c.weight]));
    const passThreshold = doc.mode === "check" ? (scenario.assessment.checkPassThreshold ?? CHECK_PASS_THRESHOLD) : scenario.assessment.passThreshold;
    const debrief = computeDebrief({
      rubric: feedback.rubric.map((r) => ({ key: r.key, label: r.label, score: r.score, weight: weightByKey.get(r.key) })),
      checkpoints: feedback.checkpoints.map((c) => ({ id: c.id, hit: c.hit })),
      passThreshold,
    });
    console.log(
      `${doc.id.slice(0, 8)} ${doc.scenarioId} ${String(doc.finishedAt ?? doc.createdAt).slice(0, 10)} — vorher ${before?.overall ?? "–"} % ${before?.verdict ?? "–"} (zurückgehalten ${beforeWithheld.join(",") || "–"}) → nachher ${debrief.overall ?? "–"} % ${debrief.verdict} (zurückgehalten ${[...fabricated].join(",") || "–"}) · Rubrik ${feedback.rubric.map((r) => `${r.key}=${r.score ?? "∅"}`).join(" ")}`
    );
    if (!apply) continue;

    const recomputedAt = new Date().toISOString();
    const updated: SimulationDoc & { recomputedAt?: string; recomputeNote?: string } = {
      ...doc,
      feedbackJson: feedback,
      competencyRatings: ratings,
      competencyError: null,
      debriefJson: debrief,
      qualityNotes: notes,
      updatedAt: recomputedAt,
      recomputedAt,
      recomputeNote: "Gate-Korrektur N4-84 (27.09.2026): Auswertung mit korrigiertem Beleg-Vergleich neu berechnet.",
    };
    if (feedback.microTransfer?.step && !doc.commitment) {
      updated.commitment = { text: feedback.microTransfer.step, source: "model", createdAt: recomputedAt, dueHint: feedback.microTransfer.when || null };
    }
    await runsContainer().items.upsert(updated);
    const env = await radarEnvelope(doc.id, doc.workspaceId);
    if (env) {
      process.env.RADAR_EMIT = "on";
      const r = await emitCoachMeasurement({ workspaceId: doc.workspaceId!, subjectId: env.subjectId, runId: doc.id, createdAt: doc.finishedAt ?? doc.createdAt, competencyRatings: ratings });
      console.log(`     Radar: ${JSON.stringify(r)}`);
    } else {
      console.log("     Radar: kein bestehender Messpunkt — nicht neu geschrieben");
    }
  }
}

main().catch((e) => {
  console.error("recompute FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
