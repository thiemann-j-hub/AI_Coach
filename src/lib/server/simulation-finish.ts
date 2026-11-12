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
import { claimFreeTestEval, releaseFreeTestEval } from "@/lib/server/scenario-store";
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
import { buildTransferReviewText } from "@/lib/simulation/transfer";
import type { SimulationScenario } from "@/lib/simulation/types";
import { timeoutMs, withRetry, withTimeout } from "@/lib/with-timeout";

/**
 * Auswertung eines Rollenspiels: Geldweg und Rechnung.
 *
 * Paket 2 (12.11.2026 — C3, C4, C7, C8, C17) hat die Schritte gelegt. Paket 3 (C4, zweiter Teil) macht daraus einen
 * Auftrag mit Status: Der Lauf steht während der Rechnung auf `finishing`, und genau EIN Versuch je Lauf rechnet.
 * Die Route `/api/simulation/finish` sichert den Anspruch und bucht; der Auftrag (`simulation-finish-job.ts`)
 * rechnet, speichert und schließt ab:
 *
 *   1. `claimFinish`        Anspruch sichern: `active` → `finishing`. Nur einer gewinnt; `finishing.since` ist die
 *                           Kennung des Versuchs. Wer verliert, bucht nicht und rechnet nicht.
 *   2. `claimFreeFinish`    Entscheid 5: freier Testlauf des Szenarios? Dann wird nicht gebucht.
 *      `chargeFinish`       sonst: offene Buchung am Lauf vermerken, DANN buchen (oder die schon bestätigte Buchung
 *                           derselben Kennung wiederverwenden).
 *   3. `evaluateSimulation` die eigentliche Auswertung — liest nur, schreibt nichts, bucht nichts.
 *   4. `storeEvaluation`    Ergebnis auf den FRISCHEN Lauf anwenden — nur, wenn der Anspruch noch diesem Versuch
 *                           gehört und seine Buchung noch gilt. Sonst wird nichts überschrieben.
 *   5. `revertFinish`       Fehler (auch: hängengebliebener Lauf): Rückbuchung über `refundFinishCharge` oder
 *                           Freilauf zurück, DANN zurück auf `active` mit `finishError`.
 *
 * Kennung der Buchung: `sim-finish:<simId>:<n>`, n = Zahl der gelungenen Rückbuchungen am Lauf. Der Credit-Dienst
 * behandelt denselben Schlüssel als dieselbe Buchung (zweiter Aufruf zieht nichts ab und nennt dieselbe
 * Buchungsnummer). Ein neuer Versuch nach einer gescheiterten Rückbuchung oder nach einer Antwort ohne klares
 * Ergebnis trifft so dieselbe Buchung. Nach einer gelungenen Rückbuchung braucht der nächste Versuch eine NEUE
 * Kennung — sonst gälte die zurückgegebene Buchung als bezahlt —, deshalb der Zähler.
 *
 * Was `finishing` überflüssig gemacht hat: zwei Anfragen, die nebeneinander rechnen und sich eine Buchung teilen
 * (zweites Buchen nach fremder Rückbuchung, Ausliefern des fremden Ergebnisses). Geblieben sind die Eigenschaften:
 * dieselbe Buchung für denselben Versuch, Rückbuchung nur einmal, nie eine fertige Auswertung überschreiben.
 */

const LLM_TIMEOUT_MS = timeoutMs("LLM_TIMEOUT_MS", 45_000);

/** Buchungs-Kennung der Auswertung (rein, getestet). */
export function finishChargeKey(simId: string, refunds: number | null | undefined): string {
  const n = typeof refunds === "number" && Number.isInteger(refunds) && refunds > 0 ? refunds : 0;
  return `sim-finish:${simId}:${n}`;
}

// ── 1. Anspruch ──────────────────────────────────────────────────────────────

/** Gehört der Anspruch auf die Auswertung (noch) dem Versuch mit dieser Kennung? */
function ownsClaim(d: SimulationDoc, since: string): boolean {
  return d.status === "finishing" && d.finishing?.since === since;
}

export type FinishClaim =
  /** Dieser Aufruf rechnet: Der Lauf steht auf `finishing`, `since` ist die Kennung des Versuchs. */
  | { state: "claimed"; doc: SimulationDoc; since: string }
  /** Der Lauf ist nicht (mehr) aktiv — er rechnet schon, ist ausgewertet oder abgebrochen. Nichts geändert. */
  | { state: "taken"; doc: SimulationDoc }
  | { state: "missing" };

/**
 * Schritt 1 (C4): Anspruch auf die Auswertung sichern — nur aus `active`, mit Versionsprüfung. Von zwei Klicks oder
 * zwei Tabs gewinnt genau einer; der andere sieht `finishing`. Ein alter Fehlschlag (`finishError`) wird gelöscht.
 */
