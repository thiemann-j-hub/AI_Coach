import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SimulationDoc } from "@/lib/server/simulation-store";

/**
 * Geldweg der Auswertung (Paket 2, 12.11.2026 — C3, C4, C8, C23): buchen → rechnen → speichern → abschließen;
 * Fehler im Richter → Rückbuchung; schon ausgewertet → kein zweiter Credit; Lauf während der Rechnung von anderer
 * Stelle beendet → nichts überschreiben; zu wenige Züge. Alles außer Route, `simulation-finish` und `entitlement`
 * ist gemockt: der Lauf-Speicher und der Credit-Dienst sind kleine Nachbauten im Speicher (kein Cosmos, kein Netz,
 * keine KI). Der Nachbau des Credit-Dienstes hält sich an dessen Vertrag: derselbe Schlüssel = dieselbe Buchung,
 * Saldo wird VOR der Wiederholung geprüft, eine Buchung lässt sich genau einmal zurückgeben.
 */

const SIM = "sim-abcdefgh";
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

vi.mock("@/lib/server/simulation-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/simulation-store")>();
  return {
    ...real,
    getSimulation: async (uid: string, simId: string) => {
      const d = store.get(simId);
      return d && d.uid === uid ? clone(d) : null;
    },
    updateSimulation: async (uid: string, simId: string, mutate: (d: SimulationDoc) => void | false) => {
      const d = store.get(simId);
      if (!d || d.uid !== uid) return null;
      if (konflikt) mutate(clone(d));
      const fresh = clone(d);
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
  selfReview: null,
  cards: [],
  microTransfer: { step: "Frag morgen zuerst nach.", when: "morgen" },
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
vi.mock("@/lib/server/scenario-store", () => ({ getScenarioForUser: (...a: unknown[]) => getScenarioForUser(...a) }));
vi.mock("@/lib/server/radar-emit", () => ({ emitCoachMeasurement: vi.fn(async () => ({ ok: true })), deleteCoachMeasurement: vi.fn() }));
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
const post = (body: unknown = { simId: SIM }) =>
  new NextRequest("http://localhost/api/simulation/finish", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const finish = async (body?: unknown) => (await import("./route")).POST(post(body));
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
  for (const m of [judge, saveSimulation, rateLimit, getScenarioForUser, ...Object.values(log)]) m.mockClear();
  rateLimit.mockImplementation(() => null);
  getScenarioForUser.mockImplementation(async () => scenario);
  judge.mockImplementation(async () => ({ feedback: feedbackOf(), richter }));
});

describe("POST /api/simulation/finish — Geldweg", () => {
  it("vermerkt, bucht, rechnet, speichert und schließt ab; ein Credit, Antwortformat wie bisher", async () => {
    const res = await finish({ simId: SIM, selfAssessment: "Lief ganz gut." });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(Object.keys(json).sort()).toEqual(
      ["attempt", "competencyError", "competencyRatings", "debrief", "delta", "feedback", "focus", "hardness", "mode", "ok", "selfAssessment"].sort()
    );
    expect(json.ok).toBe(true);
    expect(json.debrief.verdict).toBe("passed");

    // C4: Kennung aus Lauf und Versuch. C8a: der Vermerk stand schon, als gebucht wurde.
    expect(ledger.spendKeys).toEqual([KEY0]);
    expect(ledger.markAtSpend[0]).toMatchObject({ key: KEY0 });
    expect(ledger.markAtSpend[0]?.txId ?? null).toBeNull();
    expect(ledger.balance).toBe(4);
    expect(ledger.refundTx).toEqual([]);

    const d = aktuell();
    expect(d.status).toBe("finished");
    expect(d.selfAssessment).toBe("Lief ganz gut.");
    expect(d.centralSpendTxId).toBe(TX0);
    expect(d.workspaceId).toBe("ws-1");
    // C8a: mit dem Speichern ausgetragen.
    expect(d.openCharge).toBeNull();
    expect(d.chargeRefunds ?? 0).toBe(0);
    // C7/C17: der Richter, der wirklich geurteilt hat, und die Kennzahlen stehen am Lauf.
    expect(d.modelId).toBe("claude-opus-5-5");
    expect(d.evalStats).toMatchObject({ judge: "opus", fallback: null, tokensIn: 1200, tokensOut: 800, judgeMs: 42 });
    // C3: nie mehr die alte Kopie ganz überschreiben.
    expect(saveSimulation).not.toHaveBeenCalled();
    // C17: eine Protokollzeile mit den Kennzahlen, ohne Noten.
    const zeile = log.api.mock.calls.find((c) => c[1] === "evaluation");
    expect(zeile?.[2]).toMatchObject({ simId: SIM, judge: "opus", tokensIn: 1200, tokensOut: 800 });
    expect(JSON.stringify(zeile)).not.toContain("passed");
  });

  it("C5: begrenzt je Person, nicht je Adresse", async () => {
    await finish();
    expect(rateLimit.mock.calls[0][0]).toBe("sim-finish:u1");
  });

  it("zu wenige Züge: 400, kein Vermerk, keine Buchung, kein Richter", async () => {
    store.set(SIM, lauf({ turns: lauf().turns.slice(0, 3) }));
    const res = await finish();
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("NOT_ENOUGH_TURNS");
    expect(ledger.spendKeys).toEqual([]);
    expect(aktuell().openCharge).toBeUndefined();
    expect(judge).not.toHaveBeenCalled();
  });

  it("schon ausgewertet: vorhandenes Ergebnis, kein zweiter Credit, kein Richter", async () => {
    await finish();
    judge.mockClear();
    const res = await finish();
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, alreadyFinished: true });
    expect(json.feedback.summary).toBe("Du hast zugehört.");
    expect(ledger.spendKeys).toEqual([KEY0]);
    expect(ledger.balance).toBe(4);
    expect(judge).not.toHaveBeenCalled();
  });

  it("abgebrochener Lauf: saubere Ablehnung, kein Credit", async () => {
    store.set(SIM, lauf({ status: "aborted" }));
    const res = await finish();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, code: "ABORTED" });
    expect(ledger.spendKeys).toEqual([]);
  });

  it("Fehler im Richter: Rückbuchung, Vermerk weg, Zähler 1 — der nächste Klick bucht mit neuer Kennung", async () => {
    judge.mockImplementation(async () => {
      throw new Error("Richter kaputt");
    });
    const res = await finish();
    expect(res.ok).toBe(false);
    expect((await res.json()).ok).toBe(false);
    expect(ledger.refundTx).toEqual([TX0]);
    expect(ledger.balance).toBe(5);
    let d = aktuell();
    expect(d.status).toBe("active");
    expect(d.feedbackJson).toBeUndefined();
    expect(d.openCharge).toBeNull();
    expect(d.chargeRefunds).toBe(1);

    // Neuer Versuch = neue Kaufentscheidung: Kennung :1 (mit :0 gälte die zurückgegebene Buchung als bezahlt).
    judge.mockImplementation(async () => ({ feedback: feedbackOf(), richter }));
    expect((await finish()).status).toBe(200);
    expect(ledger.spendKeys).toEqual([KEY0, KEY1]);
    expect(ledger.balance).toBe(4);
    d = aktuell();
    expect(d.status).toBe("finished");
    expect(d.centralSpendTxId).toBe(TX1);
  });

  it("C8b: Rückbuchung scheitert → Vermerk bleibt mit Zeitpunkt, klare Protokollzeile; der nächste Klick verwendet die Buchung wieder", async () => {
    judge.mockImplementation(async () => {
      throw new Error("Richter kaputt");
    });
    refundOk = false;
    await finish();
    expect(ledger.balance).toBe(4);
    let d = aktuell();
    expect(d.status).toBe("active");
    expect(d.chargeRefunds ?? 0).toBe(0);
    expect(d.openCharge).toMatchObject({ key: KEY0, txId: TX0, workspaceId: "ws-1" });
    expect(d.openCharge?.refundFailedAt).toBeTruthy();
    expect(logged(log.error)).toContain("Rückbuchung der Auswertung gescheitert");

    // Der Credit ist weg, also zählt er für den nächsten Versuch: keine zweite Buchung.
    judge.mockImplementation(async () => ({ feedback: feedbackOf(), richter }));
    expect((await finish()).status).toBe(200);
    expect(ledger.spendKeys).toEqual([KEY0]);
    expect(ledger.balance).toBe(4);
    d = aktuell();
    expect(d.status).toBe("finished");
    expect(d.centralSpendTxId).toBe(TX0);
    expect(d.openCharge).toBeNull();
  });

  it("C8c: Buchung ohne klare Antwort → 503, Vermerk bleibt; der spätere Klick trifft dieselbe Kennung", async () => {
    spendMode = "unklar";
    const res = await finish();
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("CENTRAL_UNAVAILABLE");
    expect(aktuell().openCharge).toMatchObject({ key: KEY0 });
    expect(logged(log.warn)).toContain("ohne klare Antwort");
    expect(judge).not.toHaveBeenCalled();

    spendMode = "ok";
    expect((await finish()).status).toBe(200);
    expect(ledger.spendKeys).toEqual([KEY0, KEY0]);
    expect(ledger.balance).toBe(4);
    expect(aktuell().openCharge).toBeNull();
  });

  it("klare Ablehnung (kein Guthaben): 402, der eigene Vermerk ist wieder weg", async () => {
    ledger.balance = 0;
    const res = await finish();
    expect(res.status).toBe(402);
    expect(aktuell().openCharge).toBeNull();
    expect(aktuell().status).toBe("active");
    expect(judge).not.toHaveBeenCalled();
  });

  it("C3: Versionskonflikt bei jedem Schreiben (Änderung wird wiederholt) — gleiches Ergebnis, ein Credit, Zähler stimmt", async () => {
    konflikt = true;
    expect((await finish()).status).toBe(200);
    expect(ledger.spendKeys).toEqual([KEY0]);
    expect(ledger.balance).toBe(4);
    expect(aktuell()).toMatchObject({ status: "finished", centralSpendTxId: TX0, openCharge: null });

    // Und der Fehlerweg: genau eine Rückbuchung, Zähler genau 1.
    store.set(SIM, lauf());
    judge.mockImplementation(async () => {
      throw new Error("Richter kaputt");
    });
    await finish();
    expect(ledger.refundTx).toEqual([TX0]);
    expect(aktuell()).toMatchObject({ status: "active", chargeRefunds: 1, openCharge: null });
  });

  it("ohne Credit-Tor (lokal): keine Buchung, kein Vermerk, Auswertung wird gespeichert", async () => {
    gateOn = false;
    expect((await finish()).status).toBe(200);
    expect(ledger.spendKeys).toEqual([]);
    const d = aktuell();
    expect(d.status).toBe("finished");
    expect(d.centralSpendTxId).toBeUndefined();
  });
});

