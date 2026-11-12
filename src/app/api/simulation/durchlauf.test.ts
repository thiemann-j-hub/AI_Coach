import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SimulationDoc } from "@/lib/server/simulation-store";
import { gespraechsZeitMs } from "@/lib/simulation/zeit";
import type { SimulationScenario, SimulationTurn } from "@/lib/simulation/types";

/**
 * Paket 6, C23 (12.11.2026): Durchlauf im Textweg von Start bis Auswertung. Der Test ruft die ECHTEN Routen
 * nacheinander und prüft die Naht zwischen ihnen — nicht jede Einzelheit noch einmal (die steht in den Tests der
 * einzelnen Routen):
 *   start → drei Züge → Coach-Pause mit Impuls → Pause-Ende → finish (202) → status bis `finished` → checkin → get.
 * Zweiter Fall: Der Richter scheitert → Lauf wieder `active` mit `finishError`, Credit zurück, zweiter Versuch gelingt.
 *
 * Echt sind die acht Routen, `simulation-store` (auf dem Speicher im Arbeitsspeicher, mit Versionsprüfung wie in
 * Cosmos), `simulation-finish`, `simulation-finish-job`, `entitlement`, `scenario-store`, die Uhr (`zeit.ts`), die
 * Rechnung (`debrief.ts`) und die Zitatprüfung. Gemockt sind die KI (Rolle, Beobachter, Coach, Richter,
 * Kompetenzen, Abgleich), der Credit-Dienst (kleiner Nachbau mit demselben Vertrag wie in finish/route.test.ts),
 * Anmeldung, Begrenzung und Tagesbudget. `after()` startet die Aufgabe sofort und merkt sie sich.
 */

// ── Aufgaben neben der Antwort ───────────────────────────────────────────────
const hintergrund: Promise<unknown>[] = [];
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => Promise<unknown>) => {
    hintergrund.push(task());
  },
}));
/** Wartet, bis Auftrag und Abgleich durch sind. */
const fertig = async () => {
  while (hintergrund.length) await hintergrund.shift();
};

// ── Speicher ─────────────────────────────────────────────────────────────────
const db = await vi.hoisted(async () => (await import("@/test/sim-speicher")).neuerSimSpeicher());
vi.mock("@/lib/cosmos", () => db.cosmos);
vi.mock("@/lib/server/radar-emit", () => ({ emitCoachMeasurement: vi.fn(async () => ({ ok: true })), deleteCoachMeasurement: vi.fn() }));
// Kein Spielbuch: Es käme sonst aus der Datenbank oder von einem starken Modell.
vi.mock("@/lib/server/spielbuch/store", () => ({ ensureSpielbuch: async () => null, deleteSpielbuch: async () => false }));

// ── Credit-Dienst im Speicher ────────────────────────────────────────────────
const ledger = {
  balance: 5,
  tx: new Map<string, { refunded: boolean }>(),
  spendKeys: [] as string[],
  refundTx: [] as string[],
};
vi.mock("@/lib/server/credits/credit-service", () => ({
  creditsCentralEnabled: () => true,
  centralWalletStatus: async () => ({ state: "active", workspaceId: "ws-1", credits: ledger.balance }),
  centralReserve: async ({ runId }: { runId: string }) => {
    ledger.spendKeys.push(runId);
    const id = `tx-spend:${runId}`;
    if (ledger.balance < 1) return { ok: false, reason: "insufficient", workspaceId: "ws-1" };
    if (ledger.tx.has(id)) return { ok: true, workspaceId: "ws-1", transactionId: id, idempotent: true };
    ledger.balance -= 1;
    ledger.tx.set(id, { refunded: false });
    return { ok: true, workspaceId: "ws-1", transactionId: id };
  },
  centralRefund: async ({ spendTransactionId }: { spendTransactionId: string }) => {
    ledger.refundTx.push(spendTransactionId);
    const t = ledger.tx.get(spendTransactionId);
    if (!t) return { ok: false };
    if (!t.refunded) {
      t.refunded = true;
      ledger.balance += 1;
    }
    return { ok: true };
  },
}));

