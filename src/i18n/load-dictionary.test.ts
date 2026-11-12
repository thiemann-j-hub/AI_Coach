import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import { defaultLocale, locales, type Locale } from "./config";
import type { Dictionary } from "./dictionaries";
import { createLanguageSwitcher, loadDictionary } from "./load-dictionary";

/**
 * Paket 6, C21 (12.11.2026): Der Browser lädt nur noch die aktive Sprache. Geprüft wird, was das still
 * wieder kippen würde: ein fester Import aller Wörterbücher im Browser-Code, eine vertauschte Sprache in
 * der Lade-Tabelle und ein Sprachwechsel, bei dem die falsche Anfrage gewinnt.
 */
const SRC = join(__dirname, "..");
const fromFile = (locale: string): Dictionary =>
  JSON.parse(readFileSync(join(__dirname, "dictionaries", `${locale}.json`), "utf8"));

/** Alle festen Importe einer Datei, die beim Bauen im Bündel landen (`import type` fällt beim Bauen weg). */
function staticImports(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/^import\s+(type\s+)?(?:[^;'"]*?\sfrom\s+)?["']([^"']+)["']/gm)) {
    if (!m[1]) out.push(m[2]);
  }
  return out;
}
const isDictionaryImport = (specifier: string) =>
  /(^|\/)dictionaries(\/index)?$/.test(specifier) || /(^|\/)dictionaries\/[a-z]{2}\.json$/.test(specifier);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("loadDictionary — Browser-Zugriff auf die Wörterbücher", () => {
  it.each([...locales])("%s lädt genau die eigene Datei", async (locale) => {
    expect(await loadDictionary(locale)).toEqual(fromFile(locale));
  });

  it("unbekannte Sprache fällt auf Englisch zurück", async () => {
    expect(defaultLocale).toBe("en");
    expect(await loadDictionary("xx")).toEqual(fromFile("en"));
    expect(await loadDictionary("")).toEqual(fromFile("en"));
  });
});

describe("Browser-Bündel — kein Wörterbuch fest importiert", () => {
  it("die Lade-Datei importiert jede der 22 Sprachen nur dynamisch", () => {
    const source = readFileSync(join(__dirname, "load-dictionary.ts"), "utf8");
    expect(staticImports(source).filter(isDictionaryImport)).toEqual([]);
    const dynamic = [...source.matchAll(/import\(\s*(?:\/\*[^*]*\*\/\s*)?["']\.\/dictionaries\/([a-z]{2})\.json["']\s*\)/g)].map((m) => m[1]);
    expect(dynamic.sort()).toEqual([...locales].sort());
  });

  it("der Server-Zugriff ist als server-only markiert", () => {
    const source = readFileSync(join(__dirname, "dictionaries", "index.ts"), "utf8");
    expect(staticImports(source)).toContain("server-only");
  });

  it("keine Browser-Datei (\"use client\") importiert die Wörterbücher fest", () => {
    const offenders = sourceFiles(SRC).filter((file) => {
      const source = readFileSync(file, "utf8").replace(/^﻿/, "");
      const browser = /^\s*["']use client["']/.test(source) || file === join(__dirname, "load-dictionary.ts");
      return browser && staticImports(source).some(isDictionaryImport);
    });
    // Abhilfe: nur den Typ holen (`import type { Dictionary } …`), Texte über useTranslation() lesen.
    expect(offenders.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });
});

describe("createLanguageSwitcher — es gilt die jüngste Anfrage", () => {
  const dict = (name: string) => ({ name }) as unknown as Dictionary;
  const active = { locale: "de" as Locale, t: dict("de") };

  it("lädt die neue Sprache und liefert ihr Wörterbuch", async () => {
    const load = vi.fn(async (l: Locale) => dict(l));
    const switchTo = createLanguageSwitcher(load);
    expect(await switchTo("fr", active)).toEqual({ status: "ok", t: dict("fr") });
    expect(load).toHaveBeenCalledWith("fr");
  });

  it("die aktive Sprache wird nicht noch einmal geladen", async () => {
    const load = vi.fn(async (l: Locale) => dict(l));
    const switchTo = createLanguageSwitcher(load);
    expect(await switchTo("de", active)).toEqual({ status: "ok", t: active.t });
    expect(load).not.toHaveBeenCalled();
  });

  it("der Weg zurück zur Sprache vom Server lädt nichts nach", async () => {
    const load = vi.fn(async (l: Locale) => dict(l));
    const switchTo = createLanguageSwitcher(load);
    const fr = await switchTo("fr", active);
    if (fr.status !== "ok") throw new Error("Wechsel auf fr gescheitert");
    expect(await switchTo("de", { locale: "fr", t: fr.t })).toEqual({ status: "ok", t: active.t });
    expect(await switchTo("fr", active)).toEqual({ status: "ok", t: fr.t });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("scheitert das Laden, meldet der Wechsel das, statt zu werfen", async () => {
    const switchTo = createLanguageSwitcher(async () => {
      throw new Error("ChunkLoadError");
    });
    expect(await switchTo("fr", active)).toEqual({ status: "failed" });
  });

  it("zwei schnelle Wechsel: der spätere gewinnt, auch wenn der frühere später fertig wird", async () => {
    const release: Partial<Record<Locale, (d: Dictionary) => void>> = {};
    const switchTo = createLanguageSwitcher((l) => new Promise<Dictionary>((resolve) => { release[l] = resolve; }));
    const first = switchTo("fr", active);
    const second = switchTo("it", active);
    release.it?.(dict("it"));
    release.fr?.(dict("fr"));
    expect(await second).toEqual({ status: "ok", t: dict("it") });
    expect(await first).toEqual({ status: "superseded" });
  });

  it("ein überholter Wechsel, der scheitert, löst keine Fehlermeldung aus", async () => {
    let failFirst: (e: Error) => void = () => {};
    const switchTo = createLanguageSwitcher((l) =>
      l === "fr" ? new Promise<Dictionary>((_, reject) => { failFirst = reject; }) : Promise.resolve(dict(l)),
    );
    const first = switchTo("fr", active);
    const second = switchTo("it", active);
    failFirst(new Error("offline"));
    expect(await first).toEqual({ status: "superseded" });
    expect(await second).toEqual({ status: "ok", t: dict("it") });
  });
});