export async function claimFinish(uid: string, simId: string): Promise<FinishClaim> {
  const since = new Date().toISOString();
  let won = false;
  const doc = await updateSimulation(uid, simId, (d) => {
    won = d.status === "active";
    if (!won) return false;
    d.status = "finishing";
    d.finishing = { since };
    d.finishError = null;
  });
  if (!doc) return { state: "missing" };
  return won ? { state: "claimed", doc, since } : { state: "taken", doc };
}

// ── 2. Freier Testlauf oder buchen ───────────────────────────────────────────

async function releaseFree(a: { uid: string; oid?: string | null; simId: string; scenarioId: string }): Promise<void> {
  try {
    await releaseFreeTestEval(a.uid, a.oid, a.scenarioId);
  } catch (e) {
    logger.error("[freilauf] Freier Testlauf nicht zurückgegeben – das Szenario hat ihn verloren, obwohl keine Auswertung entstand", {
      simId: a.simId,
      scenarioId: a.scenarioId,
      err: e instanceof Error ? e.message : String(e),
    });
  }
}

export type FreeFinish =
  | { free: true }
  /** Kein Freilauf. `ended` = der Anspruch gehört nicht mehr diesem Versuch (z. B. inzwischen abgebrochen). */
  | { free: false; ended?: SimulationDoc };

/**
 * Schritt 2a (Entscheid 5, Owner 12.11.2026): Die erste Auswertung je neu im Builder erzeugtem Szenario ist für
 * die Person frei, die es gebaut hat. Vor der Buchung den Freilauf beanspruchen (genau einer gewinnt, siehe
 * `claimFreeTestEval`); gelingt das, wird NICHT gebucht und `freeTestEval: true` am Lauf vermerkt — der Aufräumer
 * hängengebliebener Läufe gibt den Freilauf anhand dieses Vermerks zurück.
 * Steht am Lauf schon eine Buchung (gescheiterte Rückbuchung, Antwort ohne klares Ergebnis), gilt sie: kein Freilauf.
 */
export async function claimFreeFinish(a: { uid: string; oid?: string | null; simId: string; since: string; doc: SimulationDoc }): Promise<FreeFinish> {
  if (a.doc.openCharge) return { free: false };
  const scenarioId = a.doc.scenarioId;
  let claimed = false;
  try {
    claimed = await claimFreeTestEval(a.uid, a.oid, scenarioId);
  } catch (e) {
    logger.apiError("/api/simulation/finish/freilauf", e, { simId: a.simId });
  }
  if (!claimed) return { free: false };

  let ours = false;
  let doc: SimulationDoc | null = null;
  try {
    doc = await updateSimulation(a.uid, a.simId, (d) => {
      ours = ownsClaim(d, a.since);
      if (!ours) return false;
      d.freeTestEval = true;
    });
  } catch (e) {
    ours = false;
    logger.apiError("/api/simulation/finish/freilauf", e, { simId: a.simId });
  }
  if (ours) {
    logger.api("/api/simulation/finish", "free-test-eval", { simId: a.simId, scenarioId });
    return { free: true };
  }
  // Der Vermerk steht nicht am Lauf: Freilauf zurückgeben, damit er nicht ohne Auswertung verbraucht ist.
  await releaseFree({ uid: a.uid, oid: a.oid, simId: a.simId, scenarioId });
  return doc ? { free: false, ended: doc } : { free: false };
}

export type FinishCharge =
  | { ok: true; grant: EntitlementGrant; /** Zählerstand, zu dem die Kennung der Buchung gehört. */ refunds: number }
  /** Das Tor hat abgelehnt (kein Guthaben, KI aus, neu anmelden, Dienst nicht erreichbar). */
  | { ok: false; response: NextResponse }
  /** Der Anspruch gehört (frisch gelesen) nicht mehr diesem Versuch — nichts gebucht. */
  | { ok: false; ended: SimulationDoc };

