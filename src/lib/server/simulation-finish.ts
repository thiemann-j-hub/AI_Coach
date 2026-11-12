import "server-only";

import { NextResponse } from "next/server";
import {
  RICHTER_OPUS_TIMEOUT_MS,
  judgeSimulation,
  type SimulationFeedbackOutput,
} from "@/ai/flows/simulation-feedback";
import { scoreCompetencies } from "@/ai/flows/score-competencies";
import { regieVerlaufText } from "@/ai/flows/simulation-regie";
import {
  defaultCompetencyRatings,
  normalizeCompetencyRatings,
} from "@/lib/competency-model";
import { logger } from "@/lib/logger";
import { computeMeasurementDelta } from "@/lib/measurement-delta";
import {
  compensateEntitlement,
  reserveEntitlement,
  type EntitlementGrant,
} from "@/lib/server/credits/entitlement";
import {
  qualityMode,
  runQualityChecks,
  type QualityNote,
} from "@/lib/server/quality-checks";
import {
  assembleTranscript,
  getSimulation,
  latestFinishedForScenario,
  latestTransferReview,
  updateSimulation,
  type SimulationDoc,
} from "@/lib/server/simulation-store";
import {
  CHECK_PASS_THRESHOLD,
  computeDebrief,
  computeDelta,
  type Debrief,
} from "@/lib/simulation/debrief";
import { coachRichter } from "@/lib/simulation/flags";
import { bestimmeErgebnis, tatsachenText } from "@/lib/simulation/tatsachen";
import { buildTransferReviewText, commitmentExplicitOn } from "@/lib/simulation/transfer";
import type { SimulationScenario } from "@/lib/simulation/types";
import { timeoutMs, withRetry, withTimeout } from "@/lib/with-timeout";

/**
 * Auswertung eines Rollenspiels: Geldweg und Rechnung (Paket 2, 12.11.2026 — C3, C4, C7, C8, C17).
 *
 * Die Route `/api/simulation/finish` ruft die vier Schritte nacheinander auf; der Umbau „Auswertung als Auftrag
 * mit Status“ (nächste Welle) kann dieselben Schritte aus einem Auftrag heraus rufen:
 *
 *   1. `chargeFinish`       Vermerk „offene Buchung“ an den Lauf, dann buchen (oder die schon bestätigte Buchung
 *                           derselben Kennung wiederverwenden).
 *   2. `evaluateSimulation` die eigentliche Auswertung — liest nur, schreibt nichts, bucht nichts.
 *   3. `storeEvaluation`    Ergebnis auf den FRISCHEN Lauf anwenden (Versionsprüfung). Ist der Lauf inzwischen
 *                           nicht mehr aktiv, wird nichts überschrieben.
 *   4. `refundFinishCharge` Rückbuchung bei Fehler oder wenn der Lauf inzwischen von anderer Stelle beendet wurde.
 *
 * Kennung der Buchung: `sim-finish:<simId>:<n>`, n = Zahl der gelungenen Rückbuchungen am Lauf. Der Credit-Dienst
 * behandelt denselben Schlüssel als dieselbe Buchung (zweiter Aufruf zieht nichts ab und nennt dieselbe
 * Buchungsnummer). Zwei gleichzeitige Anfragen oder ein zweiter Klick nach einem Gateway-Abbruch treffen so
 * dieselbe Buchung. Nach einer Rückbuchung braucht der nächste Versuch eine NEUE Kennung — sonst gälte die
 * zurückgegebene Buchung als bezahlt —, deshalb der Zähler.
 */

const LLM_TIMEOUT_MS = timeoutMs("LLM_TIMEOUT_MS", 45_000);

/** Buchungs-Kennung der Auswertung (rein, getestet). */
export function finishChargeKey(simId: string, refunds: number | null | undefined): string {
  const n = typeof refunds === "number" && Number.isInteger(refunds) && refunds > 0 ? refunds : 0;
  return `sim-finish:${simId}:${n}`;
}

// ── 1. Buchen ────────────────────────────────────────────────────────────────

