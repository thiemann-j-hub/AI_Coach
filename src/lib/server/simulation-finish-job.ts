import "server-only";

import { after } from "next/server";
import type { SimulationFeedbackOutput } from "@/ai/flows/simulation-feedback";
import { CHECKIN_MAX_CHARS, generateSelfReview, type SelfReviewDebrief } from "@/ai/flows/simulation-selfreview";
import { classifyAiError } from "@/lib/ai-errors";
import { logger } from "@/lib/logger";
import { settleEntitlement, type EntitlementGrant } from "@/lib/server/credits/entitlement";
import { emitCoachMeasurement } from "@/lib/server/radar-emit";
import {
  evaluateSimulation,
  finishChargeKey,
  revertFinish,
  storeEvaluation,
} from "@/lib/server/simulation-finish";
import { getSimulation, updateSimulation, type SimulationDoc } from "@/lib/server/simulation-store";
import { coachRichter, simulationRadarEmitEnabled } from "@/lib/simulation/flags";
import type { SimulationScenario } from "@/lib/simulation/types";
import { withTimeout } from "@/lib/with-timeout";

/**
 * Auswertung als Auftrag (Paket 3, C4 / U12 / S7 / S8, 12.11.2026): alles, was NEBEN oder NACH der Antwort der
 * Routen läuft. `POST /api/simulation/finish` sichert den Anspruch, bucht und antwortet sofort; der Auftrag hier
 * rechnet, speichert und schließt ab — während die Person den Check-in beantwortet.
 *
 *   `startFinishJob`      Auftrag neben der Antwort starten (nie abwarten, wirft nie).
 *   `runFinishJob`        rechnen → speichern → Buchung abschließen; bei Fehler Rückbuchung und zurück auf `active`.
 *   `cleanupStaleFinish`  Aufräumer für hängengebliebene Läufe (GET /api/simulation/status).
 *   `runSelfReview`       Abgleich „Selbstbild und Auswertung“, sobald Auswertung UND Check-in da sind.
 *
 * Die App läuft als EIN dauerhafter Node-Prozess (Next standalone hinter server.js): `after()` hält die Aufgabe
 * nach dem Senden der Antwort am Leben. Endet der Prozess mitten in der Rechnung (Auslieferung, Absturz), bleibt
 * der Lauf auf `finishing` stehen, bis der Aufräumer ihn nach 6 Minuten zurückstellt und die Buchung zurückgibt.
 */

/** Ab diesem Alter gilt ein Lauf in `finishing` als hängengeblieben. */
export const FINISH_STALE_MS = 6 * 60_000;

/**
 * Harte Frist der Rechnung im Auftrag. Bewusst unter FINISH_STALE_MS: Ein lebender Auftrag ist fertig oder
 * gescheitert (mit eigener Rückbuchung), bevor der Aufräumer greifen kann.
 */
export const FINISH_JOB_MAX_MS = 5 * 60_000;

/** Erwartete Dauer der Auswertung für die Warteansicht: starker Richter rund 50 s, sonst rund 20 s. */
export function typicalFinishMs(env: Record<string, string | undefined> = process.env): number {
  return coachRichter(env) === "opus" ? 50_000 : 20_000;
}

/**
 * Aufgabe neben der Antwort laufen lassen. `after()` startet sie, sobald die Antwort gesendet ist. Außerhalb einer
 * Anfrage (Tests, Skripte) oder ohne `waitUntil` wirft `after()` sofort — dann läuft die Aufgabe als nicht
 * abgewartetes Promise. In beiden Fällen endet jeder Fehler im Protokoll, nie als unbehandelte Ablehnung.
 */
export function imHintergrund(label: string, task: () => Promise<void>): void {
  const sicher = async () => {
    try {
      await task();
    } catch (e) {
      logger.apiError(label, e);
    }
  };
  try {
    after(sicher);
  } catch {
    void sicher();
  }
}

// ── Check-in ─────────────────────────────────────────────────────────────────

type Checkin = NonNullable<SimulationDoc["checkin"]>;

