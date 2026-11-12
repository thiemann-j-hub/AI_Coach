import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Katalog-Route, Teil „Einblick und Empfehlung“ (12.11.2026):
 * U15 — die Empfehlung kommt aus der schwächsten FÄHIGKEIT der jüngsten Rollenspiel-Auswertung (nicht mehr C1–C10),
 * U21 — `played` nennt je Szenario das beste Ergebnis, ohne ganze Gespräche zu laden.
 */
const h = vi.hoisted(() => ({
  latest: [] as unknown[],
  results: [] as unknown[],
  failLatest: false,
  failResults: false,
  queries: [] as string[],
  admin: false,
  wsDocs: {} as Record<string, unknown>,
  wsKatalog: [] as unknown[],
}));

vi.mock("@/lib/cosmos", () => ({
  runsContainer: () => ({}),
  queryItems: async (_container: unknown, query: string) => {
    h.queries.push(query);
    const isLatest = query.includes("TOP 1");
    if (isLatest ? h.failLatest : h.failResults) throw new Error("cosmos");
    return isLatest ? h.latest : h.results;
  },
}));
vi.mock("@/lib/server/simulation-store", () => ({
  SIM_DOC_TYPE: "simulation",
  simPartitionKey: (uid: string) => `sim:${uid}`,
  listSimulations: async () => [],
}));
vi.mock("@/lib/server/scenario-store", () => ({
  listScenariosForUser: async () => h.wsKatalog,
  getScenarioForUser: async (_uid: string, id: string) => h.wsDocs[id] ?? null,
}));
vi.mock("@/lib/server/scenario-admin", async () => {
  const { NextResponse } = await import("next/server");
  return {
    requireWorkspaceAdmin: async () =>
      h.admin ? { workspaceId: "ws-1" } : NextResponse.json({ ok: false, code: "ADMIN_ONLY" }, { status: 403 }),
  };
});
vi.mock("@/lib/server/aufraeumen", () => ({ aufraeumenAnstossen: () => undefined }));
vi.mock("@/lib/api-auth", () => ({ requireAuth: async () => ({ uid: "u1", email: "a@example.com", oid: "oid-1" }) }));
vi.mock("@/lib/logger", () => ({ logger: { api: vi.fn(), apiError: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { GET } from "./route";

const katalog = async () => {
  const res = await GET(new NextRequest("http://localhost/api/simulation/scenarios"));
  return { status: res.status, json: await res.json() };
};

beforeEach(() => {
  process.env.SIMULATION_ENABLED = "on";
  h.latest = [];
  h.results = [];
  h.failLatest = false;
  h.failResults = false;
  h.queries.length = 0;
  h.admin = false;
  h.wsDocs = {};
  h.wsKatalog = [];
});

afterEach(() => {
  delete process.env.SIMULATION_ENABLED;
  delete process.env.COACH_LIVE;
});

describe("GET /api/simulation/scenarios — Einblick und Empfehlung", () => {
  it("U15: schwächste beobachtete Fähigkeit der jüngsten Auswertung, bei Gleichstand die des „Größten Hebels“", async () => {
    h.latest = [
      {
        scenarioId: "sim-coaching-morgan",
        nextStepKey: "ursache",
        rubric: [
          { key: "rahmen", label: "Rahmen setzen und Sicherheit geben", score: 3 },
          { key: "konkret", label: "Konkret bleiben", score: 2 },
          { key: "ursache", label: "Bis zur Ursache zuhören", score: 2 },
          { key: "vereinbarung", label: "Verbindlich vereinbaren", score: null },
        ],
      },
    ];
    const { status, json } = await katalog();
    expect(status).toBe(200);
    expect(json.insight).toEqual({ skill: "ursache", label: "Bis zur Ursache zuhören", scenarioId: "sim-coaching-morgan" });
    expect(json.scenarios.length).toBeGreaterThan(0);
  });

  it("U21: bestes Ergebnis je Szenario aus den abgeschlossenen Läufen", async () => {
    h.results = [
      { scenarioId: "sim-coaching-morgan", overall: 58 },
      { scenarioId: "sim-coaching-morgan", overall: 73 },
      { scenarioId: "ws-mein-1" },
    ];
    const { json } = await katalog();
    expect(json.played).toEqual({
      "sim-coaching-morgan": { best: 73, count: 2 },
      "ws-mein-1": { best: null, count: 1 },
    });
  });

  it("ohne Rollenspiel-Auswertung bleibt der Kaltstart: kein Einblick, nichts gespielt", async () => {
    const { status, json } = await katalog();
    expect(status).toBe(200);
    expect(json.insight).toBeNull();
    expect(json.played).toEqual({});
  });

  it("scheitert eine der beiden Abfragen, kommt der Katalog trotzdem (Einblick und Zeichen sind Komfort)", async () => {
    h.failLatest = true;
    h.results = [{ scenarioId: "sim-coaching-morgan", overall: 64 }];
    let r = await katalog();
    expect(r.status).toBe(200);
    expect(r.json.insight).toBeNull();
    expect(r.json.played).toEqual({ "sim-coaching-morgan": { best: 64, count: 1 } });

    h.failLatest = false;
    h.failResults = true;
    h.latest = [{ scenarioId: "sim-coaching-morgan", rubric: [{ key: "konkret", label: "Konkret bleiben", score: 1 }] }];
    r = await katalog();
    expect(r.status).toBe(200);
    expect(r.json.insight).toEqual({ skill: "konkret", label: "Konkret bleiben", scenarioId: "sim-coaching-morgan" });
    expect(r.json.played).toEqual({});
  });

  it("Paket 4: liveAvailable je Szenario sagt dem Briefing, wo „Sprechen“ geht", async () => {
    // Schalter aus (Standard): nirgends.
    let { json } = await katalog();
    expect(json.scenarios.length).toBeGreaterThan(0);
    expect(json.scenarios.every((s: { liveAvailable: unknown }) => s.liveAvailable === false)).toBe(true);

    // Einzelne Szenarien freigegeben.
    process.env.COACH_LIVE = "sim-coaching-morgan";
    ({ json } = await katalog());
    const frei = json.scenarios.filter((s: { liveAvailable: boolean }) => s.liveAvailable).map((s: { id: string }) => s.id);
    expect(frei).toEqual(["sim-coaching-morgan"]);

    // Alle freigegeben. Die Rollen-DNA bleibt trotzdem auf dem Server.
    process.env.COACH_LIVE = "all";
    ({ json } = await katalog());
    expect(json.scenarios.every((s: { liveAvailable: unknown }) => s.liveAvailable === true)).toBe(true);
    expect(json.scenarios.some((s: Record<string, unknown>) => "personaDna" in s)).toBe(false);
  });

  it("beide Abfragen bleiben in der eigenen Partition und laden keine Gespräche", async () => {
    await katalog();
    expect(h.queries).toHaveLength(2);
    for (const q of h.queries) {
      expect(q).toContain("c.sessionId = @pk");
      expect(q).toContain("c.status = @st");
      expect(q).not.toContain("c.turns");
      expect(q).not.toMatch(/SELECT\s+(TOP 1\s+)?\*/);
    }
  });

  it("Probelauf eines Entwurfs: Admins bekommen den gewünschten Entwurf als `probe`, im Katalog steht er nicht (12.11.2026)", async () => {
    const { getScenario } = await import("@/lib/simulation/scenarios");
    const entwurf = { ...getScenario("sim-coaching-morgan")!, id: "ws-entwurf-abc123", title: "Mein Entwurf" };
    h.wsDocs = { [entwurf.id]: entwurf };
    const mit = async (id: string) => (await GET(new NextRequest(`http://localhost/api/simulation/scenarios?szenario=${id}`))).json();

    // Mitglied ohne Admin-Rolle: kein Entwurf.
    expect((await mit(entwurf.id)).probe).toBeNull();

    h.admin = true;
    const json = await mit(entwurf.id);
    expect(json.probe).toMatchObject({ id: entwurf.id, title: "Mein Entwurf" });
    expect("personaDna" in json.probe).toBe(false);
    expect(json.scenarios.some((s: { id: string }) => s.id === entwurf.id)).toBe(false);

    // Unbekannte oder unpassende Kennung, eingebautes Szenario, ohne Parameter: nichts.
    expect((await mit("ws-gibt-es-nicht")).probe).toBeNull();
    expect((await mit("sim-coaching-morgan")).probe).toBeNull();
    expect((await katalog()).json.probe).toBeNull();

    // Steht das Szenario schon im Katalog (veröffentlicht), braucht es kein `probe`.
    h.wsKatalog = [entwurf];
    expect((await mit(entwurf.id)).probe).toBeNull();
  });
});
