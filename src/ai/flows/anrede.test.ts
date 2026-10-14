import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { anredeBlock, withAnrede } from "@/lib/anrede";

/** W1-5: jede KI-Stelle, die zur übenden Person spricht, trägt die Anrede-Regel; die Spielfigur bleibt frei, dynamic-feedback delegiert an tailored-feedback. */
describe("Anrede-Regel in den Flows (W1-5)", () => {
  const dir = __dirname;
  const flows = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  it("alle Flows außer der Spielfigur binden anredeBlock ein", () => {
    const missing = flows.filter((f) => f !== "simulation-persona.ts" && f !== "generate-dynamic-feedback.ts" && !readFileSync(path.join(dir, f), "utf8").includes("anredeBlock("));
    expect(missing).toEqual([]);
  });
  it("die Regel verlangt Du groß und verbietet Sie", () => {
    const b = anredeBlock();
    expect(b).toMatch(/Du, Dein, Deine, Dir, Dich immer groß/);
    expect(b).toMatch(/nie „Sie“/);
  });
  it("withAnrede ist idempotent und abschaltbar", () => {
    const once = withAnrede("SYSTEM");
    expect(withAnrede(once)).toBe(once);
    process.env.ADDRESS_PARAM = "off";
    expect(withAnrede("SYSTEM")).toBe("SYSTEM");
    delete process.env.ADDRESS_PARAM;
  });
});