/**
 * Vermerk für genau diese Kennung ergänzen. Tut nichts, wenn die Kennung zu einem früheren, schon zurückgebuchten
 * Versuch gehört (Zähler weitergelaufen) oder wenn der Lauf ausgewertet ist und genau diese Buchung trägt.
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
      d.openCharge = { ...(vorhanden ?? { key, at: new Date().toISOString() }), ...patch };
    });
  } catch (e) {
    logger.apiError("/api/simulation/finish/charge-mark", e, { simId, key });
  }
}

/**
 * Schritt 2b: offene Buchung am Lauf vermerken, DANN buchen (C8a). Nur der Versuch, dem der Anspruch gehört
 * (`since`), bucht. Reihenfolge und Fälle:
 *  - Anspruch gehört nicht mehr diesem Versuch (inzwischen abgebrochen) → nichts vermerkt, nichts gebucht (`ended`).
 *  - Am Lauf steht schon eine BESTÄTIGTE Buchung derselben Kennung (gescheiterte Rückbuchung, Prozess-Ende nach
 *    der Buchung) → sie wird wiederverwendet, der Credit-Dienst wird nicht gerufen.
 *  - Sonst buchen mit der Kennung aus Lauf und Zähler. Klare Ablehnung → eigener Vermerk wieder weg.
 *    Antwort ohne klares Ergebnis (Frist, Netz, 5xx) → Vermerk BLEIBT (C8c): zentral kann gebucht sein, der
 *    nächste Versuch trifft dieselbe Kennung und damit dieselbe Buchung.
 *  - Gebucht → Buchungsnummer und Arbeitsbereich am Vermerk nachtragen.
 * Bei jeder Ablehnung stellt der Aufrufer den Lauf mit `revertFinish` auf `active` zurück.
 */
