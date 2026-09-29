import { describe, expect, it } from "vitest";
import { MAX_EUR_PER_CREDIT, RUN_CREDITS, formatMaxEur, maxEurHint } from "./pricing-display";

describe("pricing-display (Preis vor dem Klick, 29.09.2026)", () => {
  it("fester Maximalkurs 4,90 € je Credit, ein Lauf = 1 Credit", () => {
    expect(MAX_EUR_PER_CREDIT).toBe(4.9);
    expect(RUN_CREDITS).toBe(1);
  });

  it("formatiert den Maximalpreis in der Sprache der Oberfläche", () => {
    expect(formatMaxEur(1, "de")).toBe("4,90 €");
    expect(formatMaxEur(1, "en")).toBe("€4.90");
    expect(formatMaxEur(3, "de")).toBe("14,70 €");
  });

  it("setzt den Betrag in die übersetzte Vorlage ein", () => {
    expect(maxEurHint("bis zu {eur}", "de")).toBe("bis zu 4,90 €");
    expect(maxEurHint("up to {eur}", "en")).toBe("up to €4.90");
  });

  it("fällt bei unbekannter Sprache nicht um", () => {
    expect(formatMaxEur(1, "xx-invalid-locale-tag-!!")).toMatch(/4[.,]90/);
  });
});
