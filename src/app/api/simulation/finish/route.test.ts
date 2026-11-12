import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SimulationDoc } from "@/lib/server/simulation-store";

/**
 * Auswertung als Auftrag mit Status (Paket 3, 12.11.2026 — C4, U12, S7, S8) auf dem Geldweg aus Paket 2 (C3, C4, C8):
 * Anspruch sichern → buchen → sofort 202 → der Auftrag rechnet, speichert und schließt ab. Doppelstart bucht einmal;
 * Fehler im Richter → Rückbuchung, zurück auf `active`, `finishError`; hängender Lauf wird von GET status aufgeräumt;
 * freier Testlauf im Builder ohne Buchung; der Abgleich mit dem Check-in läuft genau einmal.
 * Echt sind die drei Routen (finish, status, checkin), `simulation-finish`, `simulation-finish-job` und
 * `entitlement`. Gemockt ist alles andere: der Lauf-Speicher und der Credit-Dienst sind kleine Nachbauten im
 * Speicher (kein Cosmos, kein Netz, keine KI). Der Nachbau des Credit-Dienstes hält sich an dessen Vertrag:
 * derselbe Schlüssel = dieselbe Buchung, Saldo wird VOR der Wiederholung geprüft, eine Buchung lässt sich genau
 * einmal zurückgeben. `after()` startet die Aufgabe sofort und merkt sie sich, damit die Tests auf ihr Ende warten.
 */

// ── Aufgaben neben der Antwort ───────────────────────────────────────────────
const hintergrund: Promise<unknown>[] = [];
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => Promise<unknown>) => {
    hintergrund.push(task());
  },
}));
/** Wartet, bis alle Aufträge und Abgleiche durch sind. */
const fertig = async () => {
  while (hintergrund.length) await hintergrund.shift();
};

const SIM = "sim-abcdefgh";
const RID = "rid-test-01";
const KEY0 = `sim-finish:${SIM}:0`;
const KEY1 = `sim-finish:${SIM}:1`;
const TX0 = `tx-spend:${KEY0}`;
const TX1 = `tx-spend:${KEY1}`;

// ── Lauf-Speicher im Speicher ────────────────────────────────────────────────
const store = new Map<string, SimulationDoc>();
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const saveSimulation = vi.fn();
/** true = jede Änderung trifft einmal auf einen Versionskonflikt: `mutate` läuft zweimal (erst verworfen, dann gespeichert). */
let konflikt = false;
/** Schreibfehler des Speichers: bekommt die laufende Nummer der Änderung im Test, true = diese Änderung wirft. */
let schreibStoerung: ((n: number) => boolean) | null = null;
let aenderungen = 0;
/**
 * Ein anderer Schreiber ändert den Lauf genau zwischen Lesen und Schreiben der NÄCHSTEN Änderung (einmalig):
 * Der erste Anlauf von `mutate` wird verworfen, der zweite sieht den geänderten Lauf.
 */
let dazwischen: (() => void) | null = null;

vi.mock("@/lib/server/simulation-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/simulation-store")>();
  return {
    ...real,
    getSimulation: async (uid: string, simId: string) => {
      const d = store.get(simId);
      return d && d.uid === uid ? clone(d) : null;
    },
    updateSimulation: async (uid: string, simId: string, mutate: (d: SimulationDoc) => void | false) => {
      aenderungen++;
      if (schreibStoerung?.(aenderungen)) throw new Error("Speicher nicht erreichbar");
      const d = store.get(simId);
      if (!d || d.uid !== uid) return null;
      const fremd = dazwischen;
      dazwischen = null;
      if (konflikt || fremd) mutate(clone(d));
      fremd?.();
      const fresh = clone(store.get(simId)!);
      if (mutate(fresh) === false) return fresh;
      store.set(simId, fresh);
      return clone(fresh);
    },
    saveSimulation: (...a: unknown[]) => saveSimulation(...a),
    latestTransferReview: async () => null,
    latestFinishedForScenario: async () => null,
  };
});

// ── Credit-Dienst im Speicher ────────────────────────────────────────────────
const ledger = {
  balance: 5,
  tx: new Map<string, { refunded: boolean }>(),
  spendKeys: [] as string[],
  refundTx: [] as string[],
  /** Vermerk am Lauf im Augenblick der Buchung (C8a: erst vermerken, dann buchen). */
  markAtSpend: [] as Array<SimulationDoc["openCharge"]>,
};
let spendMode: "ok" | "unklar" = "ok";
let refundOk = true;
let gateOn = true;

vi.mock("@/lib/server/credits/credit-service", () => ({
  creditsCentralEnabled: () => gateOn,
  centralWalletStatus: vi.fn(),
  centralReserve: async ({ runId }: { runId: string }) => {
    ledger.spendKeys.push(runId);
    ledger.markAtSpend.push(clone(store.get(SIM)?.openCharge ?? null));
    if (spendMode === "unklar") return { ok: false, reason: "error", unklar: true };
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
    if (!refundOk || !t) return { ok: false };
    if (!t.refunded) {
      t.refunded = true;
      ledger.balance += 1;
    }
    return { ok: true };
  },
}));
vi.mock("@/auth", () => ({ auth: async () => null }));