export type FinishCharge =
  | { ok: true; grant: EntitlementGrant; /** Zählerstand, zu dem die Kennung der Buchung gehört. */ refunds: number }
  /** Das Tor hat abgelehnt (kein Guthaben, KI aus, neu anmelden, Dienst nicht erreichbar). */
  | { ok: false; response: NextResponse }
  /** Der Lauf ist (frisch gelesen) nicht mehr aktiv — nichts gebucht. */
  | { ok: false; ended: SimulationDoc };

/**
 * Vermerk für genau diese Kennung sicherstellen und ergänzen. Tut nichts, wenn die Kennung zu einem früheren,
 * schon zurückgebuchten Versuch gehört (Zähler weitergelaufen) oder wenn der Lauf inzwischen ausgewertet ist und
 * die Buchung damit gedeckt (bei unverändertem Zähler ist es dieselbe Kennung, also dieselbe Buchung).
 * Wirft nie: Der Vermerk ist Buchführung, er darf den Geldweg nicht abbrechen — ein Fehlschlag steht im Protokoll.
 */
async function writeMark(
  uid: string,
  simId: string,
  key: string,
  refunds: number,
  patch: Partial<NonNullable<SimulationDoc["openCharge"]>>
): Promise<void> {
  try {
    await updateSimulation(uid, simId, (d) => {
      if ((d.chargeRefunds ?? 0) !== refunds) return false;
      if (d.status === "finished" && (!patch.txId || d.centralSpendTxId === patch.txId)) return false;
      const vorhanden = d.openCharge?.key === key ? d.openCharge : null;
      if (vorhanden && !Object.keys(patch).length) return false;
      d.openCharge = { ...(vorhanden ?? { key, at: new Date().toISOString() }), ...patch };
    });
  } catch (e) {
    logger.apiError("/api/simulation/finish/charge-mark", e, { simId, key });
  }
}

/**
 * Schritt 1: offene Buchung am Lauf vermerken, DANN buchen (C8a). Reihenfolge und Fälle:
 *  - Lauf nicht mehr aktiv → nichts vermerkt, nichts gebucht (`ended`).
 *  - Am Lauf steht schon eine BESTÄTIGTE Buchung derselben Kennung (zweiter Klick, zweiter Tab, Neustart nach
 *    Prozess-Ende, gescheiterte Rückbuchung) → sie wird wiederverwendet, der Credit-Dienst wird nicht gerufen.
 *  - Sonst buchen mit der Kennung aus Lauf und Zähler. Klare Ablehnung → eigener Vermerk wieder weg.
 *    Antwort ohne klares Ergebnis (Frist, Netz, 5xx) → Vermerk BLEIBT (C8c): zentral kann gebucht sein, der
 *    nächste Versuch trifft dieselbe Kennung und damit dieselbe Buchung.
 *  - Gebucht → Buchungsnummer und Arbeitsbereich am Vermerk nachtragen.
 */
