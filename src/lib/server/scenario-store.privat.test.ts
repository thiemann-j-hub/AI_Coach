import { describe, expect, it } from "vitest";
import { buildScenarioGeneratorPrompt } from "@/ai/flows/scenario-generator";
import {
  PRIVATE_SCENARIO_PREFIX,
  isPrivateScenarioId,
  privateScenarioExpired,
  privateScenarioPartitionKey,
  scenarioPartitionKey,
} from "./scenario-store";

describe("Welle 4 — private Szenarien („Mein echtes Gespräch vorbereiten“)", () => {
  it("liegen in einer eigenen Partition je Person, nie in der des Mandanten", () => {
    expect(privateScenarioPartitionKey("u1")).toBe("simscn-mein:u1");
    expect(privateScenarioPartitionKey("u1")).not.toBe(scenarioPartitionKey("u1"));
  });

  it("erkennt die Id-Klasse ws-mein-", () => {
    expect(isPrivateScenarioId(`${PRIVATE_SCENARIO_PREFIX}ab12`)).toBe(true);
    expect(isPrivateScenarioId("ws-kunde-123")).toBe(false);
    expect(isPrivateScenarioId("sim-coaching-morgan")).toBe(false);
  });

  it("verfällt nach dem Verfallsdatum, nicht davor", () => {
    const now = new Date("2026-11-01T10:00:00Z");
    expect(privateScenarioExpired({ expiresAt: "2026-11-01T09:59:59Z" }, now)).toBe(true);
    expect(privateScenarioExpired({ expiresAt: "2026-11-30T10:00:00Z" }, now)).toBe(false);
    expect(privateScenarioExpired({ expiresAt: "kaputt" }, now)).toBe(false);
  });

  it("der Generator bekommt die Anonymisierungsregel nur für private Szenarien", () => {
    const base = { brief: "Mein Projektleiter blockiert seit Wochen alles, was ich vorschlage, und ich will morgen klären, wie wir weiterarbeiten.", id: "ws-mein-abcd" };
    expect(buildScenarioGeneratorPrompt({ ...base, privat: true })).toContain("PRIVATES SZENARIO");
    expect(buildScenarioGeneratorPrompt({ ...base, privat: true })).toContain("Rollenbezeichnungen");
    expect(buildScenarioGeneratorPrompt(base)).not.toContain("PRIVATES SZENARIO");
  });
});
