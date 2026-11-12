import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SimulationDoc } from "@/lib/server/simulation-store";

/**
 * Vorsatz speichern (Paket 2, 12.11.2026): C3 — der Vorsatz wird auf den FRISCH gelesenen Lauf angewandt, andere
 * Felder bleiben, wie sie inzwischen sind; C5 — Begrenzung je Person. Lauf-Speicher im Speicher, kein Cosmos.
 */
const SIM = "sim-abcdefgh";
const store = new Map<string, SimulationDoc>();
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const saveSimulation = vi.fn();
const getSimulation = vi.fn();
vi.mock("@/lib/server/simulation-store", () => ({
  getSimulation: (...a: unknown[]) => getSimulation(...a),
  saveSimulation: (...a: unknown[]) => saveSimulation(...a),
  updateSimulation: async (uid: string, simId: string, mutate: (d: SimulationDoc) => void | false) => {
    const d = store.get(simId);
    if (!d || d.uid !== uid) return null;
    const fresh = clone(d);
    if (mutate(fresh) === false) return fresh;
    store.set(simId, fresh);
    return clone(fresh);
  },
}));
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
  createdAt: "2026-11-12T10:00:00.000Z",
  updatedAt: "2026-11-12T10:00:00.000Z",
  status: "finished",
  turns: [],
  ...over,
});
const post = (body: unknown) =>
  new NextRequest("http://localhost/api/simulation/commit", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const commit = async (body: unknown) => (await import("./route")).POST(post(body));

beforeEach(() => {
  process.env.SIMULATION_ENABLED = "on";
  store.clear();
  for (const m of [saveSimulation, getSimulation, rateLimit]) m.mockClear();
});

describe("POST /api/simulation/commit", () => {
  it("setzt den Vorsatz am frischen Lauf, behält die Zeitangabe des Debriefs und begrenzt je Person", async () => {
    store.set(SIM, lauf({ commitment: { text: "alt", source: "model", createdAt: "2026-11-11T10:00:00.000Z", dueHint: "morgen" }, transferCheck: { outcome: "done", at: "2026-11-12T09:00:00.000Z" } }));
    const res = await commit({ simId: SIM, text: "  Morgen frage ich zuerst nach.  " });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.commitment).toMatchObject({ text: "Morgen frage ich zuerst nach.", source: "user", dueHint: "morgen" });
    const d = store.get(SIM)!;
    expect(d.commitment?.text).toBe("Morgen frage ich zuerst nach.");
    // Was andere inzwischen geschrieben haben, bleibt.
    expect(d.transferCheck?.outcome).toBe("done");
    expect(rateLimit.mock.calls[0][0]).toBe("sim-commit:u1");
    // C3: kein Lesen-dann-ganz-Überschreiben mehr.
    expect(getSimulation).not.toHaveBeenCalled();
    expect(saveSimulation).not.toHaveBeenCalled();
  });

  it("nicht ausgewerteter Lauf: 409, nichts geschrieben; unbekannter Lauf: 404", async () => {
    store.set(SIM, lauf({ status: "active" }));
    const res = await commit({ simId: SIM, text: "Vorsatz" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("NOT_FINISHED");
    expect(store.get(SIM)!.commitment).toBeUndefined();
    expect((await commit({ simId: "sim-unbekannt", text: "Vorsatz" })).status).toBe(404);
  });
});
