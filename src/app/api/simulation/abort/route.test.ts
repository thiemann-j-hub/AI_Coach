import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SimulationDoc } from "@/lib/server/simulation-store";

/**
 * Paket 2, C3 (12.11.2026): Abbruch. Die Entscheidung fällt am frischen Lauf direkt vor dem Speichern, damit ein
 * Abbruch neben der Auswertung nie einen fertigen (bezahlten) Lauf überschreibt. Dazu C5: Begrenzung je Person.
 */
const db = await vi.hoisted(async () => (await import("@/test/sim-speicher")).neuerSimSpeicher());
const h = vi.hoisted(() => ({ rateKeys: [] as string[] }));

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

import { POST } from "./route";

const abbruch = (simId = "sim-12345678") =>
  POST(new NextRequest("http://localhost/api/simulation/abort", { method: "POST", body: JSON.stringify({ simId }), headers: { "content-type": "application/json" } }));
const lauf = () => db.lauf<SimulationDoc>();

beforeEach(() => {
  process.env.SIMULATION_ENABLED = "on";
  db.reset();
  h.rateKeys.length = 0;
});

afterEach(() => {
  delete process.env.SIMULATION_ENABLED;
});

describe("Abbruch /api/simulation/abort", () => {
  it("aktiver Lauf wird abgebrochen; ein zweiter Abbruch ist in Ordnung", async () => {
    db.seed();
    const res = await abbruch();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(lauf().status).toBe("aborted");

    expect(await (await abbruch()).json()).toEqual({ ok: true, alreadyAborted: true });
  });

  it("fertiger Lauf bleibt fertig: 409", async () => {
    db.seed({ status: "finished", feedbackJson: { summary: "Auswertung" } });
    const res = await abbruch();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("ALREADY_FINISHED");
    expect(lauf().status).toBe("finished");
  });

  it("wird die Auswertung fertig, während der Abbruch läuft, gewinnt die Auswertung (C3)", async () => {
    db.seed();
    db.fremderSchreiberVorDemSpeichern((d) => {
      d.status = "finished";
      d.feedbackJson = { summary: "Auswertung" };
    });

    const res = await abbruch();
    expect(res.status).toBe(409);
    expect(lauf().status).toBe("finished");
    expect(lauf().feedbackJson).toEqual({ summary: "Auswertung" });
  });

  it("kommt während des Abbruchs ein Zug dazu, bleibt er erhalten", async () => {
    db.seed();
    db.fremderSchreiberVorDemSpeichern((d) => {
      (d.turns as unknown[]).push({ role: "user", text: "Noch ein Satz.", ts: "t1" });
    });

    expect((await abbruch()).status).toBe(200);
    expect(lauf().status).toBe("aborted");
    expect(lauf().turns).toHaveLength(2);
  });

  it("unbekannter Lauf: 404; Begrenzung je angemeldeter Person (C5)", async () => {
    expect((await abbruch("sim-unbekannt1")).status).toBe(404);
    expect(h.rateKeys).toEqual(["sim-abort:u1"]);
  });
});
