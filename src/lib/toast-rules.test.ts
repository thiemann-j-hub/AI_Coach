/** W1-11: Meldungen mit Regeln — reine Regel ohne Oberfläche. */
import { describe, expect, it } from "vitest";
import { TOAST_DEFAULT_MS, toastDuration, toastStays } from "./toast-rules";

describe("toastDuration (W1-11)", () => {
  it("Fehler bleiben stehen, bis man sie schließt", () => {
    expect(toastDuration("error")).toBe(Infinity);
    expect(toastStays(toastDuration("error"))).toBe(true);
  });
  it("Erfolg, Info, Warnung und Standard verschwinden nach 5 s", () => {
    for (const k of ["success", "info", "warning", "default"] as const) {
      expect(toastDuration(k)).toBe(TOAST_DEFAULT_MS);
      expect(toastStays(toastDuration(k))).toBe(false);
    }
    expect(TOAST_DEFAULT_MS).toBe(5000);
  });
  it("Laden bleibt Sache des Aufrufers", () => {
    expect(toastDuration("loading")).toBeUndefined();
  });
  it("eine ausdrückliche Dauer des Aufrufers gewinnt", () => {
    expect(toastDuration("error", 8000)).toBe(8000);
    expect(toastDuration("success", Infinity)).toBe(Infinity);
  });
  it("Rückweg TOAST_RULES=off → Bibliotheks-Standard", () => {
    expect(toastDuration("error", undefined, false)).toBeUndefined();
    expect(toastDuration("success", undefined, false)).toBeUndefined();
    expect(toastDuration("error", 1234, false)).toBe(1234);
  });
});