describe("POST /api/simulation/finish — zwei Anfragen, ein Lauf", () => {
  it("C4: zwei gleichzeitige Anfragen treffen dieselbe Buchung — ein Credit, eine Auswertung, keine Rückbuchung", async () => {
    const r = wartenderRichter();
    const a = finish();
    const b = finish();
    await r.bis(2);
    expect(new Set(ledger.spendKeys)).toEqual(new Set([KEY0]));
    expect(ledger.balance).toBe(4);

    r.offen[0].ok({ feedback: feedbackOf({ summary: "Erste Auswertung." }), richter });
    const ja = await (await a).json();
    r.offen[1].ok({ feedback: feedbackOf({ summary: "Zweite Auswertung." }), richter });
    const jb = await (await b).json();

    expect(ja.ok).toBe(true);
    expect(ja.alreadyFinished).toBeUndefined();
    // C3: die zweite überschreibt nicht, sie liefert das Vorhandene.
    expect(jb).toMatchObject({ ok: true, alreadyFinished: true });
    expect(jb.feedback.summary).toBe("Erste Auswertung.");
    expect((aktuell().feedbackJson as { summary: string }).summary).toBe("Erste Auswertung.");
    // Die gemeinsame Buchung trägt die gespeicherte Auswertung — sie wird NICHT zurückgegeben.
    expect(ledger.refundTx).toEqual([]);
    expect(ledger.balance).toBe(4);
    expect(aktuell().openCharge).toBeNull();
  });

  it("zweiter Klick bei Saldo 0, die erste Anfrage rechnet noch: die vermerkte Buchung wird wiederverwendet (kein 402, kein zweiter Aufruf)", async () => {
    ledger.balance = 1;
    const r = wartenderRichter();
    const a = finish();
    await r.bis(1);
    expect(aktuell().openCharge).toMatchObject({ key: KEY0, txId: TX0 });
    const b = finish();
    await r.bis(2);
    expect(ledger.spendKeys).toEqual([KEY0]);

    r.offen[0].ok({ feedback: feedbackOf(), richter });
    r.offen[1].ok({ feedback: feedbackOf(), richter });
    expect((await a).status).toBe(200);
    expect(await (await b).json()).toMatchObject({ ok: true, alreadyFinished: true });
    expect(ledger.balance).toBe(0);
    expect(ledger.refundTx).toEqual([]);
  });

  it("Lauf wird während der Rechnung abgebrochen: nichts überschrieben, Rückbuchung, saubere Ablehnung", async () => {
    const r = wartenderRichter();
    const a = finish();
    await r.bis(1);
    store.set(SIM, { ...aktuell(), status: "aborted" });
    r.offen[0].ok({ feedback: feedbackOf(), richter });
    const res = await a;
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, code: "ABORTED" });
    expect(ledger.refundTx).toEqual([TX0]);
    expect(ledger.balance).toBe(5);
    const d = aktuell();
    expect(d.status).toBe("aborted");
    expect(d.feedbackJson).toBeUndefined();
    expect(d.openCharge).toBeNull();
    expect(d.chargeRefunds).toBe(1);
  });

  it("Lauf wird während der Rechnung von anderer Stelle mit EIGENER Buchung ausgewertet: Rückbuchung, vorhandenes Ergebnis", async () => {
    const r = wartenderRichter();
    const a = finish();
    await r.bis(1);
    store.set(SIM, { ...aktuell(), status: "finished", feedbackJson: feedbackOf({ summary: "Von anderer Stelle." }), centralSpendTxId: "tx-andere", openCharge: null });
    r.offen[0].ok({ feedback: feedbackOf(), richter });
    const json = await (await a).json();
    expect(json).toMatchObject({ ok: true, alreadyFinished: true });
    expect(json.feedback.summary).toBe("Von anderer Stelle.");
    expect(ledger.refundTx).toEqual([TX0]);
    expect(ledger.balance).toBe(5);
    expect((aktuell().feedbackJson as { summary: string }).summary).toBe("Von anderer Stelle.");
  });

  it("ein Versuch scheitert und bucht zurück, der parallele wird fertig: er bucht einmal neu und speichert — nie eine Auswertung auf zurückgegebener Buchung", async () => {
    const r = wartenderRichter();
    const a = finish();
    const b = finish();
    await r.bis(2);
    // Anfrage A scheitert in beiden Versuchen des Richters.
    r.offen[0].fehler(new Error("Richter kaputt"));
    await r.bis(3);
    r.offen[2].fehler(new Error("Richter kaputt"));
    expect((await a).ok).toBe(false);
    expect(ledger.refundTx).toEqual([TX0]);
    expect(aktuell().chargeRefunds).toBe(1);

    r.offen[1].ok({ feedback: feedbackOf(), richter });
    expect((await b).status).toBe(200);
    expect(ledger.spendKeys.filter((k) => k === KEY1)).toHaveLength(1);
    const d = aktuell();
    expect(d.status).toBe("finished");
    expect(d.centralSpendTxId).toBe(TX1);
    expect(d.openCharge).toBeNull();
    // 5 − 1 (gebucht) + 1 (zurück) − 1 (neu gebucht) = 4: genau ein Credit für die eine Auswertung.
    expect(ledger.balance).toBe(4);
  });
});