// ── Richter und Kompetenzen ──────────────────────────────────────────────────
const feedbackOf = (over: Record<string, unknown> = {}) => ({
  summary: "Du hast zugehört.",
  zielErreicht: null,
  rubric: [
    { key: "a", label: "A", evidence: ["Teilnehmer:in: Ich höre Dir zu."], why: "Du hast zugehört.", wentWell: [], tryNext: [], score: 3 },
    { key: "b", label: "B", evidence: ["Teilnehmer:in: Was brauchst Du?"], why: "Du hast gefragt.", wentWell: [], tryNext: [], score: 3 },
  ],
  checkpoints: [{ id: "x", hit: true, comment: "Kam vor." }],
  nextStep: "Frag früher nach.",
  nextStepKey: "a",
  focusReview: null,
  cards: [],
  microTransfer: { step: "Frag morgen zuerst nach.", when: "morgen" },
  sachlichNichtGedeckt: [],
  judge: "opus",
  ...over,
});
const richter = { judge: "opus", modelId: "claude-opus-5-5", fallback: null, tokensIn: 1200, tokensOut: 800, judgeMs: 42 };
const judge = vi.fn();
vi.mock("@/ai/flows/simulation-feedback", () => ({
  RICHTER_OPUS_TIMEOUT_MS: 110_000,
  judgeSimulation: (...a: unknown[]) => judge(...a),
}));
vi.mock("@/ai/flows/score-competencies", () => ({ scoreCompetencies: async () => ({ competencies: [] }) }));
vi.mock("@/ai/flows/simulation-regie", () => ({ regieVerlaufText: () => "" }));
// Abgleich „Selbstbild und Auswertung“ (S8): der kleine zweite KI-Schritt.
const ABGLEICH = { agreement: "partly", comment: "Du meintest, Du hättest ruhig begonnen — das stimmt." };
const selfReview = vi.fn();
vi.mock("@/ai/flows/simulation-selfreview", () => ({ CHECKIN_MAX_CHARS: 400, generateSelfReview: (...a: unknown[]) => selfReview(...a) }));

