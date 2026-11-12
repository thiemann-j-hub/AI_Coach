import { describe, expect, it } from "vitest";
import { scenarioWishSchema } from "./scenario-wish-schema";

describe("scenarioWishSchema (§2.3)", () => {
  it("akzeptiert den vollen Kontext-Wunsch", () => {
    const r = scenarioWishSchema.safeParse({
      wishText: "Gehaltsgespräch mit einem Top-Performer, der kündigen könnte",
      category: "mitarbeiterfuehrung",
      locale: "de",
    });
    expect(r.success).toBe(true);
  });

  it("akzeptiert Minimalform (nur Text) und nullbare Kontexte", () => {
    expect(scenarioWishSchema.safeParse({ wishText: "abc" }).success).toBe(true);
    expect(scenarioWishSchema.safeParse({ wishText: "abc", category: null }).success).toBe(true);
  });

  it("weist zu kurzen/zu langen Text ab (3–500)", () => {
    expect(scenarioWishSchema.safeParse({ wishText: "ab" }).success).toBe(false);
    expect(scenarioWishSchema.safeParse({ wishText: "x".repeat(501) }).success).toBe(false);
  });

  it("weist unbekannte Kategorie ab", () => {
    expect(
      scenarioWishSchema.safeParse({ wishText: "abc", category: "sonstiges" }).success
    ).toBe(false);
  });

  it("überliest das frühere Feld weakestC (Paket 6, 12.11.2026: der Browser schickt es nicht mehr)", () => {
    const r = scenarioWishSchema.safeParse({ wishText: "abc", weakestC: "C5" });
    expect(r.success).toBe(true);
    expect(r.success && "weakestC" in r.data).toBe(false);
  });
});
