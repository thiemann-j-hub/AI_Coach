import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Paket 5, C28 (12.11.2026): Spielbuch-Store.
 *   (a) Hash-Wächter: Die mitgelieferten Spielbücher passen zum Hash ihrer Szenarien.
 *   (b) Ein Fehlschlag wird 30 Minuten gemerkt, statt bei jedem Zug einen neuen teuren Aufruf zu starten.
 *   (c) Der Builder bekommt einen Stand der Vorbereitung.
 * Cosmos ist ein Speicher im Arbeitsspeicher, das starke Modell eine Attrappe: kein echter KI-Aufruf.
 */
const db = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>();
  return {
    docs,
    cosmos: {
      runsContainer: () => ({ name: "runs" }),
      readItem: async (_c: unknown, id: string, pk: string) => structuredClone(docs.get(`${pk}|${id}`) ?? null),
      upsertItem: async (_c: unknown, item: Record<string, unknown>) => {
        docs.set(`${String(item.sessionId)}|${String(item.id)}`, structuredClone(item));
        return item;
      },
      deleteItem: async (_c: unknown, id: string, pk: string) => void docs.delete(`${pk}|${id}`),
    },
  };
});
const claude = vi.hoisted(() => ({ message: vi.fn(), configured: true }));

vi.mock("@/lib/cosmos", () => db.cosmos);
vi.mock("@/lib/server/claude-vertex", () => ({
  claudeVertexConfigured: () => claude.configured,
  claudeMessage: (...a: unknown[]) => claude.message(...a),
}));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), api: vi.fn(), apiError: vi.fn() },
}));

import { SIMULATION_SCENARIOS, getScenario } from "@/lib/simulation/scenarios";
import { SPIELBUECHER_BUILTIN } from "@/lib/simulation/spielbuecher";
import type { SimulationScenario } from "@/lib/simulation/types";
import { ensureSpielbuch, SPIELBUCH_FEHLER_PAUSE_MS, SPIELBUCH_PARTITION, spielbuchDocId, spielbuchHash, spielbuchStatus } from "./store";

const GUT = `1. SACHKERN\n2. ZÜGE DES GEGENÜBERS\n3. WISSEN\n4. ÖFFNUNG\n5. NIEMALS\n${"Inhalt ".repeat(300)}`;
const antwort = (text: string) => ({ text, model: "m", ms: 1, tokens: {} });
const kunde = (id = "ws-kunde-abc123"): SimulationScenario => ({ ...getScenario("sim-coaching-morgan")!, id });
const doc = (id: string) => db.docs.get(`${SPIELBUCH_PARTITION}|${spielbuchDocId(id)}`) as { text: string; hash: string; failedAt?: string } | undefined;
const START = new Date("2026-11-12T10:00:00.000Z");

beforeEach(() => {
  db.docs.clear();
  claude.message.mockReset();
  claude.configured = true;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.COACH_SPIELBUCH;
});

describe("(a) Hash-Wächter", () => {
  it("die mitgelieferten Spielbücher passen zum Hash ihrer Szenarien", () => {
    expect(Object.keys(SPIELBUECHER_BUILTIN).sort()).toEqual(SIMULATION_SCENARIOS.map((s) => s.id).sort());
    for (const s of SIMULATION_SCENARIOS) expect(SPIELBUECHER_BUILTIN[s.id].hash, s.id).toBe(spielbuchHash(s));
  });

  it("eingebaute Szenarien: die Schreibweise der Anrede in Titel und Zielen zählt nicht, der Inhalt schon", () => {
    const lang = getScenario("sim-peer-lang")!;
    const klein = (t: string) => t.replace(/\b(Du|Dir|Dich|Deine?[mnrs]?)\b/g, (m) => m.toLowerCase());
    const ziele = lang.candidateBriefing.goals;
    expect(ziele.join(" ")).toMatch(/\b(Du|Dir)\b/); // sonst prüft der Fall nichts
    expect(spielbuchHash({ ...lang, candidateBriefing: { ...lang.candidateBriefing, goals: ziele.map(klein) } })).toBe(spielbuchHash(lang));
    expect(spielbuchHash({ ...lang, candidateBriefing: { ...lang.candidateBriefing, goals: [ziele[0], ziele[1], `${ziele[2]} Sofort.`] } })).not.toBe(spielbuchHash(lang));
    expect(spielbuchHash({ ...lang, personaDna: { ...lang.personaDna, openingLine: "Anders." } })).not.toBe(spielbuchHash(lang));
  });

  it("Kunden-Szenarien bleiben gebunden wie bisher (ihre gespeicherten Spielbücher gelten weiter)", () => {
    const s = kunde();
    const mitAnrede = { ...s, candidateBriefing: { ...s.candidateBriefing, goals: ["Halte Dir den Rücken frei.", "b", "c"] } };
    const klein = { ...s, candidateBriefing: { ...s.candidateBriefing, goals: ["Halte dir den Rücken frei.", "b", "c"] } };
    expect(spielbuchHash(mitAnrede)).not.toBe(spielbuchHash(klein));
  });
});

