import { describe, expect, it } from "vitest";
import type { SimulationTurn } from "@/lib/simulation/types";
import {
  SIM_MAX_TURN_CHARS,
  SIM_MAX_USER_TURNS,
  assembleTranscript,
  countUserTurns,
  simPartitionKey,
} from "./simulation-store";

const turns: SimulationTurn[] = [
  { role: "persona", text: "Guten Tag.", ts: "2026-07-30T10:00:00.000Z" },
  { role: "user", text: "Danke, dass Sie sich Zeit nehmen.", ts: "2026-07-30T10:00:10.000Z" },
  { role: "persona", text: "Worum geht es?", ts: "2026-07-30T10:00:20.000Z" },
  { role: "user", text: "Um unsere Zusammenarbeit.", ts: "2026-07-30T10:00:30.000Z" },
];

describe("simulation-store (pure)", () => {
  it("simPartitionKey bindet die Partition an den User", () => {
    expect(simPartitionKey("u1")).toBe("sim:u1");
    expect(simPartitionKey("u1")).not.toBe(simPartitionKey("u2"));
  });

  it("countUserTurns zählt nur User-Beiträge", () => {
    expect(countUserTurns(turns)).toBe(2);
    expect(countUserTurns([])).toBe(0);
  });

  it("assembleTranscript labelt Sprecher und trennt mit Leerzeile", () => {
    const t = assembleTranscript(turns, "Viktor Lang");
    expect(t).toContain("Viktor Lang: Guten Tag.");
    expect(t).toContain("Teilnehmer:in: Danke, dass Sie sich Zeit nehmen.");
    expect(t.split("\n\n")).toHaveLength(4);
  });

  it("Kappen sind gesetzt (Kosten-/Doc-Schutz)", () => {
    expect(SIM_MAX_USER_TURNS).toBeGreaterThanOrEqual(20);
    expect(SIM_MAX_TURN_CHARS).toBeGreaterThanOrEqual(500);
  });
});
