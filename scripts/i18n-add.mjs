#!/usr/bin/env node
/**
 * Neue Oberflächentexte in alle 22 Wörterbücher eintragen (12.11.2026, Coach-Pakete 1–6).
 *
 * Anlass: Jeder neue Schlüssel muss in allen 22 Dateien stehen (src/i18n/dictionaries.test.ts prüft das).
 * Von Hand führt das zu halben Ständen, und mehrere gleichzeitige Bearbeiter überschreiben sich.
 * Dieses Skript trägt einen Satz Schlüssel in einem Zug in alle Dateien ein, mit einer Sperre.
 *
 *   node scripts/i18n-add.mjs <datei.json>            neue Schlüssel eintragen (vorhandene → Abbruch)
 *   node scripts/i18n-add.mjs <datei.json> --update   vorhandene Schlüssel überschreiben
 *   node scripts/i18n-add.mjs --remove a.b.c [a.b.d]  Schlüssel aus allen 22 Dateien entfernen
 *
 * Format der Eingabedatei: { "simulation.neuerSchluessel": { "de": "…", "en": "…", …alle 22 Sprachen } }
 * Fehlt eine Sprache oder ist ein Text leer, wird NICHTS geschrieben.
 */
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "src", "i18n", "dictionaries");
const LOCK = path.join(process.cwd(), ".i18n-add.lock");
const args = process.argv.slice(2);
const update = args.includes("--update");
const removeMode = args.includes("--remove");
const rest = args.filter((a) => !a.startsWith("--"));

let locked = false;
const fail = (msg) => {
  console.error(`i18n-add: ${msg}`);
  if (locked) { try { fs.rmdirSync(LOCK); } catch { /* schon weg */ } }
  process.exit(1);
};

if (!fs.existsSync(DIR)) fail(`Ordner fehlt: ${DIR} (im Repo-Stamm aufrufen)`);
const locales = fs.readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
if (locales.length !== 22) fail(`erwartet 22 Wörterbücher, gefunden ${locales.length}`);

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function lock() {
  for (let i = 0; i < 240; i++) {
    try {
      fs.mkdirSync(LOCK);
      locked = true;
      return;
    } catch {
      // Verwaiste Sperre (älter als zwei Minuten) räumen.
      try {
        if (Date.now() - fs.statSync(LOCK).mtimeMs > 120_000) fs.rmdirSync(LOCK);
      } catch { /* gerade freigegeben */ }
      sleep(250);
    }
  }
  fail("Sperre nicht bekommen (.i18n-add.lock)");
}
const unlock = () => { locked = false; try { fs.rmdirSync(LOCK); } catch { /* schon weg */ } };

function read(locale) {
  const file = path.join(DIR, `${locale}.json`);
  const raw = fs.readFileSync(file, "utf8");
  return { file, eol: raw.includes("\r\n") ? "\r\n" : "\n", data: JSON.parse(raw) };
}
function write({ file, eol, data }) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2).replace(/\n/g, eol) + eol, "utf8");
}
function parent(obj, parts, create) {
  let cur = obj;
  for (const p of parts.slice(0, -1)) {
    if (cur[p] === undefined) {
      if (!create) return null;
      cur[p] = {};
    }
    if (typeof cur[p] !== "object" || cur[p] === null) fail(`„${parts.join(".")}“: „${p}“ ist kein Abschnitt`);
    cur = cur[p];
  }
  return cur;
}

if (removeMode) {
  if (!rest.length) fail("--remove braucht mindestens einen Schlüssel");
  lock();
  try {
    const dicts = locales.map(read);
    for (const key of rest) {
      const parts = key.split(".");
      for (const d of dicts) {
        const par = parent(d.data, parts, false);
        if (!par || !(parts.at(-1) in par)) fail(`„${key}“ fehlt in ${path.basename(d.file)} — nichts geschrieben`);
        delete par[parts.at(-1)];
        // Leer gewordene Abschnitte mit entfernen (sonst bleibt ein leerer Rest in allen 22 Dateien).
        for (let depth = parts.length - 1; depth >= 1; depth--) {
          const holder = parent(d.data, parts.slice(0, depth), false);
          const name = parts[depth - 1];
          if (holder && holder[name] && typeof holder[name] === "object" && !Object.keys(holder[name]).length) delete holder[name];
          else break;
        }
      }
    }
    dicts.forEach(write);
    console.log(`i18n-add: ${rest.length} Schlüssel aus ${dicts.length} Wörterbüchern entfernt`);
  } finally {
    unlock();
  }
  process.exit(0);
}

if (rest.length !== 1) fail("Aufruf: node scripts/i18n-add.mjs <datei.json> [--update]");
const input = JSON.parse(fs.readFileSync(rest[0], "utf8"));
const keys = Object.keys(input);
if (!keys.length) fail("Eingabedatei ist leer");
for (const key of keys) {
  if (!/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$/.test(key)) fail(`ungültiger Schlüssel „${key}“ (erwartet abschnitt.name)`);
  for (const l of locales) {
    const v = input[key]?.[l];
    if (typeof v !== "string" || !v.trim()) fail(`„${key}“: Text für „${l}“ fehlt — nichts geschrieben`);
  }
  const extra = Object.keys(input[key]).filter((l) => !locales.includes(l));
  if (extra.length) fail(`„${key}“: unbekannte Sprache ${extra.join(", ")}`);
}

lock();
try {
  const dicts = locales.map((l) => ({ locale: l, ...read(l) }));
  for (const key of keys) {
    const parts = key.split(".");
    for (const d of dicts) {
      const par = parent(d.data, parts, true);
      const leaf = parts.at(-1);
      if (leaf in par && !update) fail(`„${key}“ gibt es schon in ${d.locale}.json (--update zum Überschreiben) — nichts geschrieben`);
      if (typeof par[leaf] === "object" && par[leaf] !== null) fail(`„${key}“ ist ein Abschnitt, kein Text`);
      par[leaf] = input[key][d.locale];
    }
  }
  dicts.forEach(write);
  console.log(`i18n-add: ${keys.length} Schlüssel in ${dicts.length} Wörterbücher eingetragen`);
} finally {
  unlock();
}
