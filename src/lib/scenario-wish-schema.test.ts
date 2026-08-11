import { describe, expect, it } from "vitest";
import { scenarioWishSchema } from "./scenario-wish-schema";

describe("scenarioWishSchema (§2.3)", () => {
  it("akzeptiert den vollen Kontext-Wunsch", () => {
    const r = scenarioWishSchema.safeParse({
      wishText: "Gehaltsgespräch mit einem Top-Performer, der kündigen könnte",
      category: "mitarbeiterfuehrung",
      weakestC: "C5",
      locale: "de",
    });
    expect(r.success).toBe(true);
  });

  it("akzeptiert Minimalform (nur Text) und nullbare Kontexte", () => {
    expect(scenarioWishSchema.safeParse({ wishText: "abc" }).success).toBe(true);
    expect(
      scenarioWishSchema.safeParse({ wishText: "abc", category: null, weakestC: null }).success
    ).toBe(true);
  });

  it("weist zu kurzen/zu langen Text ab (3–500)", () => {
    expect(scenarioWishSchema.safeParse({ wishText: "ab" }).success).toBe(false);
    expect(scenarioWishSchema.safeParse({ wishText: "x".repeat(501) }).success).toBe(false);
  });

  it("weist unbekannte Kategorie und kaputte C-Keys ab", () => {
    expect(
      scenarioWishSchema.safeParse({ wishText: "abc", category: "sonstiges" }).success
    ).toBe(false);
    for (const bad of ["C0", "C11", "c5", "C", "5"]) {
      expect(scenarioWishSchema.safeParse({ wishText: "abc", weakestC: bad }).success).toBe(false);
    }
    expect(scenarioWishSchema.safeParse({ wishText: "abc", weakestC: "C10" }).success).toBe(true);
  });
});
