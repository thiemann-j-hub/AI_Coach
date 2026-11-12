import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Freier Testlauf im Builder (Owner-Entscheid 12.11.2026, Befund S29): Die erste Auswertung je neu erzeugtem
 * Szenario ist für die Person frei, die es gebaut hat. Geprüft wird die Ablage: genau einmal, nur für die
 * Erstellerin, nie für private oder eingebaute Szenarien, zwei gleichzeitige Aufrufe gewinnen nicht beide.
 */
const db = vi.hoisted(() => {
  const items = new Map<string, Record<string, unknown>>();
  let version = 0;
  return {
    items,
    next: () => `v${++version}`,
    reset: () => {
      items.clear();
      version = 0;
    },
    beforeReplace: null as null | (() => void),
  };
});

vi.mock("@/lib/cosmos", () => ({
  runsContainer: () => ({}),
  readItem: async (_c: unknown, id: string) => {
    const hit = db.items.get(id);
    return hit ? structuredClone(hit) : null;
  },
  upsertItem: async (_c: unknown, item: { id: string }) => {
    const saved = { ...item, _etag: db.next() };
    db.items.set(item.id, structuredClone(saved));
    return saved;
  },
  replaceItemIfMatch: async (_c: unknown, item: { id: string }, _pk: string, etag: string) => {
    db.beforeReplace?.();
    const current = db.items.get(item.id);
    if (!current || current._etag !== etag) throw Object.assign(new Error("precondition failed"), { code: 412 });
    const saved = { ...item, _etag: db.next() };
    db.items.set(item.id, structuredClone(saved));
    return saved;
  },
  queryItems: async () => [],
  deleteItem: async () => undefined,
}));
vi.mock("@/lib/server/credits/member-info", () => ({ getCentralMemberInfo: async () => ({ workspaceId: "w1" }) }));
vi.mock("@/lib/server/credits/workspace-store", () => ({ getWorkspaceIdForUser: async () => "w1" }));
vi.mock("@/lib/server/spielbuch/store", () => ({ deleteSpielbuch: async () => undefined }));
vi.mock("@/lib/simulation/scenario-schema", () => ({ validateScenario: (x: unknown) => x }));

import { claimFreeTestEval, releaseFreeTestEval, upsertWorkspaceScenario } from "./scenario-store";

const szenario = (id: string) => ({ id, title: "Test" });

describe("Freier Testlauf im Builder", () => {
  beforeEach(() => {
    db.reset();
    db.beforeReplace = null;
  });

  it("neu erzeugtes Szenario: die Erstellerin bekommt den Freilauf genau einmal", async () => {
    await upsertWorkspaceScenario("w1", szenario("ws-kunde-1"), { status: "draft", createdByUid: "u1" });
    expect(db.items.get("ws-kunde-1")!.freeTestEval).toBe("offen");
    expect(await claimFreeTestEval("u1", "o1", "ws-kunde-1")).toBe(true);
    expect(await claimFreeTestEval("u1", "o1", "ws-kunde-1")).toBe(false);
    expect(db.items.get("ws-kunde-1")!.freeTestEval).toBe("verbraucht");
  });

  it("andere Personen, private und eingebaute Szenarien bekommen keinen Freilauf", async () => {
    await upsertWorkspaceScenario("w1", szenario("ws-kunde-1"), { status: "draft", createdByUid: "u1" });
    expect(await claimFreeTestEval("u2", "o2", "ws-kunde-1")).toBe(false);
    expect(await claimFreeTestEval("u1", "o1", "ws-mein-abcd")).toBe(false);
    expect(await claimFreeTestEval("u1", "o1", "sim-coaching-morgan")).toBe(false);
    expect(db.items.get("ws-kunde-1")!.freeTestEval).toBe("offen");
  });

  it("Überarbeiten erneuert einen verbrauchten Freilauf nicht; Szenarien ohne Erstellerin haben keinen", async () => {
    await upsertWorkspaceScenario("w1", szenario("ws-kunde-1"), { status: "draft", createdByUid: "u1" });
    await claimFreeTestEval("u1", "o1", "ws-kunde-1");
    await upsertWorkspaceScenario("w1", szenario("ws-kunde-1"), { status: "draft", createdByUid: "u1" });
    expect(db.items.get("ws-kunde-1")!.freeTestEval).toBe("verbraucht");
    await upsertWorkspaceScenario("w1", szenario("ws-concierge-1"));
    expect(db.items.get("ws-concierge-1")!.freeTestEval).toBeUndefined();
  });

  it("zwei gleichzeitige Aufrufe: nur einer gewinnt", async () => {
    await upsertWorkspaceScenario("w1", szenario("ws-kunde-1"), { status: "draft", createdByUid: "u1" });
    let einmal = true;
    db.beforeReplace = () => {
      if (!einmal) return;
      einmal = false;
      // Der zweite Tab war schneller: Das Dokument trägt schon eine neue Version.
      const cur = db.items.get("ws-kunde-1")!;
      db.items.set("ws-kunde-1", { ...cur, freeTestEval: "verbraucht", _etag: db.next() });
    };
    expect(await claimFreeTestEval("u1", "o1", "ws-kunde-1")).toBe(false);
  });

  it("gescheiterte Auswertung gibt den Freilauf zurück", async () => {
    await upsertWorkspaceScenario("w1", szenario("ws-kunde-1"), { status: "draft", createdByUid: "u1" });
    await claimFreeTestEval("u1", "o1", "ws-kunde-1");
    expect(await releaseFreeTestEval("u1", "o1", "ws-kunde-1")).toBe(true);
    expect(await claimFreeTestEval("u1", "o1", "ws-kunde-1")).toBe(true);
  });
});
