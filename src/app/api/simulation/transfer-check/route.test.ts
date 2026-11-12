import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SimulationDoc } from "@/lib/server/simulation-store";

/**
 * Rückmeldung zum Vorsatz speichern (Paket 2, 12.11.2026): C3 — die Rückmeldung wird auf den FRISCH gelesenen Lauf
 * angewandt; C5 — Begrenzung je Person. Lauf-Speicher im Speicher, kein Cosmos.
 */
const SIM = "sim-abcdefgh";
const store = new Map<string, SimulationDoc>();
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const saveSimulation = vi.fn();
const getSimulation = vi.fn();
vi.mock("@/lib/server/simulation-store", () => ({
  getSimulation: (...a: unknown[]) => getSimulation(...a),
  saveSimulation: (...a: unknown[]) => saveSimulation(...a),
  latestPendingTransferCheck: vi.fn(async () => null),
  updateSimulation: async (uid: string, simId: string, mutate: (d: SimulationDoc) => void | false) => {
    const d = store.get(simId);
    if (!d || d.uid !== uid) return null;
    const fresh = clone(d);
    if (mutate(fresh) === false) return fresh;
    store.set(simId, fresh);
    return clone(fresh);
  },
}));
vi.mock("@/lib/server/scenario-store", () => ({ getScenarioForUser: vi.fn(async () => null) }));
const rateLimit = vi.fn((..._a: unknown[]) => null);
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => rateLimit(...a) }));
vi.mock("@/lib/api-auth", () => ({ requireAuth: async () => ({ uid: "u1", email: "a@example.com", oid: "oid-1" }) }));
vi.mock("@/lib/logger", () => ({ logger: { api: vi.fn(), apiError: vi.fn() } }));

const lauf = (over: Partial<SimulationDoc> = {}): SimulationDoc => ({
  id: SIM,
  sessionId: "sim:u1",
  docType: "simulation",
  uid: "u1",
  scenarioId: "sc-1",
  createdAt: "2026-11-08T10:00:00.000Z",
  updatedAt: "2026-11-08T10:00:00.000Z",
  status: "finished",
  turns: [],
  commitment: { text: "Morgen frage ich zuerst nach.", source: "user", createdAt: "2026-11-08T10:05:00.000Z" },
  ...over,
});
const post = (body: unknown) =>
  new NextRequest("http://localhost/api/simulation/transfer-check", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const melde = async (body: unknown) => (await import("./route")).POST(post(body));

beforeEach(() => {
  process.env.SIMULATION_ENABLED = "on";
  store.clear();
  for (const m of [saveSimulation, getSimulation, rateLimit]) m.mockClear();
});

describe("POST /api/simulation/transfer-check", () => {
  it("speichert die Rückmeldung am frischen Lauf, der Vorsatz bleibt; Begrenzung je Person", async () => {
    store.set(SIM, lauf());
    const res = await melde({ simId: SIM, outcome: "partly", note: "  Einmal geklappt.  " });
    expect(res.status).toBe(200);
    expect((await res.json()).transferCheck).toMatchObject({ outcome: "partly", note: "Einmal geklappt." });
    const d = store.get(SIM)!;
    expect(d.transferCheck).toMatchObject({ outcome: "partly", note: "Einmal geklappt." });
    expect(d.commitment?.text).toBe("Morgen frage ich zuerst nach.");
    expect(rateLimit.mock.calls[0][0]).toBe("sim-transfer-check:u1");
    expect(getSimulation).not.toHaveBeenCalled();
    expect(saveSimulation).not.toHaveBeenCalled();
  });

  it("ohne Vorsatz: 409, nichts geschrieben; unbekannte Auswahl: 400; unbekannter Lauf: 404", async () => {
    store.set(SIM, lauf({ commitment: null }));
    const res = await melde({ simId: SIM, outcome: "done" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("NO_COMMITMENT");
    expect(store.get(SIM)!.transferCheck).toBeUndefined();
    expect((await melde({ simId: SIM, outcome: "vielleicht" })).status).toBe(400);
    expect((await melde({ simId: "sim-unbekannt", outcome: "done" })).status).toBe(404);
  });
});