export async function chargeFinish(a: { uid: string; email?: string | null; simId: string; since: string }): Promise<FinishCharge> {
  const st: { ours: boolean; key: string; refunds: number; own: boolean; confirmed: { txId: string; workspaceId: string } | null } = {
    ours: false,
    key: "",
    refunds: 0,
    own: false,
    confirmed: null,
  };
  const doc = await updateSimulation(a.uid, a.simId, (d) => {
    st.own = false;
    st.confirmed = null;
    st.ours = ownsClaim(d, a.since);
    if (!st.ours) return false;
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
  if (!st.ours) return { ok: false, ended: doc };

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

// ── 5. Zurückbuchen und zurück auf Anfang ────────────────────────────────────

/**
 * Credit der Auswertung zurückgeben und das Ergebnis AUSWERTEN (C8b).
 *  - `kept`     nichts zurückgegeben: Die Buchung trägt eine gespeicherte Auswertung (der Credit ist verbraucht)
 *               oder sie ist schon zurück (Auftrag und Aufräumer buchen nie beide zurück).
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

/**
 * Schritt 5: Versuch zurücknehmen — erst das Geld, dann der Status. Reihenfolge:
 *   1. Rückbuchung (`refundFinishCharge`) bzw. Freilauf zurückgeben. Solange läuft, bleibt der Lauf auf
 *      `finishing`: Ein neuer Versuch kann die Buchung nicht wiederverwenden, während sie zurückgegeben wird.
 *   2. Zurück auf `active` — nur, wenn der Anspruch noch diesem Versuch gehört. `error` wird als `finishError`
 *      vermerkt (null = kein Fehlschlag der Auswertung, z. B. abgelehnte Buchung: die Antwort trägt den Grund).
 * Aufrufer: die Route (Buchung abgelehnt), der Auftrag (Fehler in der Rechnung) und der Aufräumer in
 * GET /api/simulation/status (hängengebliebener Lauf, `STALE`). Wirft nie.
 */
export async function revertFinish(a: {
  uid: string;
  oid?: string | null;
  simId: string;
  since: string;
  scenarioId: string;
  grant: EntitlementGrant | null;
  refunds: number;
  free: boolean;
  error: { code: string; requestId?: string | null } | null;
}): Promise<void> {
  if (a.grant) await refundFinishCharge({ uid: a.uid, simId: a.simId, grant: a.grant, refunds: a.refunds });
  if (a.free) await releaseFree(a);
  try {
    await updateSimulation(a.uid, a.simId, (d) => {
      if (!ownsClaim(d, a.since)) return false;
      d.status = "active";
      d.finishing = null;
      d.finishError = a.error ? { code: a.error.code, requestId: a.error.requestId ?? null, at: new Date().toISOString() } : null;
      if (d.freeTestEval) d.freeTestEval = false;
    });
  } catch (e) {
    logger.error("[finish] Lauf nicht auf „active“ zurückgestellt – er bleibt in „finishing“, bis der Aufräumer greift", {
      simId: a.simId,
      err: e instanceof Error ? e.message : String(e),
    });
  }
}

// ── 3. Auswerten ─────────────────────────────────────────────────────────────

export interface FinishEvaluation {
  feedback: SimulationFeedbackOutput;
  competencyRatings: ReturnType<typeof defaultCompetencyRatings>;
  competencyError: string | null;
  debrief: Debrief;
  delta: ReturnType<typeof computeDelta> | null;
  qualityNotes: QualityNote[];
  /** C7: Modellkennung des Richters, der wirklich geurteilt hat (Provenienz am Lauf). */
  modelId: string;
  /** C7/C17: Kennzahlen der Auswertung für Lauf, Protokoll und Statistik. */
  evalStats: NonNullable<SimulationDoc["evalStats"]>;
}

/**
 * Schritt 3: die eigentliche Auswertung — alles zwischen Buchung und Speichern. Liest (Rückblick aus dem Alltag,
 * Vorversuch), ruft Richter und Kompetenz-Bewertung, prüft Zitate, rechnet Gesamtwertung und Vergleich.
 * Schreibt nichts und bucht nichts. Wirft, wenn der Richter kein Urteil liefert (Aufrufer bucht zurück).
 * Paket 3, S8: ohne Selbstbild — der Abgleich mit dem Check-in ist ein eigener Schritt nach dem Speichern.
 */
export async function evaluateSimulation(a: {
  uid: string;
  doc: SimulationDoc;
  scenario: SimulationScenario;
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
      // U15, Rest (Paket 6, 12.11.2026): Das zusätzliche C1–C10-Delta ist entfallen. Sein einziger Leser war der
      // Satz „Erkenntnis → Handlung“ im Reiter „Weiter üben“; der liest jetzt das Delta je Fähigkeit (`anchors`).
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

// ── 4. Speichern ─────────────────────────────────────────────────────────────

export type FinishStore =
  /** Auswertung steht am Lauf, Status `finished`, Vermerk ausgetragen. */
  | { state: "stored"; doc: SimulationDoc }
  /** Der Anspruch gehört nicht mehr diesem Versuch (abgebrochen oder vom Aufräumer zurückgestellt) — nichts überschrieben. */
  | { state: "ended"; doc: SimulationDoc }
  /** Die Buchung dieses Versuchs wurde inzwischen zurückgegeben (Aufräumer) — nichts gespeichert. */
  | { state: "refunded" }
  | { state: "missing" };

/**
 * Schritt 4 (C3): das Ergebnis auf den frischen Lauf anwenden statt die alte Kopie ganz zu überschreiben.
 * Geschrieben wird nur, wenn der Anspruch noch diesem Versuch gehört (`finishing` mit derselben Kennung) UND seine
 * Buchung noch gilt (Zähler der Rückbuchungen unverändert) — sonst stünde eine Auswertung ohne bezahlten Credit
 * am Lauf, oder eine fertige Auswertung würde überschrieben. Der Check-in (`checkin`, `selfAssessment`) bleibt
 * unberührt: Er wird von seiner eigenen Route geschrieben, vor oder nach diesem Schritt.
 */
export async function storeEvaluation(a: {
  uid: string;
  simId: string;
  since: string;
  evaluation: FinishEvaluation;
  grant: EntitlementGrant | null;
  refunds: number;
  free: boolean;
}): Promise<FinishStore> {
  const ev = a.evaluation;
  const finishedAt = new Date().toISOString();
  const st: { state: "stored" | "ended" | "refunded" } = { state: "stored" };
  const doc = await updateSimulation(a.uid, a.simId, (d) => {
    if (!ownsClaim(d, a.since)) {
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
    d.finishing = null;
    d.finishError = null;
    d.feedbackJson = ev.feedback;
    d.competencyRatings = ev.competencyRatings;
    d.competencyError = ev.competencyError;
    d.debriefJson = ev.debrief;
    d.deltaJson = ev.delta;
    d.qualityNotes = ev.qualityNotes;
    // Provenienz (27.09.; Paket 2, C7): der Richter, der wirklich geurteilt hat — vorher stand hier immer das schnelle Modell.
    d.modelId = ev.modelId;
    d.evalStats = ev.evalStats;
    // O2: Der Vorschlag des Debriefs (microTransfer) wird hier NICHT zum Vorsatz. Seit 11.10.2026 (N17/B8, Owner-GO)
    // zählt er erst mit „Übernehmen“ in der Auswertung (/api/simulation/commit, source "model") — sonst fragt der
    // Coach nach drei Tagen nach etwas, das nie gewählt wurde.
    if (a.grant) {
      d.workspaceId = a.grant.workspaceId;
      d.centralSpendTxId = a.grant.centralTxId ?? null;
    }
    // Entscheid 5: Diese Auswertung war der freie Testlauf des Szenarios — nichts gebucht. Ein Vermerk, der vom
    // Beanspruchen stehen blieb, obwohl dann doch gebucht wurde, gilt nicht.
    if (a.free || d.freeTestEval) d.freeTestEval = a.free;
    // C8a: Die Buchung ist jetzt durch die gespeicherte Auswertung gedeckt — Vermerk austragen.
    d.openCharge = null;
  });
  if (!doc) return { state: "missing" };
  if (st.state === "refunded") return { state: "refunded" };
  return { state: st.state, doc };
}
