import { describe, expect, it } from "vitest";
import { createTicketStore } from "./ticket-store";

const karte = { uid: "u1", email: "a@b.de", oid: "o1", simId: "sim-1" };

describe("Live-Eintrittskarten", () => {
  it("gilt genau einmal", () => {
    const store = createTicketStore();
    const id = store.issue(karte, 1_000);
    expect(id.length).toBeGreaterThan(20);
    expect(store.redeem(id, 2_000)).toEqual(karte);
    expect(store.redeem(id, 2_000)).toBeNull();
  });

  it("verfällt nach 60 Sekunden", () => {
    const store = createTicketStore(60_000);
    const id = store.issue(karte, 1_000);
    expect(store.redeem(id, 61_001)).toBeNull();
  });

  it("kennt keine fremden Karten und räumt alte weg", () => {
    const store = createTicketStore(60_000);
    store.issue(karte, 1_000);
    expect(store.redeem("gibt-es-nicht", 1_000)).toBeNull();
    expect(store.size()).toBe(1);
    store.issue({ ...karte, simId: "sim-2" }, 70_000);
    expect(store.size()).toBe(1);
  });
});