/** PURE (getestet): Antwort säubern — gekürzt auf 400 Zeichen, leer = nicht beantwortet. */
export function checkinAntwort(text: unknown): string | null {
  const t = typeof text === "string" ? text.replace(/\s+/g, " ").trim().slice(0, CHECKIN_MAX_CHARS) : "";
  return t || null;
}

/** PURE (getestet): Gibt es etwas abzugleichen? Übersprungen oder beide Antworten leer → nein. */
export function checkinHasAnswers(c: SimulationDoc["checkin"]): c is Checkin {
  return !!c && !c.skipped && Boolean(c.gut || c.anders);
}

/**
 * PURE (getestet): Der alte Freitext `selfAssessment` aus den zwei Antworten (die Auswertungsseite zeigt ihn als
 * Zitat über dem Abgleich). Ohne Antwort null.
 */
export function checkinSelfAssessment(gut: string | null, anders: string | null): string | null {
  return [gut, anders].filter(Boolean).join(" · ") || null;
}

/**
 * Abgleich „Selbstbild und Auswertung“ (S8): kleiner zweiter KI-Schritt, sobald BEIDES da ist — die fertige
 * Auswertung und ein Check-in mit mindestens einer Antwort. Ausgelöst vom Auftrag (Check-in war schon da) oder
 * von der Check-in-Route (Auswertung war schon fertig); wer von beiden zuletzt schreibt, sieht beides und löst
 * aus — also genau einmal. Ein vorhandener Abgleich wird nie überschrieben. Scheitert der Schritt, fehlt nur
 * diese eine Karte. Wirft nie.
 */
export async function runSelfReview(a: { uid: string; simId: string }): Promise<void> {
  try {
    const doc = await getSimulation(a.uid, a.simId);
    const fb = doc?.feedbackJson as SimulationFeedbackOutput | null | undefined;
    if (!doc || doc.status !== "finished" || !checkinHasAnswers(doc.checkin) || !fb?.rubric || fb.selfReview) return;
    const selfReview = await generateSelfReview({
      gut: doc.checkin.gut,
      anders: doc.checkin.anders,
      feedback: fb,
      debrief: doc.debriefJson as SelfReviewDebrief | null | undefined,
      lang: doc.convoLocale,
    });
    await updateSimulation(a.uid, a.simId, (d) => {
      const f = d.feedbackJson as SimulationFeedbackOutput | null | undefined;
      if (d.status !== "finished" || !f || f.selfReview) return false;
      d.feedbackJson = { ...f, selfReview };
    });
    logger.api("/api/simulation/checkin", "self-review", { simId: a.simId });
  } catch (e) {
    logger.apiError("/api/simulation/checkin/self-review", e, { simId: a.simId });
  }
}

// ── Auftrag ──────────────────────────────────────────────────────────────────

export interface FinishJob {
  uid: string;
  /** Kennung der Person im Arbeitsbereich (Radar-Messpunkt, Freilauf). */
  oid?: string | null;
  simId: string;
  /** Kennung des Versuchs (`finishing.since`): Nur er darf speichern oder zurückstellen. */
  since: string;
  /** Der Lauf, wie er beim Sichern des Anspruchs stand (ab da nimmt er keine Züge mehr an). */
  doc: SimulationDoc;
  scenario: SimulationScenario;
  /** Buchung dieses Versuchs; null = Credit-Tor aus oder freier Testlauf. */
  grant: EntitlementGrant | null;
  /** Zählerstand der Rückbuchungen, zu dem die Kennung der Buchung gehört. */
  refunds: number;
  /** Entscheid 5: Dieser Versuch läuft als freier Testlauf des Szenarios. */
  free: boolean;
  /** Fehler-Nummer der Anfrage, die den Auftrag gestartet hat (steht bei einem Fehlschlag in `finishError`). */
  requestId: string;
}

/** Auftrag neben der Antwort starten. Wartet nicht und wirft nicht. */
export function startFinishJob(job: FinishJob): void {
  imHintergrund("/api/simulation/finish/job", () => runFinishJob(job));
}