// ── Rest ─────────────────────────────────────────────────────────────────────
const rateLimit = vi.fn((..._a: unknown[]) => null);
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => rateLimit(...a) }));
vi.mock("@/lib/api-auth", () => ({ requireAuth: async () => ({ uid: "u1", email: "a@example.com", oid: "oid-1" }) }));
vi.mock("@/lib/server/cost-cap", () => ({ checkAndConsumeBudget: async () => ({ allowed: true }), estimateTokens: () => 1 }));
const scenario = {
  id: "sc-1",
  title: "Test",
  locale: "de",
  category: "feedback",
  persona: { name: "Alex" },
  assessment: {
    passThreshold: 0.6,
    checkPassThreshold: 0.7,
    competencies: [
      { key: "a", label: "A", weight: 50 },
      { key: "b", label: "B", weight: 50 },
    ],
    checkpoints: [{ id: "x", description: "Moment" }],
  },
};
const getScenarioForUser = vi.fn(async (..._a: unknown[]): Promise<unknown> => scenario);
// Freier Testlauf (Entscheid 5): Standard „kein Freilauf“, einzelne Tests lassen ihn gewinnen.
const claimFree = vi.fn(async (..._a: unknown[]): Promise<boolean> => false);
const releaseFree = vi.fn(async (..._a: unknown[]): Promise<boolean> => true);
vi.mock("@/lib/server/scenario-store", () => ({
  getScenarioForUser: (...a: unknown[]) => getScenarioForUser(...a),
  claimFreeTestEval: (...a: unknown[]) => claimFree(...a),
  releaseFreeTestEval: (...a: unknown[]) => releaseFree(...a),
}));
const radarEmit = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
vi.mock("@/lib/server/radar-emit", () => ({ emitCoachMeasurement: (...a: unknown[]) => radarEmit(...a), deleteCoachMeasurement: vi.fn() }));
const log = { api: vi.fn(), apiError: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock("@/lib/logger", () => ({ logger: log }));

function lauf(over: Partial<SimulationDoc> = {}): SimulationDoc {
  const t = (role: "user" | "persona", text: string) => ({ role, text, ts: "2026-11-12T10:00:00.000Z" });
  return {
    id: SIM,
    sessionId: "sim:u1",
    docType: "simulation",
    uid: "u1",
    scenarioId: "sc-1",
    createdAt: "2026-11-12T10:00:00.000Z",
    updatedAt: "2026-11-12T10:00:00.000Z",
    status: "active",
    turns: [t("persona", "Hallo."), t("user", "Ich höre Dir zu."), t("persona", "Gut."), t("user", "Was brauchst Du?"), t("persona", "Zeit."), t("user", "Die bekommst Du.")],
    attempt: 1,
    focus: null,
    ...over,
  };
}
const aktuell = () => store.get(SIM)!;
const post = (pfad: string, body: unknown) =>
  new NextRequest(`http://localhost/api/simulation/${pfad}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-request-id": RID } });
const finish = async (body: unknown = { simId: SIM }) => (await import("./route")).POST(post("finish", body));
const checkin = async (body: unknown) => (await import("../checkin/route")).POST(post("checkin", body));
const status = async (simId = SIM) => (await import("../status/route")).GET(new NextRequest(`http://localhost/api/simulation/status?simId=${simId}`));
const logged = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.map((c) => c.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")).join("\n");

/** Richter, der erst auf Zuruf antwortet — damit sich „während der Rechnung“ etwas am Lauf ändern kann. */
function wartenderRichter() {
  const offen: Array<{ ok: (v: unknown) => void; fehler: (e: unknown) => void }> = [];
  judge.mockImplementation(() => new Promise((ok, fehler) => offen.push({ ok, fehler })));
  return {
    offen,
    bis: (n: number) => vi.waitFor(() => expect(offen.length).toBeGreaterThanOrEqual(n)),
  };
}

beforeEach(() => {
  process.env.SIMULATION_ENABLED = "on";
  delete process.env.SIMULATION_RADAR_EMIT;
  delete process.env.COACH_RICHTER;
  store.clear();
  store.set(SIM, lauf());
  ledger.balance = 5;
  ledger.tx.clear();
  ledger.spendKeys = [];
  ledger.refundTx = [];
  ledger.markAtSpend = [];
  spendMode = "ok";
  refundOk = true;
  gateOn = true;
  konflikt = false;
  schreibStoerung = null;
  aenderungen = 0;
  dazwischen = null;
  hintergrund.length = 0;
  for (const m of [judge, selfReview, claimFree, releaseFree, radarEmit, saveSimulation, rateLimit, getScenarioForUser, ...Object.values(log)]) m.mockClear();
  rateLimit.mockImplementation(() => null);
  getScenarioForUser.mockImplementation(async () => scenario);
  judge.mockImplementation(async () => ({ feedback: feedbackOf(), richter }));
  selfReview.mockImplementation(async () => ABGLEICH);
  claimFree.mockImplementation(async () => false);
  releaseFree.mockImplementation(async () => true);
});

afterEach(async () => {
  // Kein Auftrag darf in den nächsten Test hineinlaufen.
  await fertig();
  vi.useRealTimers();
});

describe("POST /api/simulation/finish — Auftrag mit Status (C4)", () => {
  it("antwortet sofort mit 202; der Auftrag vermerkt, bucht, rechnet, speichert und schließt ab — ein Credit", async () => {
    const r = wartenderRichter();
    const res = await finish({ simId: SIM, selfAssessment: "Lief ganz gut." });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, status: "finishing" });
    await r.bis(1);

    // Während der Rechnung: Status `finishing`, Buchung steht als offen am Lauf.
    let d = aktuell();
    expect(d.status).toBe("finishing");
    expect(Date.parse(d.finishing!.since)).toBeGreaterThan(Date.now() - 5_000);
    expect(d.feedbackJson).toBeUndefined();
    // C4: Kennung aus Lauf und Versuch. C8a: der Vermerk stand schon, als gebucht wurde.
    expect(ledger.spendKeys).toEqual([KEY0]);
    expect(ledger.markAtSpend[0]).toMatchObject({ key: KEY0 });
    expect(ledger.markAtSpend[0]?.txId ?? null).toBeNull();
    expect(d.openCharge).toMatchObject({ key: KEY0, txId: TX0, workspaceId: "ws-1" });
    expect(ledger.balance).toBe(4);
    // S8: Der Richter bekommt kein Selbstbild; ein altes Feld im Körper wird überlesen.
    expect(judge.mock.calls[0][0]).not.toHaveProperty("selfAssessment");

    r.offen[0].ok({ feedback: feedbackOf(), richter });
    await fertig();
    d = aktuell();
    expect(d.status).toBe("finished");
    expect(d.finishing).toBeNull();
    expect(d.finishError).toBeNull();
    expect(d.finishedAt).toBeTruthy();
    expect(d.selfAssessment).toBeUndefined();
    expect((d.debriefJson as { verdict: string }).verdict).toBe("passed");
    expect(d.centralSpendTxId).toBe(TX0);
    expect(d.workspaceId).toBe("ws-1");
    // C8a: mit dem Speichern ausgetragen.
    expect(d.openCharge).toBeNull();
    expect(d.chargeRefunds ?? 0).toBe(0);
    expect(d.freeTestEval).toBeUndefined();
    expect(ledger.refundTx).toEqual([]);
    // C7/C17: der Richter, der wirklich geurteilt hat, und die Kennzahlen stehen am Lauf.
    expect(d.modelId).toBe("claude-opus-5-5");
    expect(d.evalStats).toMatchObject({ judge: "opus", fallback: null, tokensIn: 1200, tokensOut: 800, judgeMs: 42 });
    // C3: nie mehr die alte Kopie ganz überschreiben.
    expect(saveSimulation).not.toHaveBeenCalled();
    // C17: eine Protokollzeile mit den Kennzahlen, ohne Noten.
    const zeile = log.api.mock.calls.find((c) => c[1] === "evaluation");
    expect(zeile?.[2]).toMatchObject({ simId: SIM, judge: "opus", tokensIn: 1200, tokensOut: 800 });
    expect(JSON.stringify(zeile)).not.toContain("passed");
    expect(log.api.mock.calls.some((c) => c[1] === "complete")).toBe(true);
    // Ohne Check-in kein Abgleich.
    expect(selfReview).not.toHaveBeenCalled();
  });

  it("Doppelstart: zwei gleichzeitige Anfragen — beide 202, EINE Buchung, EINE Rechnung", async () => {
    const r = wartenderRichter();
    const [a, b] = await Promise.all([finish(), finish()]);
    expect([a.status, b.status]).toEqual([202, 202]);
    expect(await a.json()).toEqual({ ok: true, status: "finishing" });
    expect(await b.json()).toEqual({ ok: true, status: "finishing" });
    await r.bis(1);
    r.offen[0].ok({ feedback: feedbackOf(), richter });
    await fertig();

    expect(ledger.spendKeys).toEqual([KEY0]);
    expect(ledger.balance).toBe(4);
    expect(ledger.refundTx).toEqual([]);
    expect(judge).toHaveBeenCalledTimes(1);
    expect(aktuell()).toMatchObject({ status: "finished", centralSpendTxId: TX0, openCharge: null });
  });

  it("zweiter Aufruf während der Rechnung: 202 ohne Buchung und ohne zweiten Richter", async () => {
    const r = wartenderRichter();
    await finish();
    await r.bis(1);
    const res = await finish();
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, status: "finishing" });
    expect(ledger.spendKeys).toEqual([KEY0]);
    expect(judge).toHaveBeenCalledTimes(1);
    r.offen[0].ok({ feedback: feedbackOf(), richter });
    await fertig();
    expect(ledger.balance).toBe(4);
  });

  it("schon ausgewertet: 200 mit Status, kein zweiter Credit, kein Richter", async () => {
    await finish();
    await fertig();
    judge.mockClear();
    const res = await finish();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "finished" });
    expect(ledger.spendKeys).toEqual([KEY0]);
    expect(ledger.balance).toBe(4);
    expect(judge).not.toHaveBeenCalled();
  });

  it("C5: begrenzt je Person, nicht je Adresse", async () => {
    await finish();
    expect(rateLimit.mock.calls[0][0]).toBe("sim-finish:u1");
  });

  it("zu wenige Züge: 400, kein Anspruch, kein Vermerk, keine Buchung, kein Richter", async () => {
    store.set(SIM, lauf({ turns: lauf().turns.slice(0, 3) }));
    const res = await finish();
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("NOT_ENOUGH_TURNS");
    expect(ledger.spendKeys).toEqual([]);
    expect(aktuell().status).toBe("active");
    expect(aktuell().openCharge).toBeUndefined();
    expect(judge).not.toHaveBeenCalled();
  });

  it("unbekannter Lauf 404, unbekanntes Szenario 410 — beides ohne Anspruch", async () => {
    expect((await finish({ simId: "sim-unbekannt" })).status).toBe(404);
    getScenarioForUser.mockImplementation(async () => null);
    const res = await finish();
    expect(res.status).toBe(410);
    expect((await res.json()).code).toBe("UNKNOWN_SCENARIO");
    expect(aktuell().status).toBe("active");
    expect(ledger.spendKeys).toEqual([]);
  });

  it("abgebrochener Lauf: saubere Ablehnung, kein Credit", async () => {
    store.set(SIM, lauf({ status: "aborted" }));
    const res = await finish();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, code: "ABORTED" });
    expect(ledger.spendKeys).toEqual([]);
  });

  it("Fehler im Richter: Rückbuchung, zurück auf active, finishError mit Fehlerart und Fehler-Nr. — der nächste Start bucht mit neuer Kennung", async () => {
    judge.mockImplementation(async () => {
      throw new Error("Richter kaputt");
    });
    const res = await finish();
    expect(res.status).toBe(202);
    await fertig();
    expect(ledger.refundTx).toEqual([TX0]);
    expect(ledger.balance).toBe(5);
    let d = aktuell();
    expect(d.status).toBe("active");
    expect(d.finishing).toBeNull();
    expect(d.finishError).toMatchObject({ code: "ai_general", requestId: RID });
    expect(Date.parse(d.finishError!.at)).toBeGreaterThan(0);
    expect(d.feedbackJson).toBeUndefined();
    expect(d.openCharge).toBeNull();
    expect(d.chargeRefunds).toBe(1);

    // Neuer Versuch = neue Kaufentscheidung: Kennung :1 (mit :0 gälte die zurückgegebene Buchung als bezahlt).
    judge.mockImplementation(async () => ({ feedback: feedbackOf(), richter }));
    expect((await finish()).status).toBe(202);
    // Der alte Fehlschlag ist mit dem neuen Start gelöscht.
    expect(aktuell().finishError).toBeNull();
    await fertig();
    expect(ledger.spendKeys).toEqual([KEY0, KEY1]);
    expect(ledger.balance).toBe(4);
    d = aktuell();
    expect(d.status).toBe("finished");
    expect(d.centralSpendTxId).toBe(TX1);
    expect(d.finishError).toBeNull();
  });

  it("C8b: Rückbuchung scheitert → Vermerk bleibt mit Zeitpunkt, klare Protokollzeile; der nächste Start verwendet die Buchung wieder", async () => {
    judge.mockImplementation(async () => {
      throw new Error("Richter kaputt");
    });
    refundOk = false;
    await finish();
    await fertig();
    expect(ledger.balance).toBe(4);
    let d = aktuell();
    expect(d.status).toBe("active");
    expect(d.finishError).toMatchObject({ code: "ai_general" });
    expect(d.chargeRefunds ?? 0).toBe(0);
    expect(d.openCharge).toMatchObject({ key: KEY0, txId: TX0, workspaceId: "ws-1" });
    expect(d.openCharge?.refundFailedAt).toBeTruthy();
    expect(logged(log.error)).toContain("Rückbuchung der Auswertung gescheitert");

    // Der Credit ist weg, also zählt er für den nächsten Versuch: keine zweite Buchung (auch bei Saldo 0 kein 402).
    ledger.balance = 0;
    judge.mockImplementation(async () => ({ feedback: feedbackOf(), richter }));
    expect((await finish()).status).toBe(202);
    await fertig();
    expect(ledger.spendKeys).toEqual([KEY0]);
    d = aktuell();
    expect(d.status).toBe("finished");
    expect(d.centralSpendTxId).toBe(TX0);
    expect(d.openCharge).toBeNull();
    // Den freien Testlauf fragt ein Lauf mit vorhandener Buchung gar nicht erst an.
    expect(claimFree).toHaveBeenCalledTimes(1);
  });

  it("C8c: Buchung ohne klare Antwort → 503, Lauf wieder active, Vermerk bleibt; der spätere Start trifft dieselbe Kennung", async () => {
    spendMode = "unklar";
    const res = await finish();
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("CENTRAL_UNAVAILABLE");
    let d = aktuell();
    expect(d.status).toBe("active");
    expect(d.finishing).toBeNull();
    // Kein Fehlschlag der Auswertung: Den Grund trägt die Antwort.
    expect(d.finishError).toBeNull();
    expect(d.openCharge).toMatchObject({ key: KEY0 });
    expect(logged(log.warn)).toContain("ohne klare Antwort");
    expect(judge).not.toHaveBeenCalled();

    spendMode = "ok";
    expect((await finish()).status).toBe(202);
    await fertig();
    expect(ledger.spendKeys).toEqual([KEY0, KEY0]);
    expect(ledger.balance).toBe(4);
    d = aktuell();
    expect(d.status).toBe("finished");
    expect(d.openCharge).toBeNull();
  });

  it("klare Ablehnung (kein Guthaben): 402, Lauf wieder active, der eigene Vermerk ist weg", async () => {
    ledger.balance = 0;
    const res = await finish();
    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe("INSUFFICIENT_CREDITS");
    const d = aktuell();
    expect(d.status).toBe("active");
    expect(d.finishing).toBeNull();
    expect(d.finishError).toBeNull();
    expect(d.openCharge).toBeNull();
    expect(judge).not.toHaveBeenCalled();
  });

  it("C3: Versionskonflikt bei jedem Schreiben (Änderung wird wiederholt) — gleiches Ergebnis, ein Credit, Zähler stimmt", async () => {
    konflikt = true;
    expect((await finish()).status).toBe(202);
    await fertig();
    expect(ledger.spendKeys).toEqual([KEY0]);
    expect(ledger.balance).toBe(4);
    expect(aktuell()).toMatchObject({ status: "finished", centralSpendTxId: TX0, openCharge: null });

    // Und der Fehlerweg: genau eine Rückbuchung, Zähler genau 1.
    store.set(SIM, lauf());
    judge.mockImplementation(async () => {
      throw new Error("Richter kaputt");
    });
    await finish();
    await fertig();
    expect(ledger.refundTx).toEqual([TX0]);
    expect(aktuell()).toMatchObject({ status: "active", chargeRefunds: 1, openCharge: null, finishError: { code: "ai_general" } });
  });

  it("ohne Credit-Tor (lokal): keine Buchung, kein Vermerk, kein Freilauf — die Auswertung wird gespeichert", async () => {
    gateOn = false;
    expect((await finish()).status).toBe(202);
    await fertig();
    expect(ledger.spendKeys).toEqual([]);
    expect(claimFree).not.toHaveBeenCalled();
    const d = aktuell();
    expect(d.status).toBe("finished");
    expect(d.centralSpendTxId).toBeUndefined();
  });

  it("Radar-Messpunkt: nur mit Schalter und nur für eine bezahlte, gespeicherte Auswertung — der Auftrag schreibt ihn, nicht mehr die Route", async () => {
    await finish();
    await fertig();
    expect(radarEmit).not.toHaveBeenCalled();

    process.env.SIMULATION_RADAR_EMIT = "on";
    store.set(SIM, lauf());
    await finish();
    await fertig();
    expect(radarEmit).toHaveBeenCalledTimes(1);
    expect(radarEmit.mock.calls[0][0]).toMatchObject({ workspaceId: "ws-1", subjectId: "oid-1", runId: SIM, szenarioId: "sc-1", bestanden: true });
    expect((radarEmit.mock.calls[0][0] as { rubric: Array<{ key: string; weight: number }> }).rubric.map((r) => [r.key, r.weight])).toEqual([["a", 50], ["b", 50]]);

    // Gescheiterte Auswertung und freier Testlauf: kein Messpunkt.
    radarEmit.mockClear();
    store.set(SIM, lauf());
    judge.mockImplementation(async () => {
      throw new Error("Richter kaputt");
    });
    await finish();
    await fertig();
    store.set(SIM, lauf());
    judge.mockImplementation(async () => ({ feedback: feedbackOf(), richter }));
    claimFree.mockImplementation(async () => true);
    await finish();
    await fertig();
    expect(aktuell()).toMatchObject({ status: "finished", freeTestEval: true });
    expect(radarEmit).not.toHaveBeenCalled();
  });

  it("Lauf wird während der Rechnung abgebrochen: nichts überschrieben, Rückbuchung, Lauf bleibt abgebrochen", async () => {
    const r = wartenderRichter();
    await finish();
    await r.bis(1);
    store.set(SIM, { ...aktuell(), status: "aborted" });
    r.offen[0].ok({ feedback: feedbackOf(), richter });
    await fertig();
    expect(ledger.refundTx).toEqual([TX0]);
    expect(ledger.balance).toBe(5);
    const d = aktuell();
    expect(d.status).toBe("aborted");
    expect(d.feedbackJson).toBeUndefined();
    expect(d.openCharge).toBeNull();
    expect(d.chargeRefunds).toBe(1);
    expect(log.api.mock.calls.some((c) => c[1] === "ended-elsewhere")).toBe(true);
  });

  it("die Buchung wurde während der Rechnung von anderer Stelle zurückgegeben: nie eine Auswertung auf zurückgegebener Buchung, keine zweite Rückbuchung", async () => {
    const r = wartenderRichter();
    await finish();
    await r.bis(1);
    ledger.tx.get(TX0)!.refunded = true;
    ledger.balance = 5;
    store.set(SIM, { ...aktuell(), chargeRefunds: 1, openCharge: null });
    r.offen[0].ok({ feedback: feedbackOf(), richter });
    await fertig();
    const d = aktuell();
    expect(d.status).toBe("active");
    expect(d.feedbackJson).toBeUndefined();
    expect(d.finishError).toMatchObject({ code: "ai_general" });
    expect(d.chargeRefunds).toBe(1);
    expect(ledger.refundTx).toEqual([]);
    expect(ledger.balance).toBe(5);
  });

  it("Fehler zwischen Anspruch und Auftrag: Lauf geht zurück auf active, die Antwort trägt die Fehler-Nr.", async () => {
    claimFree.mockImplementation(async () => true);
    // Änderung 1 sichert den Anspruch; Änderung 2 (Vermerk des Freilaufs) und 3 (Vermerk der Buchung) scheitern.
    schreibStoerung = (n) => n === 2 || n === 3;
    const res = await finish();
    expect(res.ok).toBe(false);
    expect((await res.json()).ok).toBe(false);
    await fertig();
    // Der Freilauf ist zurück, nichts ist gebucht, der Lauf lässt sich neu auswerten.
    expect(releaseFree).toHaveBeenCalledTimes(1);
    expect(ledger.spendKeys).toEqual([]);
    expect(aktuell().status).toBe("active");
    expect(judge).not.toHaveBeenCalled();
  });
});