export async function chargeFinish(a: { uid: string; email?: string | null; simId: string }): Promise<FinishCharge> {
  const st: { key: string; refunds: number; own: boolean; confirmed: { txId: string; workspaceId: string } | null } = {
    key: "",
    refunds: 0,
    own: false,
    confirmed: null,
  };
  const doc = await updateSimulation(a.uid, a.simId, (d) => {
    st.own = false;
    st.confirmed = null;
    if (d.status !== "active") return false;
    st.refunds = d.chargeRefunds ?? 0;
    st.key = finishChargeKey(d.id, st.refunds);
    if (d.openCharge?.key === st.key) {
      // Vermerk derselben Kennung steht schon: sein Zeitpunkt bleibt (der Abgleich sieht das Alter der ersten Buchung).
      if (d.openCharge.txId) st.confirmed = { txId: d.openCharge.txId, workspaceId: d.openCharge.workspaceId ?? "" };
      return false;
    }
    d.openCharge = { key: st.key, at: new Date().toISOString() };
    st.own = true;
  });
  if (!doc) return { ok: false, response: NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 }) };
  if (doc.status !== "active") return { ok: false, ended: doc };

  if (st.confirmed) {
    logger.api("/api/simulation/finish", "charge-reused", { simId: a.simId, key: st.key, von: "vermerk" });
    return {
      ok: true,
      refunds: st.refunds,
      grant: {
        runId: st.key,
        workspaceId: st.confirmed.workspaceId,
        held: true,
        central: true,
        centralTxId: st.confirmed.txId,
        reused: true,
      },
    };
  }

  const ent = await reserveEntitlement({ uid: a.uid, email: a.email, runId: st.key });
  if (!ent.ok) {
    if (ent.unklar) {
      logger.warn(
        "[credits] Buchung der Auswertung ohne klare Antwort – der Vermerk bleibt am Lauf, der nächste Versuch trifft dieselbe Kennung",
        { simId: a.simId, key: st.key }
      );
      // Ein paralleler Versuch mit klarer Ablehnung kann den Vermerk ausgetragen haben — er muss stehen.
      await writeMark(a.uid, a.simId, st.key, st.refunds, {});
    } else if (st.own) {
      try {
        await updateSimulation(a.uid, a.simId, (d) => {
          // Nur den eigenen, unbestätigten Vermerk austragen — nie eine inzwischen bestätigte Buchung.
          if (d.openCharge?.key !== st.key || d.openCharge.txId) return false;
          d.openCharge = null;
        });
      } catch (e) {
        logger.apiError("/api/simulation/finish/charge-mark", e, { simId: a.simId, key: st.key });
      }
    }
    return { ok: false, response: ent.response };
  }

  if (ent.grant.reused) {
    logger.api("/api/simulation/finish", "charge-reused", { simId: a.simId, key: st.key, von: "credit-dienst" });
  }
  await writeMark(a.uid, a.simId, st.key, st.refunds, {
    txId: ent.grant.centralTxId ?? null,
    workspaceId: ent.grant.workspaceId,
  });
  return { ok: true, grant: ent.grant, refunds: st.refunds };
}

// ── 4. Zurückbuchen ──────────────────────────────────────────────────────────

/**
 * Schritt 4: Credit der Auswertung zurückgeben und das Ergebnis AUSWERTEN (C8b).
 *  - `kept`     nichts zurückgegeben: Die Buchung trägt eine gespeicherte Auswertung (ein zweiter Tab mit
 *               derselben Kennung war schneller — der Credit ist verbraucht) oder sie ist schon zurück.
 *  - `refunded` zurückgegeben; Zähler am Lauf erhöht (der nächste Versuch bucht mit neuer Kennung), Vermerk weg.
 *  - `failed`   Rückbuchung gescheitert: Der Credit ist NICHT zurück. Der Vermerk bleibt am Lauf (mit Zeitpunkt
 *               des Fehlschlags), eine klare Protokollzeile steht. Der nächste Versuch verwendet die Buchung wieder.
 * Wirft nie.
 */
export async function refundFinishCharge(a: {
  uid: string;
  simId: string;
  grant: EntitlementGrant;
  refunds: number;
}): Promise<"kept" | "refunded" | "failed"> {
  const key = a.grant.runId;
  let fresh: SimulationDoc | null = null;
  try {
    fresh = await getSimulation(a.uid, a.simId);
  } catch (e) {
    logger.apiError("/api/simulation/finish/refund", e, { simId: a.simId, key });
  }
  if (fresh) {
    if (fresh.status === "finished" && a.grant.centralTxId && fresh.centralSpendTxId === a.grant.centralTxId) return "kept";
    if ((fresh.chargeRefunds ?? 0) !== a.refunds) return "kept";
  }

  let ok = false;
  try {
    ok = (await compensateEntitlement(a.grant)).ok;
  } catch (e) {
    logger.apiError("/api/simulation/finish/refund", e, { simId: a.simId, key });
  }
  if (!ok) {
    logger.error(
      "[credits] Rückbuchung der Auswertung gescheitert – der Credit ist NICHT zurück, der Vermerk bleibt am Lauf (scripts/credits-abgleich.mts)",
      { simId: a.simId, key }
    );
    await writeMark(a.uid, a.simId, key, a.refunds, {
      txId: a.grant.centralTxId ?? null,
      workspaceId: a.grant.workspaceId,
      refundFailedAt: new Date().toISOString(),
    });
    return "failed";
  }

  try {
    await updateSimulation(a.uid, a.simId, (d) => {
      if ((d.chargeRefunds ?? 0) !== a.refunds) return false;
      d.chargeRefunds = a.refunds + 1;
      if (d.openCharge?.key === key) d.openCharge = null;
    });
  } catch (e) {
    logger.error(
      "[credits] Rückbuchung gelungen, aber am Lauf nicht vermerkt – der nächste Versuch träfe die schon zurückgegebene Buchung",
      { simId: a.simId, key, err: e instanceof Error ? e.message : String(e) }
    );
  }
  logger.api("/api/simulation/finish", "charge-refunded", { simId: a.simId, key });
  return "refunded";
}