describe("(b) Fehlschlag 30 Minuten merken", () => {
  it("nach einem Fehlschlag startet 30 Minuten lang kein neuer Aufruf, danach wieder einer", async () => {
    const s = kunde();
    claude.message.mockRejectedValue(new Error("Modell nicht erreichbar"));
    expect(await ensureSpielbuch(s, { wait: true })).toBeNull();
    expect(claude.message).toHaveBeenCalledTimes(1);
    expect(doc(s.id)).toMatchObject({ text: "", hash: spielbuchHash(s), failedAt: START.toISOString() });

    // Jeder weitere Zug in der Pause: kein Aufruf.
    for (const minuten of [0, 5, 29]) {
      vi.setSystemTime(new Date(START.getTime() + minuten * 60_000));
      expect(await ensureSpielbuch(s, { wait: true })).toBeNull();
    }
    expect(claude.message).toHaveBeenCalledTimes(1);

    // Nach der Pause: neuer Versuch, der gelingt und den Fehlschlag überschreibt.
    vi.setSystemTime(new Date(START.getTime() + SPIELBUCH_FEHLER_PAUSE_MS + 1000));
    claude.message.mockResolvedValue(antwort(GUT));
    expect(await ensureSpielbuch(s, { wait: true })).toBe(GUT);
    expect(claude.message).toHaveBeenCalledTimes(2);
    expect(doc(s.id)?.failedAt).toBeUndefined();
    expect(await ensureSpielbuch(s)).toBe(GUT);
    expect(claude.message).toHaveBeenCalledTimes(2);
  });

  it("ein unplausibler Text gilt als Fehlschlag", async () => {
    const s = kunde();
    claude.message.mockResolvedValue(antwort("zu kurz"));
    expect(await ensureSpielbuch(s, { wait: true })).toBeNull();
    expect(doc(s.id)?.failedAt).toBe(START.toISOString());
    expect(await ensureSpielbuch(s, { wait: true })).toBeNull();
    expect(claude.message).toHaveBeenCalledTimes(1);
  });

  it("der Fehlschlag gilt nur für diesen Stand: ein überarbeitetes Szenario bekommt sofort einen Versuch", async () => {
    const s = kunde();
    claude.message.mockRejectedValue(new Error("x"));
    await ensureSpielbuch(s, { wait: true });
    const neu = { ...s, title: `${s.title} (überarbeitet)` };
    claude.message.mockResolvedValue(antwort(GUT));
    expect(await ensureSpielbuch(neu, { wait: true })).toBe(GUT);
    expect(claude.message).toHaveBeenCalledTimes(2);
  });
});

describe("(c) Stand der Vorbereitung für den Builder", () => {
  it("offen, läuft, bereit", async () => {
    const s = kunde();
    expect(await spielbuchStatus(s)).toBe("offen");
    let fertig!: (v: unknown) => void;
    claude.message.mockReturnValue(new Promise((r) => (fertig = r)));
    expect(await ensureSpielbuch(s)).toBeNull(); // läuft im Hintergrund
    expect(await spielbuchStatus(s)).toBe("laeuft");
    fertig(antwort(GUT));
    expect(await ensureSpielbuch(s, { wait: true })).toBe(GUT);
    expect(await spielbuchStatus(s)).toBe("bereit");
    expect(claude.message).toHaveBeenCalledTimes(1); // die Abfrage des Stands stößt nichts an
  });

  it("fehlgeschlagen nach einem Fehlschlag, auch nach der Pause, bis ein Versuch gelingt", async () => {
    const s = kunde();
    claude.message.mockRejectedValue(new Error("x"));
    await ensureSpielbuch(s, { wait: true });
    expect(await spielbuchStatus(s)).toBe("fehlgeschlagen");
    vi.setSystemTime(new Date(START.getTime() + SPIELBUCH_FEHLER_PAUSE_MS + 1000));
    expect(await spielbuchStatus(s)).toBe("fehlgeschlagen");
    expect(claude.message).toHaveBeenCalledTimes(1);
  });

  it("eingebautes Szenario: bereit aus dem Repo, ohne Datenbank und ohne Modell", async () => {
    expect(await spielbuchStatus(getScenario("sim-coaching-morgan")!)).toBe("bereit");
    expect(claude.message).not.toHaveBeenCalled();
  });

  it("nichts zu melden, wenn die Vorbereitung abgeschaltet oder nicht eingerichtet ist", async () => {
    claude.configured = false;
    expect(await spielbuchStatus(kunde())).toBeNull();
    claude.configured = true;
    process.env.COACH_SPIELBUCH = "off";
    expect(await spielbuchStatus(kunde())).toBeNull();
  });
});