describe("POST /api/simulation/finish — Urteil im Prüfungsmodus (C6)", () => {
  const schwach = () =>
    feedbackOf({
      zielErreicht: true,
      rubric: feedbackOf().rubric.map((x) => ({ ...x, score: 2 })),
      checkpoints: [{ id: "x", hit: false, comment: "Fehlte." }],
    });

  it("Übung: Ziel erreicht → bestanden, auch unter der Punktegrenze", async () => {
    judge.mockImplementation(async () => ({ feedback: schwach(), richter }));
    const json = await (await finish()).json();
    expect(json.debrief.overall).toBeLessThan(60);
    expect(json.debrief).toMatchObject({ verdict: "passed", verdictGrund: "ziel", ergebnis: "ziel" });
  });

  it("Prüfung: Ziel erreicht, Mindestpunktzahl fehlt → nicht bestanden; das Ergebnis „ziel“ bleibt stehen", async () => {
    store.set(SIM, lauf({ mode: "check" }));
    judge.mockImplementation(async () => ({ feedback: schwach(), richter }));
    const json = await (await finish()).json();
    expect(json.mode).toBe("check");
    expect(json.debrief.passMarkPct).toBe(70);
    expect(json.debrief).toMatchObject({ verdict: "failed", verdictGrund: "punkte", ergebnis: "ziel" });
  });
});