// ── 2. Auswerten ─────────────────────────────────────────────────────────────

export interface FinishEvaluation {
  feedback: SimulationFeedbackOutput;
  competencyRatings: ReturnType<typeof defaultCompetencyRatings>;
  competencyError: string | null;
  debrief: Debrief;
  delta: (ReturnType<typeof computeDelta> & { competencies?: Record<string, number | null> }) | null;
  qualityNotes: QualityNote[];
  /** C7: Modellkennung des Richters, der wirklich geurteilt hat (Provenienz am Lauf). */
  modelId: string;
  /** C7/C17: Kennzahlen der Auswertung für Lauf, Protokoll und Statistik. */
  evalStats: NonNullable<SimulationDoc["evalStats"]>;
}

/**
 * Schritt 2: die eigentliche Auswertung — alles zwischen Buchung und Speichern. Liest (Rückblick aus dem Alltag,
 * Vorversuch), ruft Richter und Kompetenz-Bewertung, prüft Zitate, rechnet Gesamtwertung und Vergleich.
 * Schreibt nichts und bucht nichts. Wirft, wenn der Richter kein Urteil liefert (Aufrufer bucht zurück).
 */
export async function evaluateSimulation(a: {
  uid: string;
  doc: SimulationDoc;
  scenario: SimulationScenario;
  selfAssessment?: string;
}): Promise<FinishEvaluation> {
  const { uid, doc, scenario } = a;
  const t0 = Date.now();
  const transcript = assembleTranscript(doc.turns, scenario.persona.name);

  // O2: Rückmeldung aus dem Alltag (letzter beantworteter Vorsatz) als
  // Kontext fürs Debrief — best effort, nie blockierend.
  let transferReview = "";
  try {
    const tr = await latestTransferReview(uid);
    if (tr) {
      transferReview = buildTransferReviewText({
        lang: doc.convoLocale ?? scenario.locale,
        commitmentText: tr.commitment.text,
        outcome: tr.transferCheck.outcome,
        note: tr.transferCheck.note,
      });
    }
  } catch (e) {
    logger.apiError("/api/simulation/finish/transfer-review", e, { simId: doc.id });
  }

  // Rubrik-Feedback (Pflichtpfad) + C1–C10-Scoring (degradiert nur) parallel.
  const [fbSettled, compSettled] = await Promise.allSettled([
    withRetry(
      () =>
        judgeSimulation({
          scenario,
          turns: doc.turns,
          focus: doc.focus ?? undefined,
          convoLocale: doc.convoLocale ?? undefined,
          selfAssessment: a.selfAssessment || undefined,
          transferReview: transferReview || undefined,
          // Welle 2: Gesprächsende durch die Rolle und Öffnungsverlauf als Kontext (nie als Beleg).
          gespraechsende: doc.closedByPersona
            ? `${scenario.persona.name} beendete das Gespräch (${doc.closedByPersona.ergebnis}): ${doc.closedByPersona.grund}`
            : doc.closedByTime
              ? "Die Zeit lief ab; die Rolle verabschiedete sich."
              : undefined,
          regieVerlauf: regieVerlaufText(doc.regie, scenario.locale) || undefined,
          // Bewertung 2.0 (01.11.2026): Ergebnis und erfüllte Bedingungen der Rolle als Tatsachen (Konsistenzregel).
          tatsachen: tatsachenText({ personaName: scenario.persona.name, locale: scenario.locale, regie: doc.regie, closedByPersona: doc.closedByPersona, closedByTime: doc.closedByTime === true }) || undefined,
        }),
      // Welle 1: der Opus-Richter braucht länger (40–90 s); seine Frist plus Rückfall liegt im Flow.
      { ms: coachRichter() === "opus" ? RICHTER_OPUS_TIMEOUT_MS + 50_000 : LLM_TIMEOUT_MS, label: "sim-feedback", retries: 1 }
    ),
    withTimeout(
      scoreCompetencies({
        transcriptText: transcript,
        // W3-4: why-Begründungen folgen der GESPRÄCHSSPRACHE (vorher hart
        // "de" — englische Läufe bekamen deutsche Begründungen). Zitate
        // bleiben per Prompt im Originalwortlaut.
        lang: doc.convoLocale ?? "de",
        leaderLabel: "Teilnehmer:in",
        employeeLabel: scenario.persona.name,
        // V2 (28.08.): Szenario-Typ rahmt die Bewertung — ein Verkaufs-
        // oder Konfliktgespräch wird nicht mehr als Führungssituation
        // bewertet (Kategorie liegt im Szenario bereits vor).
        scenarioCategory: scenario.category,
      }),
      LLM_TIMEOUT_MS,
      "gemini-sim-competencies"
    ),
  ]);

  if (fbSettled.status === "rejected") throw fbSettled.reason;
  const { feedback, richter } = fbSettled.value;

  let competencyRatings = defaultCompetencyRatings();
  let competencyError: string | null = null;
  try {
    if (compSettled.status === "rejected") throw compSettled.reason;
    competencyRatings = normalizeCompetencyRatings(compSettled.value, {
      lang: doc.convoLocale ?? "de",
      leaderLabel: "Teilnehmer:in",
      employeeLabel: scenario.persona.name,
    });
  } catch (e: any) {
    competencyError = e?.message ?? String(e);
    logger.apiError("/api/simulation/finish/competencies", e);
  }

  // P2 (COACH-UX-BLUEPRINT §6): Grounding auch im Rollenspiel — derselbe
  // deterministische Zitat-Check wie /api/analyze, gegen das zusammengebaute
  // Gesprächsprotokoll, für die C1–C10-Ratings UND die S1–S5-Evidence.
  // Läuft VOR computeDebrief, damit die Gesamtwertung nie auf fabrizierten
  // Belegen aufbaut. quality-core ist pure — direkt nutzbar.
  let qualityNotes: QualityNote[] = [];
  try {
    const rubricForCheck = feedback.rubric.map((r) => ({
      id: r.key,
      score: r.score,
      evidence: r.evidence ?? [],
    }));
    const qc = runQualityChecks(
      {
        summary: feedback.summary,
        competency_ratings: [
          ...(competencyRatings as Array<{ id: string; score: number | null; evidence?: string[] }>),
          ...rubricForCheck,
        ],
      },
      // O1a (N4-84, Gemini Zu 1): Vergleichstext sind die ROHEN Beiträge ohne
      // Sprecher-Labels — Labels sind Metadaten, geprüft wird nur der Wortlaut.
      doc.turns.map((t) => t.text).join("\n")
    );
    qualityNotes = qc.notes;
    if (qc.notes.length) {
      // P3: Zählung je Modus sichtbar machen (App Insights) — Datenbasis
      // für den E2-Entscheid (enforce), analog /api/analyze.
      logger.api("/api/simulation/finish", "quality-notes", {
        uid,
        mode: qualityMode(),
        count: qc.notes.length,
        errors: qc.notes.filter((n) => n.severity === "error").length,
      });
    }
    if (qc.blocked) {
      const fabricated = new Set(
        qc.notes.filter((n) => n.severity === "error" && n.field).map((n) => n.field as string)
      );
      // Gleicher heldWhy-Text wie analyze/route (Muster §2.2 enforce).
      const heldWhy =
        doc.convoLocale === "en"
          ? "evidence not verifiable in transcript — score withheld (quality gate)"
          : "Belege nicht im Transkript verifizierbar — Score zurückgehalten (Qualitäts-Gate)";
      competencyRatings = (competencyRatings as any[]).map((c: any) =>
        fabricated.has(c.id) ? { ...c, score: null, evidence: [], why: heldWhy } : c
      ) as typeof competencyRatings;
      feedback.rubric = feedback.rubric.map((r) =>
        fabricated.has(r.key) ? { ...r, score: null, evidence: [], why: heldWhy } : r
      );
      logger.api("/api/simulation/finish", "quality-enforce-degraded", {
        uid,
        fields: [...fabricated],
      });
    }
  } catch (e) {
    logger.apiError("/api/simulation/finish/quality", e);
  }

  // Debrief 2.0 (D1): deterministische Gesamtwertung in Code — das LLM
  // liefert nur Einzel-Scores. Plus Delta zum Vorversuch (D2), best effort.
  // Welle B: Anker-Gewichte aus dem Szenario (B1) + strengere Grenze im
  // Prüfungsmodus (B2).
  const weightByKey = new Map(
    scenario.assessment.competencies.map((c) => [c.key, c.weight])
  );
  const pruefung = doc.mode === "check";
  const passThreshold = pruefung
    ? (scenario.assessment.checkPassThreshold ?? CHECK_PASS_THRESHOLD)
    : scenario.assessment.passThreshold;
  const debrief = computeDebrief({
    rubric: feedback.rubric.map((r) => ({
      key: r.key,
      label: r.label,
      score: r.score,
      weight: weightByKey.get(r.key),
    })),
    checkpoints: feedback.checkpoints.map((c) => ({ id: c.id, hit: c.hit })),
    passThreshold,
    // Bewertung 2.0: Ziel freigegeben → bestanden; Abbruch → nicht bestanden; sonst Punkte.
    ergebnis: bestimmeErgebnis({ closedByPersona: doc.closedByPersona, zielErreicht: feedback.zielErreicht ?? null }),
    // Paket 2, C6 (Owner-Entscheid 12.11.2026): im Prüfungsmodus „bestanden“ nur mit der Mindestpunktzahl.
    pruefung,
  });
  let delta: FinishEvaluation["delta"] = null;
  try {
    const prev = await latestFinishedForScenario(uid, doc.scenarioId, doc.id);
    const prevFb = prev?.feedbackJson as SimulationFeedbackOutput | undefined;
    if (prev && prevFb?.rubric) {
      const prevDebrief =
        (prev.debriefJson as Debrief | null) ??
        computeDebrief({
          rubric: prevFb.rubric.map((r) => ({ key: r.key, label: r.label, score: r.score })),
          checkpoints: (prevFb.checkpoints ?? []).map((c) => ({ id: c.id, hit: c.hit })),
          passThreshold: scenario.assessment.passThreshold,
        });
      delta = computeDelta({
        current: debrief,
        previous: prevDebrief,
        prevAttempt: prev.attempt ?? 1,
      });
      // W3-1: zusätzlich das C1–C10-Delta (measurement-delta, dieselbe
      // Rechnung wie die Delta-Card der Analyse) — Datenbasis des
      // Endscreen-CTAs »Erkenntnis → Handlung«. Additiv, best effort.
      if (prev.competencyRatings) {
        try {
          delta.competencies = computeMeasurementDelta(
            competencyRatings,
            prev.competencyRatings
          ).deltas;
        } catch {
          /* C-Delta ist Komfort — Anker-Delta bleibt. */
        }
      }
    }
  } catch (e) {
    logger.apiError("/api/simulation/finish/delta", e, { simId: doc.id });
  }

  // Paket 2, C17: Kosten und Dauer je Lauf — eine Protokollzeile, dieselben Zahlen am Lauf. Keine Noten, kein Nutzertext.
  const evalStats: FinishEvaluation["evalStats"] = {
    judge: richter.judge,
    fallback: richter.fallback,
    tokensIn: richter.tokensIn,
    tokensOut: richter.tokensOut,
    judgeMs: richter.judgeMs,
    ms: Date.now() - t0,
  };
  logger.api("/api/simulation/finish", "evaluation", { simId: doc.id, modelId: richter.modelId, ...evalStats });

  return { feedback, competencyRatings, competencyError, debrief, delta, qualityNotes, modelId: richter.modelId, evalStats };
}

