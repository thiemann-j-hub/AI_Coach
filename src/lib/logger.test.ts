import { afterEach, describe, expect, it, vi } from "vitest";
import { STACK_MAX_CHARS, STACK_MAX_FRAMES, logger, shortStack } from "./logger";

/**
 * Paket 6, C38 (12.11.2026): Bei Fehlern steht die Stelle im Code im Protokoll — gekürzt, ohne die Meldung
 * doppelt zu schreiben.
 */
describe("shortStack", () => {
  it("nur Aufruferzeilen, ohne die Meldung, höchstens sechs", () => {
    const err = new Error("Speicher nicht erreichbar");
    err.stack = ["Error: Speicher nicht erreichbar", ...Array.from({ length: 12 }, (_, i) => `    at schritt${i} (datei.ts:${i}:1)`)].join("\n");
    const s = shortStack(err)!;
    expect(s).not.toContain("Speicher nicht erreichbar");
    expect(s.split(" | ")).toHaveLength(STACK_MAX_FRAMES);
    expect(s.startsWith("at schritt0 (datei.ts:0:1) | at schritt1")).toBe(true);
  });

  it("gekürzt auf die Höchstlänge", () => {
    const err = new Error("x");
    err.stack = ["Error: x", ...Array.from({ length: 6 }, () => `    at ${"a".repeat(400)} (datei.ts:1:1)`)].join("\n");
    expect(shortStack(err)!.length).toBe(STACK_MAX_CHARS);
  });

  it("kein Error, kein Stack oder keine Aufruferzeile → undefined", () => {
    expect(shortStack("kaputt")).toBeUndefined();
    expect(shortStack(null)).toBeUndefined();
    const ohne = new Error("x");
    ohne.stack = undefined;
    expect(shortStack(ohne)).toBeUndefined();
    ohne.stack = "Error: x";
    expect(shortStack(ohne)).toBeUndefined();
  });
});

describe("logger.apiError", () => {
  afterEach(() => vi.restoreAllMocks());

  it("schreibt eine JSON-Zeile mit Route, Fehlername, gekürztem Stack und den Zusatzangaben", () => {
    const zeilen: string[] = [];
    vi.spyOn(console, "error").mockImplementation((l: unknown) => void zeilen.push(String(l)));
    logger.apiError("/api/test", new TypeError("geht nicht"), { simId: "sim-1" });
    expect(zeilen).toHaveLength(1);
    const e = JSON.parse(zeilen[0]);
    expect(e).toMatchObject({ level: "error", message: "[API] /api/test – geht nicht", route: "/api/test", errorName: "TypeError", simId: "sim-1" });
    expect(e.stack).toMatch(/^at /);
    expect(e.stack).not.toContain("geht nicht");
  });

  it("ohne Error-Objekt: Meldung als Text, kein Stack", () => {
    const zeilen: string[] = [];
    vi.spyOn(console, "error").mockImplementation((l: unknown) => void zeilen.push(String(l)));
    logger.apiError("/api/test", "nur Text");
    const e = JSON.parse(zeilen[0]);
    expect(e.message).toBe("[API] /api/test – nur Text");
    expect(e).not.toHaveProperty("stack");
    expect(e).not.toHaveProperty("errorName");
  });
});
