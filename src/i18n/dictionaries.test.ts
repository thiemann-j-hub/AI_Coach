import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * i18n-Vollständigkeit (COACH-UX-BLUEPRINT §8): alle 22 Dictionaries müssen
 * strukturell IDENTISCH zu en.json sein — fehlende Keys erscheinen sonst als
 * `undefined` in 21 Sprachen und fallen erst beim Kunden auf.
 */
const DIR = join(__dirname, "dictionaries");

function keyPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...keyPaths(v as Record<string, unknown>, p));
    } else {
      out.push(p);
    }
  }
  return out.sort();
}

describe("dictionaries — strukturelle Parität (×22)", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
  const en = keyPaths(JSON.parse(readFileSync(join(DIR, "en.json"), "utf8")));

  it("es gibt genau 22 Dictionaries", () => {
    expect(files.length).toBe(22);
  });

  it.each(files.filter((f) => f !== "en.json"))("%s hat exakt die en-Keys", (f) => {
    const paths = keyPaths(JSON.parse(readFileSync(join(DIR, f), "utf8")));
    const missing = en.filter((k) => !paths.includes(k));
    const extra = paths.filter((k) => !en.includes(k));
    expect(missing, `fehlend in ${f}`).toEqual([]);
    expect(extra, `überzählig in ${f}`).toEqual([]);
  });

  it.each(files)("%s: kein Wert ist leer", (f) => {
    const dict = JSON.parse(readFileSync(join(DIR, f), "utf8"));
    const walk = (o: Record<string, unknown>, p: string) => {
      for (const [k, v] of Object.entries(o)) {
        const np = p ? `${p}.${k}` : k;
        if (v && typeof v === "object") walk(v as Record<string, unknown>, np);
        else expect(String(v ?? "").length, `${f}: ${np}`).toBeGreaterThan(0);
      }
    };
    walk(dict, "");
  });
});
