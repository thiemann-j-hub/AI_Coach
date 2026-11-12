import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SimulationDoc } from "@/lib/server/simulation-store";
import { PAUSE_MAX_GESAMT_MS, PAUSE_MAX_JE_PAUSE_MS, gespraechsZeitMs } from "@/lib/simulation/zeit";

/**
 * Paket 4, C13 und U5 (12.11.2026): Die Coach-Pause hält die Uhr an. Die Route merkt die Pause am Lauf, mit Deckel
 * je Pause (5 Minuten) und je Lauf (15 Minuten). Der echte `simulation-store` läuft gegen einen Speicher im
 * Arbeitsspeicher (Versionsprüfung wie Cosmos).
 */
const db = await vi.hoisted(async () => (await import("@/test/sim-speicher")).neuerSimSpeicher());
const h = vi.hoisted(() => ({ rate: [] as Array<[string, number, number]> }));

vi.mock("@/lib/cosmos", () => db.cosmos);
vi.mock("@/lib/server/radar-emit", () => ({ deleteCoachMeasurement: async () => undefined }));
vi.mock("@/lib/api-auth", () => ({ requireAuth: async () => ({ uid: "u1", email: "a@example.com", oid: "oid-1" }) }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (key: string, max: number, windowMs: number) => {
    h.rate.push([key, max, windowMs]);
    return null;
  },
}));
vi.mock("@/lib/server/get-request-locale", () => ({ getApiMessages: () => ({ rateLimited: "Zu viele Anfragen." }) }));
vi.mock("@/lib/logger", () => ({ logger: { api: vi.fn(), apiError: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { POST } from "./route";

const SIM_ID = "sim-12345678";
const MIN = 60_000;
const JETZT = Date.UTC(2026, 10, 12, 10, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const pause = (on: unknown, simId = SIM_ID) =>
  POST(new NextRequest("http://localhost/api/simulation/pause", { method: "POST", body: JSON.stringify({ simId, on }), headers: { "content-type": "application/json" } }));
const lauf = () => db.lauf<SimulationDoc>();

beforeEach(() => {
  process.env.SIMULATION_ENABLED = "on";
  db.reset();
  h.rate.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(JETZT);
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.SIMULATION_ENABLED;
});

describe("POST /api/simulation/pause", () => {
  it("an: merkt den Beginn; aus: rechnet die Dauer auf pausedMs", async () => {
    db.seed({ createdAt: iso(JETZT - 6 * MIN) });

    const an = await pause(true);
    expect(an.status).toBe(200);
    expect(await an.json()).toEqual({ ok: true, pausedMs: 0, pauseSince: iso(JETZT) });
    expect(lauf().pauseSince).toBe(iso(JETZT));

    vi.setSystemTime(JETZT + 90_000);
    // Solange die Pause läuft, steht die Uhr: 6 Minuten, nicht 7,5.
    expect(gespraechsZeitMs(lauf(), Date.now())).toBe(6 * MIN);

    const aus = await pause(false);
    expect(await aus.json()).toEqual({ ok: true, pausedMs: 90_000, pauseSince: null });
    expect(lauf()).toMatchObject({ pausedMs: 90_000, pauseSince: null });

    vi.setSystemTime(JETZT + 4 * MIN);
    expect(gespraechsZeitMs(lauf(), Date.now())).toBe(8.5 * MIN);
  });

  it("doppelt an oder doppelt aus ändert nichts und schreibt nicht (Browser und Relais melden beide)", async () => {
    db.seed();
    await pause(true);
    const version = lauf()._etag;
    vi.setSystemTime(JETZT + 30_000);
    const nochmal = await pause(true);
    expect(await nochmal.json()).toMatchObject({ ok: true, pauseSince: iso(JETZT) });
    expect(lauf()._etag).toBe(version);

    await pause(false);
    const danach = lauf()._etag;
    const nochmalAus = await pause(false);
    expect(await nochmalAus.json()).toEqual({ ok: true, pausedMs: 30_000, pauseSince: null });
    expect(lauf()._etag).toBe(danach);
  });

  it("Deckel je Pause: nach 5 Minuten zählt die Pause nicht weiter (Seite mit offener Pause verlassen)", async () => {
    db.seed({ createdAt: iso(JETZT - 30 * MIN), pauseSince: iso(JETZT - 20 * MIN) });
    const aus = await pause(false);
    expect(await aus.json()).toEqual({ ok: true, pausedMs: PAUSE_MAX_JE_PAUSE_MS, pauseSince: null });
  });

  it("Deckel gesamt: nach 15 Minuten Pause beginnt keine neue, die Uhr läuft weiter", async () => {
    db.seed({ pausedMs: PAUSE_MAX_GESAMT_MS });
    const an = await pause(true);
    expect(an.status).toBe(200);
    expect(await an.json()).toEqual({ ok: true, pausedMs: PAUSE_MAX_GESAMT_MS, pauseSince: null });
    expect(lauf().pauseSince ?? null).toBeNull();
  });

  it("ein Lauf in Auswertung oder fertig nimmt keine Pause an", async () => {
    for (const status of ["finishing", "finished", "aborted"]) {
      db.reset();
      db.seed({ status });
      const version = lauf()._etag;
      const res = await pause(true);
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("ALREADY_FINISHED");
      expect(lauf().pauseSince).toBeUndefined();
      expect(lauf()._etag).toBe(version);
    }
  });

  it("im Prüfungsmodus gibt es keine Pause", async () => {
    db.seed({ mode: "check" });
    const res = await pause(true);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("CHECK_MODE");
    expect(lauf().pauseSince).toBeUndefined();
  });

  it("im Prüfungsmodus lässt sich die Pause des Mikrofon-Checks beenden (beginnen geht nicht)", async () => {
    db.seed({ mode: "check", pauseSince: iso(JETZT - 30_000) });
    const aus = await pause(false);
    expect(aus.status).toBe(200);
    expect(await aus.json()).toEqual({ ok: true, pausedMs: 30_000, pauseSince: null });
  });

  it("unbekannter Lauf: 404; kaputte Anfrage: 400; aus, wenn die Simulation aus ist: 503", async () => {
    expect((await pause(true)).status).toBe(404);
    db.seed();
    expect((await pause("ja")).status).toBe(400);
    expect((await pause(true, "x")).status).toBe(400);
    process.env.SIMULATION_ENABLED = "off";
    expect((await pause(true)).status).toBe(503);
  });

  it("begrenzt je angemeldeter Person", async () => {
    db.seed();
    await pause(true);
    expect(h.rate).toEqual([["sim-pause:u1", 30, 60_000]]);
  });
});
