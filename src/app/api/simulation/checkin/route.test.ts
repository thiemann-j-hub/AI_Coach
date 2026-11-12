import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SimulationDoc } from "@/lib/server/simulation-store";

/**
 * POST /api/simulation/checkin (Paket 3, S8, 12.11.2026): die zwei Antworten des Check-ins — höchstens einmal
 * gespeichert, nur solange es eine Auswertung gibt oder geben soll, Abgleich nur, wenn die Auswertung schon steht.
 * Es läuft der echte Lauf-Speicher mit Versionsprüfung (Speicher im Arbeitsspeicher wie Cosmos); der kleine
 * KI-Schritt ist ersetzt. Das Zusammenspiel mit dem Auftrag (Check-in vor dem Ende der Rechnung) prüft
 * ../finish/route.test.ts.
 */
const db = await vi.hoisted(async () => (await import("@/test/sim-speicher")).neuerSimSpeicher());
const SIM = "sim-12345678";

const hintergrund: Promise<unknown>[] = [];
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => Promise<unknown>) => {
    hintergrund.push(task());
  },
}));
const fertig = async () => {
  while (hintergrund.length) await hintergrund.shift();
};

vi.mock("@/lib/cosmos", () => db.cosmos);
vi.mock("@/lib/server/radar-emit", () => ({ deleteCoachMeasurement: async () => undefined, emitCoachMeasurement: vi.fn() }));
const ABGLEICH = { agreement: "confirms", comment: "Du meintest, Du hättest ruhig begonnen — das stimmt." };
const selfReview = vi.fn();
vi.mock("@/ai/flows/simulation-selfreview", () => ({ CHECKIN_MAX_CHARS: 400, generateSelfReview: (...a: unknown[]) => selfReview(...a) }));
vi.mock("@/ai/flows/simulation-feedback", () => ({ RICHTER_OPUS_TIMEOUT_MS: 110_000, judgeSimulation: vi.fn() }));
vi.mock("@/ai/flows/score-competencies", () => ({ scoreCompetencies: vi.fn() }));
vi.mock("@/ai/flows/simulation-regie", () => ({ regieVerlaufText: () => "" }));
vi.mock("@/lib/server/credits/entitlement", () => ({ compensateEntitlement: vi.fn(), reserveEntitlement: vi.fn(), settleEntitlement: vi.fn() }));
vi.mock("@/lib/server/scenario-store", () => ({ claimFreeTestEval: vi.fn(), releaseFreeTestEval: vi.fn() }));
const rateLimit = vi.fn((..._a: unknown[]) => null);
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => rateLimit(...a) }));
vi.mock("@/lib/api-auth", () => ({ requireAuth: async () => ({ uid: "u1", email: "a@example.com", oid: "oid-1" }) }));
const log = vi.hoisted(() => ({ api: vi.fn(), apiError: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: log }));

import { POST } from "./route";

const AUSWERTUNG = { summary: "Du hast zugehört.", rubric: [{ key: "a", label: "A", evidence: [], why: "w", wentWell: [], tryNext: [], score: 3 }], checkpoints: [], nextStep: "Frag früher nach." };
/** Lauf, dessen Auswertung gerade rechnet. */
const rechnet = (extra: Record<string, unknown> = {}) => db.seed({ status: "finishing", finishing: { since: "2026-11-12T10:10:00.000Z" }, convoLocale: "de", ...extra });
/** Lauf, dessen Auswertung schon steht. */
const ausgewertet = (extra: Record<string, unknown> = {}) =>
  db.seed({ status: "finished", finishing: null, feedbackJson: AUSWERTUNG, debriefJson: { verdict: "passed", overall: 72, passMarkPct: 60 }, convoLocale: "en", ...extra });
const lauf = () => db.lauf<SimulationDoc>();
const checkin = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/simulation/checkin", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

beforeEach(() => {
  process.env.SIMULATION_ENABLED = "on";
  db.reset();
  hintergrund.length = 0;
  for (const m of [selfReview, rateLimit, ...Object.values(log)]) m.mockClear();
  rateLimit.mockImplementation(() => null);
  selfReview.mockImplementation(async () => ABGLEICH);
});
afterEach(fertig);

