import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SimulationDoc } from "@/lib/server/simulation-store";

/**
 * Paket 1 (12.11.2026): Routen-Test für den Gesprächszug (C23). Anlass war C2: Ein vom Torwächter abgelehntes Ende
 * ging trotzdem an den Browser. Dazu C3 (Züge an den frischen Lauf anhängen, beendete Läufe bleiben beendet),
 * C5 (Begrenzung je Person) und C14 (Beobachter fällt aus, die Antwort geht trotzdem raus).
 * Der echte `simulation-store` läuft gegen einen Speicher im Arbeitsspeicher; jede KI ist ersetzt.
 */
const db = await vi.hoisted(async () => (await import("@/test/sim-speicher")).neuerSimSpeicher());
const h = vi.hoisted(() => ({
  rateKeys: [] as string[],
  runPersonaTurn: vi.fn(),
  beobachteRegie: vi.fn(),
  pruefeEnde: vi.fn(),
  logApi: vi.fn(),
}));

vi.mock("@/lib/cosmos", () => db.cosmos);
vi.mock("@/lib/server/radar-emit", () => ({ deleteCoachMeasurement: async () => undefined }));
vi.mock("@/lib/api-auth", () => ({ requireAuth: async () => ({ uid: "u1", email: "a@example.com", oid: "oid-1" }) }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (key: string) => {
    h.rateKeys.push(key);
    return null;
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { api: h.logApi, apiError: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/server/cost-cap", () => ({ checkAndConsumeBudget: async () => ({ allowed: true }), estimateTokens: () => 1 }));
vi.mock("@/lib/server/credits/entitlement", () => ({ kiSchalterBlockt: async () => null }));
vi.mock("@/lib/server/spielbuch/store", () => ({ ensureSpielbuch: async () => null }));
vi.mock("@/lib/server/scenario-store", async () => {
  const { getScenario } = await import("@/lib/simulation/scenarios");
  return { getScenarioForUser: async () => getScenario("sim-coaching-morgan") };
});
vi.mock("@/ai/genkit", () => ({ ai: { generate: vi.fn(), definePrompt: vi.fn() } }));
vi.mock("@/ai/flows/simulation-persona", () => ({ runPersonaTurn: (...a: unknown[]) => h.runPersonaTurn(...a) }));
vi.mock("@/ai/flows/simulation-regie", async (original) => ({
  ...(await original<typeof import("@/ai/flows/simulation-regie")>()),
  beobachteRegie: (...a: unknown[]) => h.beobachteRegie(...a),
}));
vi.mock("@/ai/flows/simulation-ende-pruefung", async (original) => ({
  ...(await original<typeof import("@/ai/flows/simulation-ende-pruefung")>()),
  pruefeEnde: (...a: unknown[]) => h.pruefeEnde(...a),
}));

import { POST } from "./route";

const SIM_ID = "sim-12345678";
const zug = (message: string) =>
  POST(new NextRequest("http://localhost/api/simulation/turn", { method: "POST", body: JSON.stringify({ simId: SIM_ID, message }), headers: { "content-type": "application/json" } }));
const lauf = () => db.lauf<SimulationDoc>();
const logZeile = (aktion: string) => h.logApi.mock.calls.find((c) => c[1] === aktion)?.[2] as Record<string, unknown> | undefined;
const ENDE = { grund: "Die Vereinbarung steht.", ergebnis: "ziel" as const };

beforeEach(() => {
  process.env.SIMULATION_ENABLED = "on";
  db.reset();
  h.rateKeys.length = 0;
  for (const m of [h.runPersonaTurn, h.beobachteRegie, h.pruefeEnde, h.logApi]) m.mockReset();
  h.runPersonaTurn.mockResolvedValue({ reply: "Ich höre.", ende: null });
  h.beobachteRegie.mockResolvedValue(null);
  h.pruefeEnde.mockResolvedValue({ erfuellt: true, fehlt: "" });
});

afterEach(() => {
  delete process.env.SIMULATION_ENABLED;
});

describe("Gesprächszug: Ende der Rolle und Torwächter (C2)", () => {
  it("normales Ende: wird gemeldet, gespeichert und protokolliert; danach nimmt der Lauf keinen Zug mehr an", async () => {
    db.seed();
    h.runPersonaTurn.mockResolvedValue({ reply: "Dann machen wir das so. Bis Freitag.", ende: ENDE });

    const res = await zug("Dann schicke ich Dir den Plan bis Freitag.");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.reply).toBe("Dann machen wir das so. Bis Freitag.");
    expect(json.ende).toEqual(ENDE);
    expect(h.pruefeEnde).toHaveBeenCalledTimes(1);

    expect(lauf().closedByPersona).toMatchObject(ENDE);
    expect(lauf().turns.map((t) => t.role)).toEqual(["persona", "user", "persona"]);
    expect(logZeile("ok")?.ende).toBe("ziel");

    const danach = await zug("Noch etwas?");
    expect(danach.status).toBe(409);
    expect((await danach.json()).code).toBe("ENDED");
    expect(h.runPersonaTurn).toHaveBeenCalledTimes(1);
  });

  it("abgelehntes Ende: wird NICHT gemeldet und NICHT gespeichert; die Rolle antwortet neu und das Gespräch geht weiter", async () => {
    db.seed();
    h.runPersonaTurn
      .mockResolvedValueOnce({ reply: "Prima, dann sind wir durch. Tschüss!", ende: ENDE })
      // Auch die Wiederholung behauptet ein Ende: es darf trotzdem nicht durchgehen.
      .mockResolvedValueOnce({ reply: "Moment, bis wann genau bekomme ich den Plan?", ende: ENDE });
    h.pruefeEnde.mockResolvedValue({ erfuellt: false, fehlt: "ein Termin für den Delegationsplan" });

    const res = await zug("Wir sollten mehr delegieren.");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.reply).toBe("Moment, bis wann genau bekomme ich den Plan?");
    expect(json).not.toHaveProperty("ende");

    // Die Wiederholung bekam die Notiz, dass das Ende abgelehnt ist.
    expect(h.runPersonaTurn).toHaveBeenCalledTimes(2);
    expect(String(h.runPersonaTurn.mock.calls[1][0].regieNotiz)).toContain("Beende das Gespräch noch nicht");

    const doc = lauf();
    expect(doc.closedByPersona ?? null).toBeNull();
    expect(doc.turns[doc.turns.length - 1].text).toBe("Moment, bis wann genau bekomme ich den Plan?");
    expect(doc.turns.some((t) => t.text.includes("Tschüss"))).toBe(false);
    expect(doc.regie?.[doc.regie.length - 1]).toMatchObject({ fehlt: "ein Termin für den Delegationsplan", delivered: true });

    // Protokoll: kein Ende im „ok“, dafür die Ablehnung.
    expect(logZeile("ok")).not.toHaveProperty("ende");
    expect(logZeile("ende-abgelehnt")).toBeTruthy();

    // Das Gespräch ist offen: der nächste Zug läuft.
    h.runPersonaTurn.mockResolvedValue({ reply: "Gut, Freitag passt.", ende: null });
    expect((await zug("Bis Freitag, zwölf Uhr.")).status).toBe(200);
  });
});

describe("Gesprächszug: Zeitbox", () => {
  it("Zeit um: die Rolle verabschiedet sich, der Lauf wird geschlossen, weitere Züge → 409 TIME_UP", async () => {
    // Morgan: 15 Minuten. Der Lauf begann vor 20 Minuten.
    db.seed({ createdAt: new Date(Date.now() - 20 * 60_000).toISOString() });
    h.runPersonaTurn.mockResolvedValue({ reply: "Ich muss leider los. Bis bald.", ende: null });

    const res = await zug("Ein Punkt noch.");
    expect(res.status).toBe(200);
    expect((await res.json()).timeUp).toBe(true);
    expect(h.runPersonaTurn.mock.calls[0][0].timeSignal).toBe("farewell");
    expect(lauf().closedByTime).toBe(true);

    const danach = await zug("Hallo?");
    expect(danach.status).toBe(409);
    expect((await danach.json()).code).toBe("TIME_UP");
    expect(h.runPersonaTurn).toHaveBeenCalledTimes(1);
  });

  it("ab 80 Prozent der Zeit: einmal der Hinweis, das Gespräch bleibt offen", async () => {
    db.seed({ createdAt: new Date(Date.now() - 13 * 60_000).toISOString() });

    const res = await zug("Wie siehst Du das?");
    expect((await res.json()).timeUp).toBe(false);
    expect(h.runPersonaTurn.mock.calls[0][0].timeSignal).toBe("closing");
    expect(lauf().timeWarned).toBe(true);

    await zug("Und weiter?");
    expect(h.runPersonaTurn.mock.calls[1][0].timeSignal).toBeUndefined();
  });
});

describe("Gesprächszug: sicher speichern (C3)", () => {
  it("hängt den Zug an den frischen Lauf an: eine Coach-Notiz, die während der Antwort entstand, bleibt erhalten", async () => {
    db.seed();
    h.runPersonaTurn.mockImplementation(async () => {
      db.fremderSchreiber((d) => {
        d.coachNotes = [{ question: "", answer: "Frag nach der Ursache.", ts: "t1" }];
      });
      return { reply: "Was meinst Du genau?", ende: null };
    });

    const res = await zug("Mir ist etwas aufgefallen.");
    expect(res.status).toBe(200);
    expect((await res.json()).turnCount).toBe(3);
    expect(lauf().coachNotes).toHaveLength(1);
    expect(lauf().turns.map((t) => t.text)).toEqual(["Hallo, Du wolltest mich sprechen?", "Mir ist etwas aufgefallen.", "Was meinst Du genau?"]);
  });

  it("wurde der Lauf während der Antwort ausgewertet, bleibt er fertig: nichts wird gespeichert, 409", async () => {
    db.seed();
    h.runPersonaTurn.mockImplementation(async () => {
      db.fremderSchreiber((d) => {
        d.status = "finished";
        d.feedbackJson = { summary: "Auswertung" };
      });
      return { reply: "Verstehe.", ende: null };
    });

    const res = await zug("Noch ein Gedanke.");
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("ALREADY_FINISHED");
    expect(lauf().status).toBe("finished");
    expect(lauf().feedbackJson).toEqual({ summary: "Auswertung" });
    expect(lauf().turns).toHaveLength(1);
  });

  it("ein abgebrochener Lauf wird nicht wieder aktiv", async () => {
    db.seed();
    h.runPersonaTurn.mockImplementation(async () => {
      db.fremderSchreiber((d) => {
        d.status = "aborted";
      });
      return { reply: "Verstehe.", ende: null };
    });

    expect((await zug("Hallo?")).status).toBe(409);
    expect(lauf().status).toBe("aborted");
    expect(lauf().turns).toHaveLength(1);
  });
});

describe("Gesprächszug: Regie-Beobachter (C14) und Begrenzung je Person (C5)", () => {
  it("fällt der Beobachter aus (Frist oder Fehler → null), geht die Antwort der Rolle trotzdem raus", async () => {
    db.seed();
    h.beobachteRegie.mockResolvedValue(null);

    const res = await zug("Wie geht es Dir mit der Arbeitslast?");
    expect(res.status).toBe(200);
    expect((await res.json()).reply).toBe("Ich höre.");
    expect(lauf().regie ?? []).toHaveLength(0);
  });

  it("gibt die offene Regie-Notiz an die Rolle und hakt sie am frischen Lauf ab; die neue Beobachtung kommt dazu", async () => {
    db.seed({ regie: [{ stufe: 1, erfuellt: ["Anerkennung"], eskaliert: false, notiz: "Du stehst jetzt auf Stufe 1.", turn: 2, ts: "t1" }] });
    h.beobachteRegie.mockResolvedValue({ stufe: 2, erfuellt: ["Anerkennung", "Nachfrage"], eskaliert: false, notiz: "Stufe 2.", turn: 2, ts: "t2" });

    await zug("Was würde Dir helfen?");
    expect(String(h.runPersonaTurn.mock.calls[0][0].regieNotiz)).toContain("Du stehst jetzt auf Stufe 1.");
    const regie = lauf().regie!;
    expect(regie).toHaveLength(2);
    expect(regie[0].delivered).toBe(true);
    expect(regie[1]).toMatchObject({ stufe: 2, notiz: "Stufe 2." });
    expect(regie[1].delivered).toBeUndefined();
  });

  it("begrenzt je angemeldeter Person, nicht je Adresse", async () => {
    db.seed();
    await zug("Hallo.");
    expect(h.rateKeys).toEqual(["sim-turn:u1"]);
  });
});
