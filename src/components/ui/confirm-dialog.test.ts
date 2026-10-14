/** W1-10: Wort-Bestätigung — reine Regel ohne Oberfläche. */
import { describe, expect, it } from "vitest";
import { typedWordMatches } from "./confirm-dialog";

describe("typedWordMatches (W1-10)", () => {
  it("ohne verlangtes Wort immer frei", () => {
    expect(typedWordMatches(null, "")).toBe(true);
  });
  it("leer oder falsch sperrt", () => {
    expect(typedWordMatches("LÖSCHEN", "")).toBe(false);
    expect(typedWordMatches("LÖSCHEN", "LÖSCHE")).toBe(false);
    expect(typedWordMatches("LÖSCHEN", "ja")).toBe(false);
  });
  it("Groß/Klein und Rand-Leerzeichen sind egal", () => {
    expect(typedWordMatches("LÖSCHEN", "löschen")).toBe(true);
    expect(typedWordMatches("LÖSCHEN", "  Löschen ")).toBe(true);
    expect(typedWordMatches("DELETE", "delete")).toBe(true);
  });
});