/**
 * Der Auftrag. Reihenfolge:
 *   1. rechnen (`evaluateSimulation`, Richter OHNE Selbstbild), mit harter Frist;
 *   2. speichern (`storeEvaluation`): Status `finished`, Vermerk der offenen Buchung im selben Schreibvorgang weg —
 *      Persistenz VOR dem Abschluss: Credit verbraucht ⇒ Auswertung existiert;
 *   3. Buchung abschließen, Radar-Messpunkt (nur mit doppeltem Opt-in), Protokollzeile;
 *   4. Abgleich mit dem Check-in, wenn er schon da ist.
 * Fehler in 1 oder 2 → `revertFinish`: Rückbuchung (oder Freilauf zurück), zurück auf `active`, `finishError`.
 * Gehört der Anspruch beim Speichern nicht mehr diesem Versuch (abgebrochen, gelöscht), wird nichts überschrieben
 * und nur die eigene Buchung zurückgegeben. Wirft nie.
 */
export async function runFinishJob(job: FinishJob): Promise<void> {
  const { uid, oid, simId, since, scenario, grant, refunds, free } = job;
  const zurueck = (error: { code: string; requestId?: string | null } | null, freilauf = free) =>
    revertFinish({ uid, oid, simId, since, scenarioId: job.doc.scenarioId, grant, refunds, free: freilauf, error });

  let stored: SimulationDoc;
  let evaluation: Awaited<ReturnType<typeof evaluateSimulation>>;
  try {
    evaluation = await withTimeout(evaluateSimulation({ uid, doc: job.doc, scenario }), FINISH_JOB_MAX_MS, "sim-finish-job");
    const s = await storeEvaluation({ uid, simId, since, evaluation, grant, refunds, free });
    if (s.state === "refunded") throw new Error("simulation finish: Buchung dieses Versuchs wurde von anderer Stelle zurückgegeben");
    if (s.state !== "stored") {
      // Trägt der Lauf inzwischen die Auswertung eines späteren Versuchs, bleibt dessen Freilauf verbraucht; ob die
      // eigene Buchung zurückgeht, prüft die Rückbuchung selbst (nie die Buchung einer gespeicherten Auswertung).
      const ausgewertet = s.state === "ended" && s.doc.status === "finished";
      await zurueck(null, free && !ausgewertet);
      logger.api("/api/simulation/finish", "ended-elsewhere", { simId, state: s.state === "ended" ? s.doc.status : "missing" });
      return;
    }
    stored = s.doc;
  } catch (err) {
    // W1-1/W1-2: Fehlerart der KI und Fehler-Nr. — dieselben Angaben wie in der Fehlerantwort einer Route, hier am Lauf.
    const aiCode = classifyAiError(err).code;
    logger.apiError("/api/simulation/finish", err, { simId, requestId: job.requestId, aiCode });
    await zurueck({ code: aiCode, requestId: job.requestId });
    return;
  }

  // Ab hier steht die Auswertung am Lauf: Nichts, was jetzt noch scheitert, nimmt sie zurück.
  let radar: Promise<unknown> | null = null;
  try {
    if (grant) await settleEntitlement(grant);
    // Radar-Messpunkt nur mit doppeltem Opt-in (RADAR_EMIT im Emitter + SIMULATION_RADAR_EMIT hier) —
    // Owner-Entscheid offen (Blueprint §6 SIM-2). Läuft neben dem Abgleich, der Auftrag wartet am Ende darauf.
    if (grant && simulationRadarEmitEnabled()) {
      const weightByKey = new Map(scenario.assessment.competencies.map((c) => [c.key, c.weight]));
      radar = emitCoachMeasurement({
        workspaceId: grant.workspaceId,
        subjectId: oid ?? "",
        runId: stored.id,
        createdAt: stored.finishedAt ?? new Date().toISOString(),
        competencyRatings: evaluation.competencyRatings,
        // Welle 5: Anker je Fähigkeit (Stufe, Gewicht), Szenario und Urteil — Datenbasis des Team-Bilds im Hub.
        rubric: evaluation.feedback.rubric.map((r) => ({ ...r, weight: weightByKey.get(r.key) })),
        szenarioId: scenario.id,
        bestanden: evaluation.debrief.verdict === "passed" ? true : evaluation.debrief.verdict === "failed" ? false : null,
      }).catch((e) => logger.apiError("/api/simulation/finish/radar", e, { simId }));
    }
    // CP-3.2 (M9, Compliance-Blueprint 31.08.): KEINE Bewertungsdaten in den Anwendungsprotokollen —
    // uid+simId reichen zur Fehlersuche (BV § 6.4 wäre sonst durch die Log-Leserechte ausgehebelt).
    logger.api("/api/simulation/finish", "complete", { uid, simId, ...(free ? { freeTestEval: true } : {}) });
  } catch (e) {
    logger.apiError("/api/simulation/finish/abschluss", e, { simId });
  }

  if (checkinHasAnswers(stored.checkin)) await runSelfReview({ uid, simId });
  await radar;
}