describe("POST /api/simulation/checkin — speichern", () => {
  it("während der Rechnung: beide Antworten gesäubert gespeichert, altes Feld zusammengesetzt, kein Abgleich", async () => {
    rechnet();
    const res = await checkin({ simId: SIM, gut: "  Ich habe   ruhig begonnen. ", anders: "Früher nachfragen." });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "finishing" });
    await fertig();
    const d = lauf();
    expect(d.checkin).toMatchObject({ gut: "Ich habe ruhig begonnen.", anders: "Früher nachfragen.", skipped: false });
    expect(Date.parse(d.checkin!.at)).toBeGreaterThan(0);
    expect(d.selfAssessment).toBe("Ich habe ruhig begonnen. · Früher nachfragen.");
    expect(d.status).toBe("finishing");
    expect(selfReview).not.toHaveBeenCalled();
    // Begrenzung je Person; keine Inhalte im Protokoll.
    expect(rateLimit.mock.calls[0][0]).toBe("sim-checkin:u1");
    expect(JSON.stringify(log.api.mock.calls)).not.toContain("ruhig begonnen");
  });

  it("nur eine Antwort zählt als beantwortet; je Antwort höchstens 400 Zeichen", async () => {
    rechnet();
    await checkin({ simId: SIM, anders: "y".repeat(900) });
    const d = lauf();
    expect(d.checkin).toMatchObject({ gut: null, skipped: false });
    expect(d.checkin!.anders).toHaveLength(400);
    expect(d.selfAssessment).toHaveLength(400);
  });

  it("übersprungen = keine Antwort da; steht trotz „skipped“ Text da, zählt der Text", async () => {
    rechnet();
    await checkin({ simId: SIM, gut: "   ", skipped: false });
    expect(lauf().checkin).toMatchObject({ gut: null, anders: null, skipped: true });
    expect(lauf().selfAssessment).toBeNull();

    db.reset();
    rechnet();
    await checkin({ simId: SIM, gut: "Ruhig begonnen.", skipped: true });
    expect(lauf().checkin).toMatchObject({ gut: "Ruhig begonnen.", anders: null, skipped: false });
  });

  it("höchstens einmal: ein zweiter Aufruf überschreibt nichts und antwortet trotzdem mit 200", async () => {
    rechnet();
    await checkin({ simId: SIM, gut: "Erste Antwort." });
    const res = await checkin({ simId: SIM, gut: "Zweite Antwort.", anders: "Neu." });
    expect(res.status).toBe(200);
    expect(lauf().checkin).toMatchObject({ gut: "Erste Antwort.", anders: null });
    expect(lauf().selfAssessment).toBe("Erste Antwort.");
  });

  it("nur solange es eine Auswertung gibt oder geben soll: aktiv ohne Fehlschlag 409, abgebrochen 409, unbekannt 404", async () => {
    db.seed();
    let res = await checkin({ simId: SIM, gut: "x" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, code: "NOT_FINISHING" });
    expect(lauf().checkin).toBeUndefined();

    db.seed({ status: "aborted" });
    res = await checkin({ simId: SIM, gut: "x" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, code: "ABORTED" });

    expect((await checkin({ simId: "sim-unbekannt", gut: "x" })).status).toBe(404);
    db.seed({ uid: "u2", status: "finishing" });
    expect((await checkin({ simId: SIM, gut: "x" })).status).toBe(404);
    expect((await checkin({ gut: "x" })).status).toBe(400);
    expect((await checkin({ simId: SIM, gut: 5 })).status).toBe(400);
  });

  it("Rechnung schon gescheitert (aktiv mit finishError): die Antworten werden für den nächsten Versuch gespeichert", async () => {
    db.seed({ finishError: { code: "timeout", requestId: null, at: "2026-11-12T10:11:00.000Z" } });
    const res = await checkin({ simId: SIM, gut: "Ruhig begonnen." });
    expect(await res.json()).toEqual({ ok: true, status: "active" });
    await fertig();
    expect(lauf().checkin).toMatchObject({ gut: "Ruhig begonnen." });
    expect(selfReview).not.toHaveBeenCalled();
  });
});