// ── 3. Speichern ─────────────────────────────────────────────────────────────

export type FinishStore =
  /** Auswertung steht am Lauf, Status `finished`, Vermerk ausgetragen. */
  | { state: "stored"; doc: SimulationDoc }
  /** Der Lauf ist inzwischen nicht mehr aktiv (zweiter Tab hat ausgewertet, oder abgebrochen) — nichts überschrieben. */
  | { state: "ended"; doc: SimulationDoc }
  /** Die Buchung dieser Anfrage wurde inzwischen zurückgegeben (paralleler Versuch scheiterte) — nichts gespeichert. */
  | { state: "refunded" }
  | { state: "missing" };

/**
 * Schritt 3 (C3): das Ergebnis auf den frischen Lauf anwenden statt die alte Kopie ganz zu überschreiben.
 * Geschrieben wird nur, wenn der Lauf noch aktiv ist UND die Buchung dieser Anfrage noch gilt (Zähler der
 * Rückbuchungen unverändert) — sonst stünde eine Auswertung ohne bezahlten Credit am Lauf.
 */
export async function storeEvaluation(a: {
  uid: string;
  simId: string;
  evaluation: FinishEvaluation;
  selfAssessment?: string;
  grant: EntitlementGrant | null;
  refunds: number;
}): Promise<FinishStore> {
  const ev = a.evaluation;
  const finishedAt = new Date().toISOString();
  const st: { state: "stored" | "ended" | "refunded" } = { state: "stored" };
  const doc = await updateSimulation(a.uid, a.simId, (d) => {
    if (d.status !== "active") {
      st.state = "ended";
      return false;
    }
    if (a.grant && (d.chargeRefunds ?? 0) !== a.refunds) {
      st.state = "refunded";
      return false;
    }
    st.state = "stored";
    d.status = "finished";
    d.finishedAt = finishedAt;
    d.selfAssessment = a.selfAssessment || null;
    d.feedbackJson = ev.feedback;
    d.competencyRatings = ev.competencyRatings;
    d.competencyError = ev.competencyError;
    d.debriefJson = ev.debrief;
    d.deltaJson = ev.delta;
    d.qualityNotes = ev.qualityNotes;
    // Provenienz (27.09.; Paket 2, C7): der Richter, der wirklich geurteilt hat — vorher stand hier immer das schnelle Modell.
    d.modelId = ev.modelId;
    d.evalStats = ev.evalStats;
    // O2: Der Vorschlag des Debriefs war ab sofort der Vorsatz (Gemini Zu 3: ein
    // Schritt, keine Auswahl). Seit 11.10.2026 (N17/B8, Owner-GO) zählt er erst mit
    // „Übernehmen“ in der Auswertung (/api/simulation/commit, source "model") — sonst
    // fragt der Coach nach drei Tagen nach etwas, das nie gewählt wurde.
    // Rückweg: COMMITMENT_EXPLICIT=off → alter Weg (stilles Setzen).
    if (ev.feedback.microTransfer?.step && !commitmentExplicitOn()) {
      d.commitment = {
        text: ev.feedback.microTransfer.step,
        source: "model",
        createdAt: finishedAt,
        dueHint: ev.feedback.microTransfer.when || null,
      };
    }
    if (a.grant) {
      d.workspaceId = a.grant.workspaceId;
      d.centralSpendTxId = a.grant.centralTxId ?? null;
    }
    // C8a: Die Buchung ist jetzt durch die gespeicherte Auswertung gedeckt — Vermerk austragen.
    d.openCharge = null;
  });
  if (!doc) return { state: "missing" };
  if (st.state === "refunded") return { state: "refunded" };
  return { state: st.state, doc };
}
