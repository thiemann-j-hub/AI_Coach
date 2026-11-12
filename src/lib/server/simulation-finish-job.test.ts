import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Auswertung als Auftrag (Paket 3, 12.11.2026): die reinen Helfer und der Start neben der Antwort.
 * Der Ablauf als Ganzes (Anspruch, Buchung, Rechnung, Rückbuchung, Aufräumer, Abgleich) wird über die Routen
 * geprüft: src/app/api/simulation/finish/route.test.ts.
 */
vi.mock("@/ai/flows/simulation-feedback", () => ({ RICHTER_OPUS_TIMEOUT_MS: 110_000, judgeSimulation: vi.fn() }));
vi.mock("@/ai/flows/simulation-selfreview", () => ({ CHECKIN_MAX_CHARS: 400, generateSelfReview: vi.fn() }));
vi.mock("@/ai/flows/score-competencies", () => ({ scoreCompetencies: vi.fn() }));
vi.mock("@/ai/flows/simulation-regie", () => ({ regieVerlaufText: () => "" }));
vi.mock("@/lib/server/credits/entitlement", () => ({ compensateEntitlement: vi.fn(), reserveEntitlement: vi.fn(), settleEntitlement: vi.fn() }));
const log = vi.hoisted(() => ({ api: vi.fn(), apiError: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: log }));

import {
  FINISH_JOB_MAX_MS,
  FINISH_STALE_MS,
  checkinAntwort,
  checkinHasAnswers,
  checkinSelfAssessment,
  finishIsStale,
  imHintergrund,
  typicalFinishMs,
} from "./simulation-finish-job";

beforeEach(() => {
  for (const m of Object.values(log)) m.mockClear();
});

describe("Check-in — Antworten", () => {
  it("säubert: Leerraum zusammengezogen, höchstens 400 Zeichen, leer oder kein Text = nicht beantwortet", () => {
    expect(checkinAntwort("  Ich habe   ruhig\nbegonnen. ")).toBe("Ich habe ruhig begonnen.");
    expect(checkinAntwort("x".repeat(900))).toHaveLength(400);
    expect(checkinAntwort("   ")).toBeNull();
    expect(checkinAntwort(undefined)).toBeNull();
    expect(checkinAntwort(42)).toBeNull();
  });

  it("abzugleichen gibt es nur etwas mit mindestens einer Antwort", () => {
    const at = "2026-11-12T10:00:00.000Z";
    expect(checkinHasAnswers({ gut: "a", anders: null, skipped: false, at })).toBe(true);
    expect(checkinHasAnswers({ gut: null, anders: "b", skipped: false, at })).toBe(true);
    expect(checkinHasAnswers({ gut: null, anders: null, skipped: true, at })).toBe(false);
    expect(checkinHasAnswers({ gut: null, anders: null, skipped: false, at })).toBe(false);
    expect(checkinHasAnswers(null)).toBe(false);
    expect(checkinHasAnswers(undefined)).toBe(false);
  });

  it("setzt das alte Feld selfAssessment aus den zwei Antworten zusammen", () => {
    expect(checkinSelfAssessment("Ruhig begonnen.", "Früher fragen.")).toBe("Ruhig begonnen. · Früher fragen.");
    expect(checkinSelfAssessment(null, "Früher fragen.")).toBe("Früher fragen.");
    expect(checkinSelfAssessment(null, null)).toBeNull();
  });
});

describe("Aufräumer — wann ein Lauf hängt", () => {
  const now = Date.parse("2026-11-12T12:00:00.000Z");
  const seit = (min: number) => ({ since: new Date(now - min * 60_000).toISOString() });

  it("nur finishing, und nur älter als 6 Minuten", () => {
    expect(FINISH_STALE_MS).toBe(6 * 60_000);
    expect(finishIsStale({ status: "finishing", finishing: seit(5.9) }, now)).toBe(false);
    expect(finishIsStale({ status: "finishing", finishing: seit(6.1) }, now)).toBe(true);
    expect(finishIsStale({ status: "active", finishing: seit(60) }, now)).toBe(false);
    expect(finishIsStale({ status: "finished", finishing: null }, now)).toBe(false);
    expect(finishIsStale({ status: "finishing", finishing: null }, now)).toBe(false);
    expect(finishIsStale({ status: "finishing", finishing: { since: "kein Datum" } }, now)).toBe(true);
  });

  it("die harte Frist des Auftrags liegt unter der Grenze des Aufräumers", () => {
    expect(FINISH_JOB_MAX_MS).toBeLessThan(FINISH_STALE_MS);
  });
});

describe("Erwartete Dauer für die Warteansicht", () => {
  it("starker Richter rund 50 s, sonst rund 20 s", () => {
    expect(typicalFinishMs({})).toBe(20_000);
    expect(typicalFinishMs({ COACH_RICHTER: "gemini" })).toBe(20_000);
    expect(typicalFinishMs({ COACH_RICHTER: "opus" })).toBe(50_000);
  });
});

describe("Aufgabe neben der Antwort", () => {
  it("außerhalb einer Anfrage (after() wirft) läuft die Aufgabe trotzdem; der Aufrufer wartet nicht", async () => {
    let fertig = false;
    let weiter!: () => void;
    const tor = new Promise<void>((ok) => (weiter = ok));
    imHintergrund("/test", async () => {
      await tor;
      fertig = true;
    });
    expect(fertig).toBe(false);
    weiter();
    await vi.waitFor(() => expect(fertig).toBe(true));
  });

  it("ein Fehler der Aufgabe endet im Protokoll, nie als unbehandelte Ablehnung", async () => {
    const unbehandelt = vi.fn();
    process.on("unhandledRejection", unbehandelt);
    try {
      imHintergrund("/test/fehler", async () => {
        throw new Error("kaputt");
      });
      await vi.waitFor(() => expect(log.apiError).toHaveBeenCalledTimes(1));
      expect(log.apiError.mock.calls[0][0]).toBe("/test/fehler");
      await new Promise((ok) => setTimeout(ok, 5));
      expect(unbehandelt).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unbehandelt);
    }
  });
});