describe("POST /api/simulation/finish — freier Testlauf im Builder (Entscheid 5)", () => {
  it("Freilauf gewonnen: keine Buchung, kein Vermerk, am Lauf steht freeTestEval", async () => {
    claimFree.mockImplementation(async () => true);
    const r = wartenderRichter();
    expect((await finish()).status).toBe(202);
    await r.bis(1);
    expect(claimFree).toHaveBeenCalledWith("u1", "oid-1", "sc-1");
    // Der Vermerk steht schon während der Rechnung — daran erkennt der Aufräumer den Freilauf.
    expect(aktuell()).toMatchObject({ status: "finishing", freeTestEval: true });
    r.offen[0].ok({ feedback: feedbackOf(), richter });
    await fertig();

    expect(ledger.spendKeys).toEqual([]);
    expect(ledger.balance).toBe(5);
    const d = aktuell();
    expect(d.status).toBe("finished");
    expect(d.freeTestEval).toBe(true);
    expect(d.centralSpendTxId).toBeUndefined();
    expect(d.openCharge ?? null).toBeNull();
    expect(releaseFree).not.toHaveBeenCalled();
  });

  it("Auswertung scheitert: der Freilauf geht zurück, nichts wird zurückgebucht", async () => {
    claimFree.mockImplementation(async () => true);
    judge.mockImplementation(async () => {
      throw new Error("Richter kaputt");
    });
    await finish();
    await fertig();
    expect(releaseFree).toHaveBeenCalledTimes(1);
    expect(releaseFree).toHaveBeenCalledWith("u1", "oid-1", "sc-1");
    expect(ledger.refundTx).toEqual([]);
    const d = aktuell();
    expect(d.status).toBe("active");
    expect(d.freeTestEval).toBe(false);
    expect(d.finishError).toMatchObject({ code: "ai_general" });
    expect(d.chargeRefunds ?? 0).toBe(0);
  });

  it("kein Freilauf (oder Freilauf nicht lesbar): es wird normal gebucht", async () => {
    claimFree.mockImplementation(async () => {
      throw new Error("Cosmos nicht erreichbar");
    });
    await finish();
    await fertig();
    expect(ledger.spendKeys).toEqual([KEY0]);
    expect(aktuell()).toMatchObject({ status: "finished", centralSpendTxId: TX0 });
    expect(aktuell().freeTestEval).toBeUndefined();
  });

  it("Lauf wird abgebrochen, während der Freilauf beansprucht wird: Freilauf zurück, keine Buchung, saubere Ablehnung", async () => {
    claimFree.mockImplementation(async () => {
      store.set(SIM, { ...aktuell(), status: "aborted" });
      return true;
    });
    const res = await finish();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, code: "ABORTED" });
    expect(releaseFree).toHaveBeenCalledTimes(1);
    expect(ledger.spendKeys).toEqual([]);
    expect(judge).not.toHaveBeenCalled();
  });
});

