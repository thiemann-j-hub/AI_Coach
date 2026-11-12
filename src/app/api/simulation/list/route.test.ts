import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Go-Live-Prüfung 12.11.2026: Der Verlauf zeigte bei Läufen auf einem Entwurf aus dem Builder die Kennung `ws-…`
 * statt des Titels, weil Entwürfe nicht im Katalog stehen. Die Route schlägt solche Titel jetzt einzeln nach.
 */
const h = vi.hoisted(() => ({
  sims: [] as Array<{ id: string; scenarioId: string }>,
  katalog: [] as Array<{ id: string; title: string; persona: { name: string } }>,
  einzeln: {} as Record<string, { id: string; title: string; persona: { name: string } }>,
  nachgeschlagen: [] as string[],
}));

vi.mock("@/lib/api-auth", () => ({ requireAuth: async () => ({ uid: "u1", email: "a@example.com", oid: "oid-1" }) }));
vi.mock("@/lib/server/simulation-store", () => ({ listSimulations: async () => h.sims }));
vi.mock("@/lib/server/scenario-store", () => ({
  listScenariosForUser: async () => h.katalog,
  getScenarioForUser: async (_uid: string, id: string) => {
    h.nachgeschlagen.push(id);
    if (id === "ws-kaputt") throw new Error("Speicher nicht erreichbar");
    return h.einzeln[id] ?? null;
  },
}));
vi.mock("@/lib/server/aufraeumen", () => ({ aufraeumenAnstossen: () => undefined }));
vi.mock("@/lib/logger", () => ({ logger: { api: vi.fn(), apiError: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { GET } from "./route";

const liste = async () => (await GET(new NextRequest("http://localhost/api/simulation/list"))).json();

beforeEach(() => {
  process.env.SIMULATION_ENABLED = "on";
  h.sims = [];
  h.katalog = [];
  h.einzeln = {};
  h.nachgeschlagen.length = 0;
});

afterEach(() => {
  delete process.env.SIMULATION_ENABLED;
});

describe("GET /api/simulation/list: Titel der Szenarien", () => {
  it("eingebaut, freigeschaltet, Entwurf und gelöscht", async () => {
    h.sims = [
      { id: "s1", scenarioId: "sim-coaching-morgan" },
      { id: "s2", scenarioId: "ws-freigeschaltet" },
      { id: "s3", scenarioId: "ws-entwurf" },
      { id: "s4", scenarioId: "ws-entwurf" },
      { id: "s5", scenarioId: "ws-geloescht" },
      { id: "s6", scenarioId: "ws-kaputt" },
    ];
    h.katalog = [{ id: "ws-freigeschaltet", title: "Im Katalog", persona: { name: "Kim" } }];
    h.einzeln = { "ws-entwurf": { id: "ws-entwurf", title: "Mein Entwurf", persona: { name: "Lukas Weber" } } };

    const json = await liste();
    const titel = Object.fromEntries(json.items.map((i: { id: string; scenarioTitle: string }) => [i.id, i.scenarioTitle]));
    expect(titel.s1).toMatch(/Alex Morgan/);
    expect(titel.s2).toBe("Im Katalog");
    expect(titel.s3).toBe("Mein Entwurf");
    expect(titel.s4).toBe("Mein Entwurf");
    expect(json.items[2].personaName).toBe("Lukas Weber");
    // Gelöscht oder nicht lesbar: Die Liste kommt trotzdem, mit der Kennung als Notbehelf.
    expect(titel.s5).toBe("ws-geloescht");
    expect(titel.s6).toBe("ws-kaputt");
    // Nachgeschlagen wird nur, was der Katalog nicht kennt, und jede Kennung einmal.
    expect(h.nachgeschlagen.sort()).toEqual(["ws-entwurf", "ws-geloescht", "ws-kaputt"]);
  });
});
