import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SimulationDoc } from "@/lib/server/simulation-store";

/**
 * Paket 1/2 (12.11.2026): Coach-Pause. C3 — die Notiz wird an den frischen Lauf angehängt (vorher schrieb die Route
 * ihre alte Kopie zurück und überschrieb Züge, die inzwischen dazukamen, oder machte einen fertigen Lauf wieder aktiv).
 * U7 — ein Impuls ohne Merkkarte läuft sauber durch. C5 — Begrenzung je Person.
 */
const db = await vi.hoisted(async () => (await import("@/test/sim-speicher")).neuerSimSpeicher());
const h = vi.hoisted(() => ({ rateKeys: [] as string[], runCoachTimeout: vi.fn() }));

vi.mock("@/lib/cosmos", () => db.cosmos);
vi.mock("@/lib/server/radar-emit", () => ({ deleteCoachMeasurement: async () => undefined }));
vi.mock("@/lib/api-auth", () => ({ requireAuth: async () => ({ uid: "u1", email: "a@example.com", oid: "oid-1" }) }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (key: string) => {
    h.rateKeys.push(key);
    return null;
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { api: vi.fn(), apiError: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/server/cost-cap", () => ({ checkAndConsumeBudget: async () => ({ allowed: true }), estimateTokens: () => 1 }));
vi.mock("@/lib/server/credits/entitlement", () => ({ kiSchalterBlockt: async () => null }));
vi.mock("@/lib/server/scenario-store", async () => {
  const { getScenario } = await import("@/lib/simulation/scenarios");
  return { getScenarioForUser: async () => getScenario("sim-coaching-morgan") };
});
vi.mock("@/ai/flows/simulation-coach", () => ({ runCoachTimeout: (...a: unknown[]) => h.runCoachTimeout(...a) }));

import { POST } from "./route";

const pause = (question?: string) =>
  POST(new NextRequest("http://localhost/api/simulation/timeout", { method: "POST", body: JSON.stringify({ simId: "sim-12345678", question }), headers: { "content-type": "application/json" } }));
const lauf = () => db.lauf<SimulationDoc>();
const MIT_ZUG = { turns: [{ role: "persona", text: "Hallo.", ts: "t0" }, { role: "user", text: "Mir ist etwas aufgefallen.", ts: "t1" }] };
const KARTE = { id: "card-1", title: "Delegieren in drei Schritten", hint: "Wenn Du alles selbst machst." };

beforeEach(() => {
  process.env.SIMULATION_ENABLED = "on";
  db.reset();
  h.rateKeys.length = 0;
  h.runCoachTimeout.mockReset();
  h.runCoachTimeout.mockResolvedValue({ tip: "Frag nach, was sie abgeben könnte.", card: null });
});

afterEach(() => {
  delete process.env.SIMULATION_ENABLED;
});

describe("Coach-Pause /api/simulation/timeout", () => {
  it("Impuls ohne Merkkarte: Antwort mit card null, die Notiz liegt ohne Karte am Lauf (U7)", async () => {
    db.seed(MIT_ZUG);
    const res = await pause("Wie mache ich weiter?");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, tip: "Frag nach, was sie abgeben könnte.", card: null, timeoutsUsed: 1, timeoutsMax: 3 });
    const note = lauf().coachNotes![0];
    expect(note).toMatchObject({ question: "Wie mache ich weiter?", answer: "Frag nach, was sie abgeben könnte." });
    expect(note).not.toHaveProperty("card");
  });

  it("Impuls mit passender Merkkarte: die Karte steht in Antwort und Ablage", async () => {
    db.seed(MIT_ZUG);
    h.runCoachTimeout.mockResolvedValue({ tip: "Gib eine Aufgabe ab.", card: KARTE });
    expect((await (await pause()).json()).card).toEqual(KARTE);
    expect(lauf().coachNotes![0].card).toEqual(KARTE);
  });

  it("hängt die Notiz an den frischen Lauf an: Züge, die während des Impulses dazukamen, bleiben erhalten (C3)", async () => {
    db.seed(MIT_ZUG);
    h.runCoachTimeout.mockImplementation(async () => {
      db.fremderSchreiber((d) => {
        (d.turns as unknown[]).push({ role: "persona", text: "Ja?", ts: "t2" }, { role: "user", text: "Das Angebot liegt seit zwei Wochen.", ts: "t3" });
      });
      return { tip: "Bleib bei der Beobachtung.", card: null };
    });

    expect((await pause()).status).toBe(200);
    expect(lauf().turns).toHaveLength(4);
    expect(lauf().coachNotes).toHaveLength(1);
  });

  it("wurde der Lauf während des Impulses ausgewertet, bleibt er fertig: keine Notiz, 409 (C3)", async () => {
    db.seed(MIT_ZUG);
    h.runCoachTimeout.mockImplementation(async () => {
      db.fremderSchreiber((d) => {
        d.status = "finished";
      });
      return { tip: "Zu spät.", card: null };
    });

    const res = await pause();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("ALREADY_FINISHED");
    expect(lauf().status).toBe("finished");
    expect(lauf().coachNotes ?? []).toHaveLength(0);
  });

  it("nie mehr als drei Notizen, auch wenn zwei Anfragen gleichzeitig laufen (C3)", async () => {
    db.seed({ ...MIT_ZUG, coachNotes: [{ question: "", answer: "1", ts: "a" }, { question: "", answer: "2", ts: "b" }] });
    h.runCoachTimeout.mockImplementation(async () => {
      db.fremderSchreiber((d) => {
        (d.coachNotes as unknown[]).push({ question: "", answer: "3", ts: "c" });
      });
      return { tip: "4", card: null };
    });

    const res = await pause();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("TIMEOUT_LIMIT");
    expect(lauf().coachNotes).toHaveLength(3);
  });

  it("begrenzt je angemeldeter Person, nicht je Adresse (C5)", async () => {
    db.seed(MIT_ZUG);
    await pause();
    expect(h.rateKeys).toEqual(["sim-timeout:u1"]);
  });
});