describe("Auftrag und Check-in — der Abgleich läuft genau einmal (S8)", () => {
  const antworten = { simId: SIM, gut: "Ich habe ruhig begonnen.", anders: "Früher nachfragen." };

  it("Check-in VOR dem Ende der Rechnung: gespeichert ohne Abgleich; der Auftrag gleicht nach dem Speichern ab", async () => {
    const r = wartenderRichter();
    await finish();
    await r.bis(1);
    const res = await checkin(antworten);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "finishing" });
    await Promise.resolve();
    expect(selfReview).not.toHaveBeenCalled();
    expect(aktuell().checkin).toMatchObject({ gut: "Ich habe ruhig begonnen.", anders: "Früher nachfragen.", skipped: false });
    expect(aktuell().selfAssessment).toBe("Ich habe ruhig begonnen. · Früher nachfragen.");

    r.offen[0].ok({ feedback: feedbackOf({ summary: "Die Auswertung." }), richter });
    await fertig();
    expect(selfReview).toHaveBeenCalledTimes(1);
    const eingabe = selfReview.mock.calls[0][0] as { gut: string; anders: string; feedback: { summary: string }; debrief: { verdict: string } };
    expect(eingabe).toMatchObject({ gut: "Ich habe ruhig begonnen.", anders: "Früher nachfragen." });
    // Grundlage ist die FERTIGE Auswertung.
    expect(eingabe.feedback.summary).toBe("Die Auswertung.");
    expect(eingabe.debrief.verdict).toBe("passed");
    const d = aktuell();
    expect(d.status).toBe("finished");
    expect((d.feedbackJson as { selfReview: unknown }).selfReview).toEqual(ABGLEICH);
    // Der Check-in hat die Auswertung nicht berührt und umgekehrt.
    expect(d.checkin).toMatchObject({ gut: "Ich habe ruhig begonnen." });
    expect((d.feedbackJson as { summary: string }).summary).toBe("Die Auswertung.");

    // Ein zweiter Check-in überschreibt nichts und löst nichts mehr aus.
    expect((await checkin({ simId: SIM, gut: "Etwas anderes." })).status).toBe(200);
    await fertig();
    expect(aktuell().checkin).toMatchObject({ gut: "Ich habe ruhig begonnen." });
    expect(selfReview).toHaveBeenCalledTimes(1);
  });

  it("Check-in trifft genau zwischen Lesen und Schreiben des Auftrags ein: Der Auftrag sieht ihn beim Wiederholen, überschreibt ihn nicht und gleicht ab — einmal", async () => {
    const r = wartenderRichter();
    await finish();
    await r.bis(1);
    // Die nächste Änderung am Lauf ist das Speichern der Auswertung; der Check-in schreibt genau davor.
    dazwischen = () => {
      store.set(SIM, { ...aktuell(), checkin: { gut: "Ich habe ruhig begonnen.", anders: null, skipped: false, at: "2026-11-12T10:20:00.000Z" }, selfAssessment: "Ich habe ruhig begonnen." });
    };
    r.offen[0].ok({ feedback: feedbackOf(), richter });
    await fertig();
    const d = aktuell();
    expect(d.status).toBe("finished");
    expect(d.checkin).toMatchObject({ gut: "Ich habe ruhig begonnen." });
    expect(d.selfAssessment).toBe("Ich habe ruhig begonnen.");
    expect(selfReview).toHaveBeenCalledTimes(1);
    expect((d.feedbackJson as { selfReview: unknown }).selfReview).toEqual(ABGLEICH);
  });

  it("Check-in NACH dem Ende der Rechnung: die Route stößt den Abgleich an — einmal", async () => {
    await finish();
    await fertig();
    expect(selfReview).not.toHaveBeenCalled();
    expect((aktuell().feedbackJson as { selfReview?: unknown }).selfReview).toBeUndefined();

    const res = await checkin(antworten);
    expect(await res.json()).toEqual({ ok: true, status: "finished" });
    await fertig();
    expect(selfReview).toHaveBeenCalledTimes(1);
    expect((aktuell().feedbackJson as { selfReview: unknown }).selfReview).toEqual(ABGLEICH);

    await checkin(antworten);
    await fertig();
    expect(selfReview).toHaveBeenCalledTimes(1);
  });

  it("übersprungen: gespeichert, kein Abgleich — weder vom Auftrag noch von der Route", async () => {
    const r = wartenderRichter();
    await finish();
    await r.bis(1);
    await checkin({ simId: SIM, skipped: true });
    r.offen[0].ok({ feedback: feedbackOf(), richter });
    await fertig();
    expect(aktuell().checkin).toMatchObject({ gut: null, anders: null, skipped: true });
    expect(aktuell().selfAssessment).toBeNull();
    expect(selfReview).not.toHaveBeenCalled();
    expect(aktuell().status).toBe("finished");
  });

  it("Abgleich scheitert: nur die Karte fehlt, die Auswertung steht", async () => {
    selfReview.mockImplementation(async () => {
      throw new Error("Frist");
    });
    await finish();
    await fertig();
    await checkin(antworten);
    await fertig();
    const d = aktuell();
    expect(d.status).toBe("finished");
    expect((d.feedbackJson as { selfReview?: unknown }).selfReview).toBeUndefined();
    expect(ledger.refundTx).toEqual([]);
    expect(log.apiError.mock.calls.some((c) => c[0] === "/api/simulation/checkin/self-review")).toBe(true);
  });

  it("Rechnung scheitert, bevor der Check-in kommt: die Antworten zählen für den nächsten Versuch", async () => {
    judge.mockImplementation(async () => {
      throw new Error("Richter kaputt");
    });
    await finish();
    await fertig();
    const res = await checkin(antworten);
    expect(await res.json()).toEqual({ ok: true, status: "active" });
    expect(selfReview).not.toHaveBeenCalled();

    judge.mockImplementation(async () => ({ feedback: feedbackOf(), richter }));
    await finish();
    await fertig();
    expect(selfReview).toHaveBeenCalledTimes(1);
    expect((aktuell().feedbackJson as { selfReview: unknown }).selfReview).toEqual(ABGLEICH);
  });
});