describe("POST /api/simulation/checkin — Abgleich, wenn die Auswertung schon steht", () => {
  it("stößt den Abgleich genau einmal an und trägt ihn in feedbackJson.selfReview nach", async () => {
    ausgewertet();
    const res = await checkin({ simId: SIM, gut: "Ruhig begonnen.", anders: "Früher nachfragen." });
    expect(await res.json()).toEqual({ ok: true, status: "finished" });
    await fertig();
    expect(selfReview).toHaveBeenCalledTimes(1);
    expect(selfReview.mock.calls[0][0]).toMatchObject({
      gut: "Ruhig begonnen.",
      anders: "Früher nachfragen.",
      feedback: { summary: "Du hast zugehört." },
      debrief: { verdict: "passed", overall: 72 },
      lang: "en",
    });
    const fb = lauf().feedbackJson as { selfReview: unknown; summary: string };
    expect(fb.selfReview).toEqual(ABGLEICH);
    // Die Auswertung selbst bleibt, wie sie war.
    expect(fb.summary).toBe("Du hast zugehört.");
    expect(log.api.mock.calls.some((c) => c[1] === "self-review")).toBe(true);

    await checkin({ simId: SIM, gut: "Noch einmal." });
    await fertig();
    expect(selfReview).toHaveBeenCalledTimes(1);
  });

  it("die Rechnung wird genau zwischen Lesen und Schreiben des Check-ins fertig: Er sieht sie beim Wiederholen und gleicht ab — nichts geht verloren", async () => {
    rechnet();
    // Der Auftrag speichert die Auswertung, während der Check-in den Lauf schon gelesen hat (Versionskonflikt).
    db.fremderSchreiberVorDemSpeichern((d) => {
      d.status = "finished";
      d.finishing = null;
      d.feedbackJson = AUSWERTUNG;
    });
    const res = await checkin({ simId: SIM, gut: "Ruhig begonnen." });
    expect(await res.json()).toEqual({ ok: true, status: "finished" });
    await fertig();
    expect(selfReview).toHaveBeenCalledTimes(1);
    const d = lauf();
    expect(d.checkin).toMatchObject({ gut: "Ruhig begonnen." });
    expect((d.feedbackJson as { summary: string; selfReview: unknown }).summary).toBe("Du hast zugehört.");
    expect((d.feedbackJson as { selfReview: unknown }).selfReview).toEqual(ABGLEICH);
  });

  it("übersprungen: kein Abgleich", async () => {
    ausgewertet();
    await checkin({ simId: SIM, skipped: true });
    await fertig();
    expect(selfReview).not.toHaveBeenCalled();
    expect(lauf().checkin).toMatchObject({ skipped: true });
  });

  it("Alt-Lauf mit Selbstbild und Abgleich des Richters: nichts wird überschrieben, kein neuer Abgleich", async () => {
    const alt = { agreement: "differs", comment: "Alter Abgleich." };
    ausgewertet({ selfAssessment: "Alter Freitext.", feedbackJson: { ...AUSWERTUNG, selfReview: alt } });
    const res = await checkin({ simId: SIM, gut: "Neu." });
    expect(res.status).toBe(200);
    await fertig();
    const d = lauf();
    expect(d.selfAssessment).toBe("Alter Freitext.");
    expect(d.checkin).toBeUndefined();
    expect((d.feedbackJson as { selfReview: unknown }).selfReview).toEqual(alt);
    expect(selfReview).not.toHaveBeenCalled();
  });

  it("scheitert der Abgleich, fehlt nur die Karte: Antwort 200, Check-in gespeichert, Fehler im Protokoll", async () => {
    ausgewertet();
    selfReview.mockImplementation(async () => {
      throw new Error("Frist");
    });
    const res = await checkin({ simId: SIM, gut: "Ruhig begonnen." });
    expect(res.status).toBe(200);
    await fertig();
    expect(lauf().checkin).toMatchObject({ gut: "Ruhig begonnen." });
    expect((lauf().feedbackJson as { selfReview?: unknown }).selfReview).toBeUndefined();
    expect(log.apiError.mock.calls.some((c) => c[0] === "/api/simulation/checkin/self-review")).toBe(true);
  });
});