// ── Anmeldung, Begrenzung, Tagesbudget, Protokoll ────────────────────────────
vi.mock("@/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/api-auth", () => ({ requireAuth: async () => ({ uid: "u1", email: "a@example.com", oid: "oid-1" }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => null, rateLimitKey: () => "k" }));
vi.mock("@/lib/server/cost-cap", async (original) => ({
  ...(await original<typeof import("@/lib/server/cost-cap")>()),
  checkAndConsumeBudget: async () => ({ allowed: true }),
}));
vi.mock("@/lib/logger", () => ({ logger: { api: vi.fn(), apiError: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

// ── KI ───────────────────────────────────────────────────────────────────────
type PersonaArgs = { turns: SimulationTurn[]; userMessage: string; regieNotiz: string | null };
const persona = vi.fn(async (a: PersonaArgs) => ({ reply: `Antwort ${Math.ceil(a.turns.length / 2)} auf: ${a.userMessage}` }));
vi.mock("@/ai/flows/simulation-persona", () => ({
  runPersonaTurn: (a: PersonaArgs) => persona(a),
  runPersonaOpening: vi.fn(),
}));
vi.mock("@/ai/flows/simulation-regie", () => ({
  beobachteRegie: async () => null,
  offeneRegieNotiz: () => null,
  regieStageNote: () => "",
  regieVerlaufText: () => "",
}));
vi.mock("@/ai/flows/simulation-ende-pruefung", () => ({ pruefeEnde: async () => ({ erfuellt: true, fehlt: "" }), endeAbgelehntNote: () => "" }));
const coach = vi.fn(async (_a: { turns: SimulationTurn[]; question?: string }) => ({ tip: "Frag nach dem Grund, bevor Du eine Lösung anbietest.", card: null }));
vi.mock("@/ai/flows/simulation-coach", () => ({ runCoachTimeout: (a: { turns: SimulationTurn[]; question?: string }) => coach(a) }));

type JudgeArgs = { scenario: SimulationScenario; turns: SimulationTurn[] };
const richter = { judge: "gemini", modelId: "gemini-test", fallback: null, tokensIn: 900, tokensOut: 600, judgeMs: 30 };
/** Urteil zu genau dem Gespräch, das der Auftrag übergibt: Fähigkeiten und Momente des Szenarios, Zitate aus den eigenen Zügen. */
const urteil = ({ scenario, turns }: JudgeArgs) => {
  const eigene = turns.filter((t) => t.role === "user").map((t) => t.text);
  return {
    feedback: {
      summary: "Du hast ruhig begonnen und nachgefragt.",
      zielErreicht: null,
      rubric: scenario.assessment.competencies.map((c, i) => ({
        key: c.key,
        label: c.label,
        evidence: [`Teilnehmer:in: ${eigene[i % eigene.length]}`],
        why: "Das hast Du gezeigt.",
        wentWell: [],
        tryNext: [],
        score: 3,
      })),
      checkpoints: scenario.assessment.checkpoints.map((c) => ({ id: c.id, hit: true, comment: "Kam vor." })),
      nextStep: "Frag früher nach dem Grund.",
      nextStepKey: scenario.assessment.competencies[0].key,
      focusReview: null,
      cards: [],
      microTransfer: { step: "Frag morgen zuerst nach dem Grund.", when: "morgen" },
      sachlichNichtGedeckt: [],
      judge: "gemini",
    },
    richter,
  };
};
const judge = vi.fn(async (a: JudgeArgs) => urteil(a));
vi.mock("@/ai/flows/simulation-feedback", () => ({ RICHTER_OPUS_TIMEOUT_MS: 110_000, judgeSimulation: (a: JudgeArgs) => judge(a) }));
vi.mock("@/ai/flows/score-competencies", () => ({ scoreCompetencies: async () => ({ competencies: [] }) }));
const ABGLEICH = { agreement: "confirms", comment: "Du meintest, Du hättest ruhig begonnen — das stimmt." };
const selfReview = vi.fn(async (_a: { gut: string | null; anders: string | null }) => ABGLEICH);
vi.mock("@/ai/flows/simulation-selfreview", () => ({
  CHECKIN_MAX_CHARS: 400,
  generateSelfReview: (a: { gut: string | null; anders: string | null }) => selfReview(a),
}));

// ── Aufrufe der Routen ───────────────────────────────────────────────────────
const SZENARIO = "sim-coaching-morgan";
const RID = "rid-durchlauf-1";
type Antwort = { status: number; json: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const antwort = async (res: Response): Promise<Antwort> => ({ status: res.status, json: await res.json() });
const post = (pfad: string, body: unknown) =>
  new NextRequest(`http://localhost/api/simulation/${pfad}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-request-id": RID },
  });
const holen = (pfad: string, simId: string) => new NextRequest(`http://localhost/api/simulation/${pfad}?simId=${simId}`);
const api = {
  start: async (body: unknown) => antwort(await (await import("./start/route")).POST(post("start", body))),
  turn: async (simId: string, message: string) => antwort(await (await import("./turn/route")).POST(post("turn", { simId, message }))),
  pause: async (simId: string, on: boolean) => antwort(await (await import("./pause/route")).POST(post("pause", { simId, on }))),
  impuls: async (simId: string, question: string) => antwort(await (await import("./timeout/route")).POST(post("timeout", { simId, question }))),
  finish: async (simId: string) => antwort(await (await import("./finish/route")).POST(post("finish", { simId }))),
  status: async (simId: string) => antwort(await (await import("./status/route")).GET(holen("status", simId))),
  checkin: async (simId: string, body: Record<string, unknown>) => antwort(await (await import("./checkin/route")).POST(post("checkin", { simId, ...body }))),
  get: async (simId: string) => antwort(await (await import("./get/route")).GET(holen("get", simId))),
};
const lauf = (simId: string) => db.lauf<SimulationDoc>(simId);

const ZUEGE = [
  "Danke, dass Du Dir Zeit nimmst. Mir ist wichtig, wie es Dir gerade geht.",
  "Das Angebot liegt seit zwei Wochen. Was hält Dich davon ab, es rauszugeben?",
  "Was würde Dir helfen, eine Aufgabe an Kim abzugeben?",
];
/** Uhr des Tests: nur `Date` ist gestellt, Timer und Promises laufen echt. */
const START = Date.parse("2026-11-12T09:00:00.000Z");
const um = (sekunden: number) => vi.setSystemTime(new Date(START + sekunden * 1000));

/** Start und drei Züge; gibt die Kennung des Laufs zurück. */
async function gespraech(): Promise<string> {
  um(0);
  const start = await api.start({ scenarioId: SZENARIO, weg: "schreiben" });
  expect(start.status).toBe(200);
  const simId: string = start.json.simulation.id;
  for (const [i, text] of ZUEGE.entries()) {
    um(20 * (i + 1));
    const zug = await api.turn(simId, text);
    expect(zug.status).toBe(200);
  }
  return simId;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  process.env.SIMULATION_ENABLED = "on";
  for (const k of ["COACH_RICHTER", "SIMULATION_RADAR_EMIT", "COACH_LIVE", "COACH_SIM_STARTS_PER_DAY", "COACH_PREFLIGHT", "QUALITY_CHECKS_MODE"]) delete process.env[k];
  db.reset();
  ledger.balance = 5;
  ledger.tx.clear();
  ledger.spendKeys = [];
  ledger.refundTx = [];
  hintergrund.length = 0;
  for (const m of [persona, coach, judge, selfReview]) m.mockClear();
  judge.mockImplementation(async (a: JudgeArgs) => urteil(a));
});

afterEach(async () => {
  // Kein Auftrag darf in den nächsten Test hineinlaufen.
  await fertig();
  vi.useRealTimers();
  delete process.env.SIMULATION_ENABLED;
});

describe("Durchlauf im Textweg (C23)", () => {
  it("Start → drei Züge → Coach-Pause mit Impuls → Auswertung als Auftrag → Check-in → Auswertung mit Abgleich; ein Credit, keiner offen", async () => {
    // Start: Die Rolle eröffnet, der Lauf ist offen, noch nichts gebucht.
    um(0);
    const start = await api.start({ scenarioId: SZENARIO, weg: "schreiben" });
    expect(start.status).toBe(200);
    const simId: string = start.json.simulation.id;
    expect(start.json.simulation).toMatchObject({ scenarioId: SZENARIO, status: "active", attempt: 1, pausedMs: 0, pauseSince: null, liveAvailable: false });
    expect(start.json.simulation.turns).toHaveLength(1);
    expect(start.json.simulation.turns[0].role).toBe("persona");
    expect(lauf(simId).createdAt).toBe("2026-11-12T09:00:00.000Z");

    // Drei Züge: Jeder Zug sieht, was die Züge davor gespeichert haben.
    for (const [i, text] of ZUEGE.entries()) {
      um(20 * (i + 1));
      const zug = await api.turn(simId, text);
      expect(zug.status).toBe(200);
      expect(zug.json).toMatchObject({ ok: true, reply: `Antwort ${i + 1} auf: ${text}`, turnCount: 3 + 2 * i, timeUp: false });
      expect(persona.mock.calls[i][0].turns).toHaveLength(1 + 2 * i);
    }
    expect(persona.mock.calls[2][0].turns[2]).toMatchObject({ role: "persona", text: `Antwort 1 auf: ${ZUEGE[0]}` });

    // Coach-Pause: Die Uhr steht, der Impuls landet neben dem Gespräch, nicht darin.
    um(70);
    const pauseAn = await api.pause(simId, true);
    expect(pauseAn.json).toMatchObject({ ok: true, pausedMs: 0, pauseSince: "2026-11-12T09:01:10.000Z" });
    um(90);
    const impuls = await api.impuls(simId, "Wie komme ich an den Grund?");
    expect(impuls.status).toBe(200);
    expect(impuls.json).toMatchObject({ ok: true, tip: "Frag nach dem Grund, bevor Du eine Lösung anbietest.", timeoutsUsed: 1 });
    expect(coach.mock.calls[0][0].turns).toHaveLength(7);
    // Pause-Ende: 90 Sekunden Pause zählen nicht zur Gesprächszeit.
    um(160);
    const pauseAus = await api.pause(simId, false);
    expect(pauseAus.json).toMatchObject({ ok: true, pausedMs: 90_000, pauseSince: null });
    expect(lauf(simId).turns).toHaveLength(7);
    expect(lauf(simId).coachNotes).toHaveLength(1);

    // Auswertung starten: sofort 202, der Auftrag bucht und rechnet neben der Antwort.
    let richterFertig: () => void = () => undefined;
    judge.mockImplementationOnce(
      (a: JudgeArgs) =>
        new Promise<ReturnType<typeof urteil>>((ok) => {
          richterFertig = () => ok(urteil(a));
        })
    );
    um(180);
    const finish = await api.finish(simId);
    expect(finish.status).toBe(202);
    expect(finish.json).toEqual({ ok: true, status: "finishing" });
    await vi.waitFor(() => expect(judge).toHaveBeenCalledTimes(1));

    // Status während der Rechnung: `finishing` mit Beginn und üblicher Dauer; die Buchung steht als offen am Lauf.
    const laeuft = await api.status(simId);
    expect(laeuft.json).toMatchObject({ ok: true, status: "finishing", finishError: null, startedAt: "2026-11-12T09:03:00.000Z", typicalMs: 20_000 });
    expect(lauf(simId).openCharge).toMatchObject({ key: `sim-finish:${simId}:0`, txId: `tx-spend:sim-finish:${simId}:0` });
    expect(ledger.balance).toBe(4);
    // Der Richter bekommt genau das gespeicherte Gespräch: sieben Züge, ohne den Impuls des Coachs.
    expect(judge.mock.calls[0][0].turns.map((t) => t.text)).toEqual(lauf(simId).turns.map((t) => t.text));
    // Ein Zug ist jetzt nicht mehr möglich.
    expect((await api.turn(simId, "Noch etwas?")).json).toMatchObject({ ok: false, code: "ALREADY_FINISHED" });

    richterFertig();
    await fertig();
    const fertigStatus = await api.status(simId);
    expect(fertigStatus.json).toMatchObject({ ok: true, status: "finished", finishError: null, startedAt: null });

    // Check-in nach der Auswertung: gespeichert, der Abgleich läuft neben der Antwort genau einmal.
    um(200);
    const checkin = await api.checkin(simId, { gut: "Ich bin ruhig geblieben.", anders: "Früher nach dem Grund fragen." });
    expect(checkin.json).toEqual({ ok: true, status: "finished" });
    await fertig();
    expect(selfReview).toHaveBeenCalledTimes(1);
    expect(selfReview.mock.calls[0][0]).toMatchObject({ gut: "Ich bin ruhig geblieben.", anders: "Früher nach dem Grund fragen." });

    // Die Auswertungsseite liest alles über `get`.
    const get = await api.get(simId);
    expect(get.status).toBe(200);
    const s = get.json.simulation;
    expect(s).toMatchObject({ id: simId, status: "finished", finishError: null, attempt: 1, pausedMs: 90_000, pauseSince: null, liveAvailable: false, timeUp: false, ende: null });
    expect(s.turns).toHaveLength(7);
    expect(s.coachNotes).toHaveLength(1);
    expect(s.feedback.summary).toBe("Du hast ruhig begonnen und nachgefragt.");
    expect(s.feedback.rubric.map((r: { key: string }) => r.key)).toEqual(["rahmen", "konkret", "ursache", "anerkennung", "vereinbarung"]);
    // Die Zitate stehen im Gespräch: kein Wert wurde zurückgehalten.
    expect(s.feedback.rubric.every((r: { score: number | null }) => r.score === 3)).toBe(true);
    expect(s.debrief).toMatchObject({ verdict: "passed", checkpointsHit: 5, checkpointsTotal: 5 });
    expect(typeof s.debrief.overall).toBe("number");
    expect(s.delta).toBeNull();
    // Abgleich „Selbstbild und Auswertung“ und die zwei Antworten.
    expect(s.feedback.selfReview).toEqual(ABGLEICH);
    expect(s.checkin).toMatchObject({ gut: "Ich bin ruhig geblieben.", anders: "Früher nach dem Grund fragen.", skipped: false });
    // Der Vorschlag des Coachs wird nicht still zum Vorsatz (N17; Rückweg COMMITMENT_EXPLICIT entfernt).
    expect(s.commitment).toBeNull();
    expect(get.json.scenario.id).toBe(SZENARIO);
    expect(get.json.scenario).not.toHaveProperty("personaDna");
    // Die Uhr: drei Minuten seit dem Start, davon anderthalb in der Pause.
    expect(gespraechsZeitMs(s, START + 180_000)).toBe(90_000);

    // Geld: genau ein Credit gebucht, nichts zurückgegeben, keine Buchung offen.
    expect(ledger.spendKeys).toEqual([`sim-finish:${simId}:0`]);
    expect(ledger.refundTx).toEqual([]);
    expect(ledger.balance).toBe(4);
    const d = lauf(simId);
    expect(d.openCharge).toBeNull();
    expect(d.centralSpendTxId).toBe(`tx-spend:sim-finish:${simId}:0`);
    expect(d.chargeRefunds ?? 0).toBe(0);
    expect(d.finishing).toBeNull();
    expect(d.evalStats).toMatchObject({ judge: "gemini", tokensIn: 900, tokensOut: 600 });
  });

  it("Richter scheitert → Lauf wieder `active` mit `finishError`, Credit zurück; der zweite Versuch gelingt und kostet einen Credit", async () => {
    const simId = await gespraech();

    // Erster Versuch: Der Richter liefert kein Urteil (auch nicht in der Wiederholung).
    judge.mockImplementation(async () => {
      throw new Error("503 Service Unavailable: model overloaded");
    });
    um(120);
    const erster = await api.finish(simId);
    expect(erster.status).toBe(202);
    await fertig();
    expect(judge).toHaveBeenCalledTimes(2);

    // Status und Lauf: wieder offen, mit Fehlerart und Fehler-Nummer; der Credit ist zurück.
    const gescheitert = await api.status(simId);
    expect(gescheitert.json).toMatchObject({ ok: true, status: "active", startedAt: null });
    expect(gescheitert.json.finishError).toMatchObject({ code: "ai_unavailable", requestId: RID });
    expect(ledger.spendKeys).toEqual([`sim-finish:${simId}:0`]);
    expect(ledger.refundTx).toEqual([`tx-spend:sim-finish:${simId}:0`]);
    expect(ledger.balance).toBe(5);
    let d = lauf(simId);
    expect(d.openCharge).toBeNull();
    expect(d.chargeRefunds).toBe(1);
    expect(d.feedbackJson).toBeUndefined();
    // Die Auswertungsseite sieht denselben Stand über `get` und bietet „Noch einmal auswerten“ an.
    const offen = await api.get(simId);
    expect(offen.json.simulation).toMatchObject({ status: "active", feedback: null, debrief: null });
    expect(offen.json.simulation.finishError.code).toBe("ai_unavailable");
    expect(offen.json.simulation.turns).toHaveLength(7);

    // Zweiter Versuch: gelingt, mit neuer Kennung der Buchung (die erste ist zurückgegeben).
    judge.mockImplementation(async (a: JudgeArgs) => urteil(a));
    um(150);
    const zweiter = await api.finish(simId);
    expect(zweiter.status).toBe(202);
    await fertig();
    expect((await api.status(simId)).json).toMatchObject({ status: "finished", finishError: null });
    const get = await api.get(simId);
    expect(get.json.simulation).toMatchObject({ status: "finished", finishError: null });
    expect(get.json.simulation.debrief.verdict).toBe("passed");

    expect(ledger.spendKeys).toEqual([`sim-finish:${simId}:0`, `sim-finish:${simId}:1`]);
    expect(ledger.refundTx).toEqual([`tx-spend:sim-finish:${simId}:0`]);
    expect(ledger.balance).toBe(4);
    d = lauf(simId);
    expect(d.openCharge).toBeNull();
    expect(d.centralSpendTxId).toBe(`tx-spend:sim-finish:${simId}:1`);
    expect(d.chargeRefunds).toBe(1);
  });
});