describe("GET /api/simulation/status — hängengebliebener Lauf wird aufgeräumt", () => {
  const vor = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const haengt = (over: Partial<SimulationDoc> = {}) => lauf({ status: "finishing", finishing: { since: vor(7) }, ...over });
  const gebucht = () => {
    ledger.balance = 4;
    ledger.tx.set(TX0, { refunded: false });
    return { key: KEY0, at: vor(7), txId: TX0, workspaceId: "ws-1" };
  };

  it("gebucht, Prozess endete mitten in der Rechnung: Rückbuchung, zurück auf active, STALE — der nächste Start bucht neu", async () => {
    store.set(SIM, haengt({ openCharge: gebucht() }));
    const json = await (await status()).json();
    expect(json).toMatchObject({ ok: true, status: "active", startedAt: null });
    expect(json.finishError).toMatchObject({ code: "STALE", requestId: null });
    expect(ledger.refundTx).toEqual([TX0]);
    expect(ledger.balance).toBe(5);
    expect(aktuell()).toMatchObject({ status: "active", finishing: null, chargeRefunds: 1, openCharge: null });
    expect(logged(log.warn)).toContain("hing länger als 6 Minuten");

    // Zweite Abfrage: nichts mehr zu tun.
    expect((await (await status()).json()).finishError.code).toBe("STALE");
    expect(ledger.refundTx).toEqual([TX0]);

    // „Noch einmal auswerten“: neue Kennung, der alte Fehlschlag ist gelöscht.
    expect((await finish()).status).toBe(202);
    await fertig();
    expect(ledger.spendKeys).toEqual([KEY1]);
    expect(aktuell()).toMatchObject({ status: "finished", centralSpendTxId: TX1, finishError: null });
    expect(ledger.balance).toBe(4);
  });

  it("zwei Abfragen gleichzeitig: genau eine Rückbuchung", async () => {
    store.set(SIM, haengt({ openCharge: gebucht() }));
    await Promise.all([status(), status()]);
    expect(ledger.refundTx).toEqual([TX0]);
    expect(ledger.balance).toBe(5);
    expect(aktuell()).toMatchObject({ status: "active", chargeRefunds: 1 });
  });

  it("junger Lauf in finishing bleibt unberührt: Status, Beginn und erwartete Dauer", async () => {
    const since = vor(1);
    store.set(SIM, lauf({ status: "finishing", finishing: { since }, openCharge: gebucht() }));
    expect(await (await status()).json()).toEqual({ ok: true, status: "finishing", finishError: null, startedAt: since, typicalMs: 20_000 });
    expect(ledger.refundTx).toEqual([]);
    expect(aktuell().status).toBe("finishing");
  });

  it("Rückbuchung scheitert: trotzdem zurück auf active, der Vermerk bleibt — der nächste Start verwendet die Buchung wieder", async () => {
    store.set(SIM, haengt({ openCharge: gebucht() }));
    refundOk = false;
    expect((await (await status()).json()).status).toBe("active");
    const d = aktuell();
    expect(d.chargeRefunds ?? 0).toBe(0);
    expect(d.openCharge).toMatchObject({ key: KEY0, txId: TX0 });
    expect(d.openCharge?.refundFailedAt).toBeTruthy();

    refundOk = true;
    await finish();
    await fertig();
    expect(ledger.spendKeys).toEqual([]);
    expect(aktuell()).toMatchObject({ status: "finished", centralSpendTxId: TX0, openCharge: null });
  });

  it("Buchung ohne Buchungsnummer (Prozess endete vor der Antwort): nichts zurückzugeben, Vermerk bleibt", async () => {
    store.set(SIM, haengt({ openCharge: { key: KEY0, at: vor(7) } }));
    expect((await (await status()).json()).finishError.code).toBe("STALE");
    expect(ledger.refundTx).toEqual([]);
    expect(aktuell()).toMatchObject({ status: "active", openCharge: { key: KEY0 } });
    expect(aktuell().chargeRefunds ?? 0).toBe(0);
  });

  it("freier Testlauf: der Freilauf geht zurück; ohne Vermerk nur der Status", async () => {
    store.set(SIM, haengt({ freeTestEval: true }));
    await status();
    expect(releaseFree).toHaveBeenCalledWith("u1", "oid-1", "sc-1");
    expect(aktuell()).toMatchObject({ status: "active", freeTestEval: false, finishError: { code: "STALE" } });

    releaseFree.mockClear();
    store.set(SIM, haengt());
    await status();
    expect(releaseFree).not.toHaveBeenCalled();
    expect(ledger.refundTx).toEqual([]);
    expect(aktuell()).toMatchObject({ status: "active", finishError: { code: "STALE" } });
  });

  it("der Auftrag kommt nach dem Aufräumen doch noch an: Er speichert nichts und bucht nicht ein zweites Mal zurück", async () => {
    const r = wartenderRichter();
    await finish();
    await r.bis(1);
    // Sieben Minuten später (nur die Uhr springt): Die Abfrage räumt auf, der Auftrag rechnet noch.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 7 * 60_000);
    expect((await (await status()).json()).finishError.code).toBe("STALE");
    expect(ledger.refundTx).toEqual([TX0]);
    r.offen[0].ok({ feedback: feedbackOf(), richter });
    await fertig();
    const d = aktuell();
    expect(d.status).toBe("active");
    expect(d.feedbackJson).toBeUndefined();
    expect(d.finishError).toMatchObject({ code: "STALE" });
    expect(d.chargeRefunds).toBe(1);
    expect(ledger.refundTx).toEqual([TX0]);
    expect(ledger.balance).toBe(5);
  });
});

