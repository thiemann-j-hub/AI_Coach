import { describe, expect, it, vi } from "vitest";

/**
 * Buchungs-Kennung der Auswertung (Paket 2, C4, 12.11.2026). Der Geldweg als Ganzes (vermerken, buchen, rechnen,
 * speichern, zurückbuchen) wird über die Route geprüft: src/app/api/simulation/finish/route.test.ts.
 */
vi.mock("@/ai/flows/simulation-feedback", () => ({ RICHTER_OPUS_TIMEOUT_MS: 110_000, judgeSimulation: vi.fn() }));
vi.mock("@/ai/flows/score-competencies", () => ({ scoreCompetencies: vi.fn() }));
vi.mock("@/ai/flows/simulation-regie", () => ({ regieVerlaufText: () => "" }));
vi.mock("@/lib/server/credits/entitlement", () => ({ compensateEntitlement: vi.fn(), reserveEntitlement: vi.fn() }));

import { finishChargeKey } from "./simulation-finish";

describe("finishChargeKey", () => {
  it("leitet die Kennung aus Lauf und Zahl der Rückbuchungen ab — gleiche Anfrage, gleiche Kennung", () => {
    expect(finishChargeKey("sim-abcdefgh", 0)).toBe("sim-finish:sim-abcdefgh:0");
    expect(finishChargeKey("sim-abcdefgh", 0)).toBe(finishChargeKey("sim-abcdefgh", undefined));
    expect(finishChargeKey("sim-abcdefgh", null)).toBe("sim-finish:sim-abcdefgh:0");
  });

  it("nach jeder Rückbuchung eine neue Kennung", () => {
    expect(finishChargeKey("sim-abcdefgh", 1)).toBe("sim-finish:sim-abcdefgh:1");
    expect(finishChargeKey("sim-abcdefgh", 2)).not.toBe(finishChargeKey("sim-abcdefgh", 1));
  });

  it("unsinnige Zählerstände fallen auf 0 zurück", () => {
    expect(finishChargeKey("sim-abcdefgh", -1)).toBe("sim-finish:sim-abcdefgh:0");
    expect(finishChargeKey("sim-abcdefgh", 1.5)).toBe("sim-finish:sim-abcdefgh:0");
  });
});