// ── Aufräumer ────────────────────────────────────────────────────────────────

/** Läufe, die dieser Prozess gerade aufräumt — die Abfrage kommt alle 2 s, eine Rückbuchung kann länger dauern. */
const aufraeumer = new Set<string>();

/** PURE (getestet): Hängt der Lauf? Nur `finishing`, und nur, wenn der Versuch älter als 6 Minuten ist. */
export function finishIsStale(doc: Pick<SimulationDoc, "status" | "finishing">, now: number = Date.now()): boolean {
  if (doc.status !== "finishing" || !doc.finishing?.since) return false;
  const since = Date.parse(doc.finishing.since);
  return !Number.isFinite(since) || now - since > FINISH_STALE_MS;
}

/**
 * Hängengebliebenen Lauf zurückstellen (Neustart des Servers mitten in der Rechnung): Rückbuchung, zurück auf
 * `active`, `finishError.code = "STALE"`. Die Angaben zur Buchung stehen am Lauf (`openCharge`: Kennung,
 * Buchungsnummer, Arbeitsbereich), der Freilauf als `freeTestEval`. Eine Buchung ohne Buchungsnummer (Prozess-Ende
 * vor der Antwort des Credit-Dienstes) lässt sich nicht zurückgeben: Ihr Vermerk bleibt stehen, der nächste Versuch
 * trifft dieselbe Kennung, und `scripts/credits-abgleich.mts` listet den Lauf.
 * Gibt den Lauf zurück, wie er danach steht. Wirft nie.
 */
export async function cleanupStaleFinish(a: { uid: string; oid?: string | null; doc: SimulationDoc }): Promise<SimulationDoc> {
  const { doc } = a;
  const since = doc.finishing?.since;
  if (!since || aufraeumer.has(doc.id)) return doc;
  aufraeumer.add(doc.id);
  try {
    const refunds = doc.chargeRefunds ?? 0;
    const mark = doc.openCharge?.key === finishChargeKey(doc.id, refunds) ? doc.openCharge : null;
    const grant: EntitlementGrant | null = mark?.txId
      ? { runId: mark.key, workspaceId: mark.workspaceId ?? "", held: true, central: true, centralTxId: mark.txId }
      : null;
    const free = doc.freeTestEval === true;
    logger.warn("[finish] Auswertung hing länger als 6 Minuten – Lauf wird zurückgestellt", {
      simId: doc.id,
      since,
      buchung: grant ? "wird zurückgegeben" : mark ? "unbestätigt, Vermerk bleibt" : free ? "freier Testlauf" : "keine",
    });
    await revertFinish({ uid: a.uid, oid: a.oid, simId: doc.id, since, scenarioId: doc.scenarioId, grant, refunds, free, error: { code: "STALE" } });
    return (await getSimulation(a.uid, doc.id)) ?? doc;
  } catch (e) {
    logger.apiError("/api/simulation/status/aufraeumen", e, { simId: doc.id });
    return doc;
  } finally {
    aufraeumer.delete(doc.id);
  }
}