describe("POST /api/simulation/finish — Urteil im Prüfungsmodus (C6)", () => {
  const schwach = () =>
    feedbackOf({
      zielErreicht: true,
      rubric: feedbackOf().rubric.map((x) => ({ ...x, score: 2 })),
      checkpoints: [{ id: "x", hit: false, comment: "Fehlte." }],
    });
  const debrief = () => aktuell().debriefJson as { overall: number; verdict: string; verdictGrund: string; ergebnis: string; passMarkPct: number };

  it("Übung: Ziel erreicht → bestanden, auch unter der Punktegrenze", async () => {
    judge.mockImplementation(async () => ({ feedback: schwach(), richter }));
    await finish();
    await fertig();
    expect(debrief().overall).toBeLessThan(60);
    expect(debrief()).toMatchObject({ verdict: "passed", verdictGrund: "ziel", ergebnis: "ziel" });
  });

  it("Prüfung: Ziel erreicht, Mindestpunktzahl fehlt → nicht bestanden; das Ergebnis „ziel“ bleibt stehen", async () => {
    store.set(SIM, lauf({ mode: "check" }));
    judge.mockImplementation(async () => ({ feedback: schwach(), richter }));
    await finish();
    await fertig();
    expect(debrief().passMarkPct).toBe(70);
    expect(debrief()).toMatchObject({ verdict: "failed", verdictGrund: "punkte", ergebnis: "ziel" });
  });
});
