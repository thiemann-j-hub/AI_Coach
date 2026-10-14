#!/usr/bin/env node
/**
 * W1-12 (LXT-Welle W1, Owner-GO 14.10.2026): Sprach-Wächter im Deploy-Tor.
 *
 * Vorbild LXT (Tiefenanalyse Anhang F §4.1–4.6): dort stehen 9 % Sie-Texte neben Du-Texten, 24× kleines
 * „du“, Anbieternamen (OpenAI) in Fehlertexten, englische Reste, ein Tooltip mit 95 Wörtern — alles
 * Altbestand, den niemand prüft. Hier prüft ein Skript die deutschen Oberflächentexte vor jedem Build:
 *   1. Sie-Formen (Sie/Ihnen/Ihr…)            — die Du-Regel des Owners
 *   2. kleines du/dein/dir/dich/euch            — „Du“ wird groß geschrieben
 *   3. Anbieternamen (OpenAI, Gemini, Vertex…) — Nutzer sehen keine Technik
 *   4. verbotene Wörter („drei Apps“, „Wallet“) — Marketing-Regel „EINE Plattform“
 *   5. Tooltips/Hinweise über 25 Wörter        — kurz halten
 *   6. englische Reste in deutschen Texten
 * Dieselbe Datei in allen vier Apps (Studio, Coach, Jobmap, Hub); die Textquellen erkennt sie selbst.
 * Altbestand steht in scripts/sprach-regel.allow.json (Schlüssel je Datei#Pfad) — neue Verstöße blockieren.
 *   node scripts/sprach-regel.mjs            → blockiert bei neuen Funden (Deploy-Tor)
 *   node scripts/sprach-regel.mjs --report   → listet alle Funde, blockiert nie
 *   node scripts/sprach-regel.mjs --write-allow → schreibt die heutigen Funde als Ausnahmeliste
 * Rückweg: SPRACH_REGEL=warn → nur Warnung, Build läuft weiter.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const report = args.has("--report");
const writeAllow = args.has("--write-allow");
const warnOnly = (process.env.SPRACH_REGEL ?? "").trim().toLowerCase() === "warn";
const allowPath = path.join(root, "scripts", "sprach-regel.allow.json");

// ---------- Textquellen (deutsch) ----------
const sources = [];
const add = (file, texts) => { if (texts.length) sources.push({ file, texts }); };
const flattenJson = (obj, prefix, out) => {
  if (typeof obj === "string") out.push([prefix, obj]);
  else if (Array.isArray(obj)) obj.forEach((v, i) => flattenJson(v, `${prefix}[${i}]`, out));
  else if (obj && typeof obj === "object") for (const [k, v] of Object.entries(obj)) flattenJson(v, prefix ? `${prefix}.${k}` : k, out);
};
const readJson = (p) => { const out = []; flattenJson(JSON.parse(fs.readFileSync(p, "utf8")), "", out); return out; };
// Studio: messages/de/*.json
const studioDir = path.join(root, "messages", "de");
if (fs.existsSync(studioDir)) for (const f of fs.readdirSync(studioDir).filter((n) => n.endsWith(".json"))) add(`messages/de/${f}`, readJson(path.join(studioDir, f)));
// Coach: src/i18n/dictionaries/de.json
const coachDict = path.join(root, "src", "i18n", "dictionaries", "de.json");
if (fs.existsSync(coachDict)) add("src/i18n/dictionaries/de.json", readJson(coachDict));
// Jobmap: api-error-texts.json (nur "de"-Zweige)
const jobmapErr = path.join(root, "src", "config", "api-error-texts.json");
if (fs.existsSync(jobmapErr)) add("src/config/api-error-texts.json", readJson(jobmapErr).filter(([k]) => /(^|\.)de(\.|$)/.test(k)));
// Hub: src/i18n/messages/de.ts — Zeichenketten je `key: "…"` (keine TS-Auswertung nötig)
const hubDe = path.join(root, "src", "i18n", "messages", "de.ts");
if (fs.existsSync(hubDe)) {
  const src = fs.readFileSync(hubDe, "utf8");
  const out = [];
  const re = /(\w+)\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m; const seen = new Map();
  while ((m = re.exec(src))) {
    const n = (seen.get(m[1]) ?? 0) + 1; seen.set(m[1], n);
    out.push([n > 1 ? `${m[1]}#${n}` : m[1], m[2].replace(/\\"/g, '"')]);
  }
  add("src/i18n/messages/de.ts", out);
}
if (!sources.length) { console.log("Sprach-Regel: keine deutschen Textquellen gefunden — nichts zu prüfen."); process.exit(0); }

// ---------- Regeln ----------
const RULES = [
  { kind: "Sie-Form", re: /\b(Sie|Ihnen|Ihrem|Ihren|Ihrer|Ihres|Ihre|Ihr)\b/g, test: (t, m) => !/^(Sie|Ihr)$/.test(m[1]) || !/^\s*(Sie|Ihr)\b/.test(t) || true },
  { kind: "kleines du", re: /(^|[^\wäöüß])(du|dein|deine|deinen|deinem|deiner|deines|dir|dich|euch|euer|eure)(?![\wäöüß])/g },
  { kind: "Anbietername", re: /\b(OpenAI|ChatGPT|GPT-?\d?|Gemini|Vertex|Anthropic|Claude|Firebase|Cosmos ?DB|Azure OpenAI)\b/g },
  { kind: "verbotenes Wort", re: /\b(drei Apps|Wallet|Credit-Wallet)\b/g },
  { kind: "englischer Rest", re: /\b(the|and|please|loading|cancel|submit|retry|settings|success|failed|your|you)\b/gi, skip: (t) => /https?:\/\//.test(t) },
];
const TOOLTIP_KEY = /tooltip|hint|help|title$/i;
const MAX_TOOLTIP_WORDS = 25;

const isCodeLike = (t) => /^\s*$/.test(t) || /^[\w.\-/:{}]+$/.test(t) || /^[A-Z0-9_\-]+$/.test(t);
const findings = [];
for (const { file, texts } of sources) {
  for (const [key, text] of texts) {
    if (isCodeLike(text)) continue;
    const plain = text.replace(/\{[^}]*\}/g, " ");
    for (const rule of RULES) {
      if (rule.skip?.(text)) continue;
      const m = plain.match(rule.re);
      if (m) findings.push({ file, key, kind: rule.kind, hit: [...new Set(m.map((s) => s.trim()))].slice(0, 3).join(", "), text });
    }
    if (TOOLTIP_KEY.test(key) && plain.split(/\s+/).filter(Boolean).length > MAX_TOOLTIP_WORDS) {
      findings.push({ file, key, kind: `Hinweis > ${MAX_TOOLTIP_WORDS} Wörter`, hit: `${plain.split(/\s+/).filter(Boolean).length} Wörter`, text });
    }
  }
}

// ---------- Ausnahmeliste ----------
const id = (f) => `${f.file}#${f.key}#${f.kind}`;
let allow = new Set();
if (fs.existsSync(allowPath)) allow = new Set(JSON.parse(fs.readFileSync(allowPath, "utf8")));
if (writeAllow) {
  fs.writeFileSync(allowPath, JSON.stringify([...new Set(findings.map(id))].sort(), null, 2) + "\n");
  console.log(`Sprach-Regel: ${findings.length} Funde als Ausnahmeliste geschrieben → ${path.relative(root, allowPath)}`);
}
const fresh = findings.filter((f) => !allow.has(id(f)));

// ---------- Ausgabe ----------
const byKind = {};
for (const f of findings) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
const summary = Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(" · ") || "keine";
console.log(`Sprach-Regel: ${sources.reduce((n, s) => n + s.texts.length, 0)} deutsche Texte in ${sources.length} Datei(en) geprüft · Funde gesamt ${findings.length} (${summary}) · Ausnahmen ${allow.size} · neu ${fresh.length}`);
const list = report ? findings : fresh;
for (const f of list.slice(0, 400)) console.log(`  [${f.kind}] ${f.file} › ${f.key} — ${f.hit} — „${f.text.slice(0, 90)}${f.text.length > 90 ? "…" : ""}“`);
if (list.length > 400) console.log(`  … und ${list.length - 400} weitere`);

if (report || writeAllow) process.exit(0);
if (fresh.length) {
  if (warnOnly) { console.warn(`⚠ Sprach-Regel: ${fresh.length} neue Funde (SPRACH_REGEL=warn → Build läuft weiter).`); process.exit(0); }
  console.error(`✗ Sprach-Regel verletzt: ${fresh.length} neue Funde. Text ändern (Du groß, keine Sie-Form, keine Anbieternamen) oder bewusst in scripts/sprach-regel.allow.json aufnehmen.`);
  process.exit(1);
}
console.log("✓ Sprach-Regel eingehalten.");
