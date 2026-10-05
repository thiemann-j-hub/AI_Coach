#!/usr/bin/env node
/**
 * Rahmen-Regel (Owner-Vorgabe 05.10.2026, pulsenorth-ops SHELL-STANDARD-LOOK-AND-FEEL.md Teil 2.7)
 *
 * Jeder umrandete Kasten in der Oberfläche gehört zu genau einer von drei Arten:
 *   pn-field   Eingabefeld (hier tippt oder legt man etwas ab): grauer Rahmen, KEIN Schatten.
 *   pn-tile    Kachel (zeigt Inhalte, Ergebnisse, Daten): grauer Rahmen, Schatten rechts + unten;
 *              bei Mouse-over blauer Rahmen + blauer Schatten rundum.
 *   pn-surface Fläche (umrahmt Kacheln oder Eingabefelder, z. B. Abschnitt, Formular, Spalte):
 *              grauer Rahmen, Schatten rechts + unten, kein Mouse-over (sonst leuchten zwei Rahmen).
 *   pn-none    bewusste Ausnahme (Knopf, Plakette, farbiger Hinweis-Kasten, Menü, Dialog,
 *              Fortschrittsbalken, Chat-Nachricht, Platzhalter …).
 * Die Optik steht EINMAL je App in src/app/globals.css (Klassen .pn-*, Tokens --pn-*).
 *
 * Diese Prüfung meldet jeden umrandeten Kasten ohne Zuordnung und jedes Eingabefeld mit Schatten.
 * Aufruf:  node scripts/rahmen-regel.mjs            (Fehlercode 1 bei Verstößen)
 *          node scripts/rahmen-regel.mjs --json     (Maschinen-Ausgabe)
 *          node scripts/rahmen-regel.mjs --bericht  (Zählung je Art)
 * Läuft automatisch vor jedem Bau (package.json "prebuild").
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const require = createRequire(path.join(ROOT, "package.json"));
const ts = require("typescript");

// ── Je App anpassbar ─────────────────────────────────────────────────────────
// Pfade (relativ zum Repo, mit "/"), die NICHT zur App-Oberfläche gehören.
const AUSGENOMMEN = [
  "src/components/ui/", // Grundbausteine: von Hand nach der Regel gebaut (Input/Textarea/Select = pn-field, Card = Fläche)
  /*__AUSNAHMEN__*/
];
// ─────────────────────────────────────────────────────────────────────────────

const ARTEN = ["pn-field", "pn-tile", "pn-surface", "pn-none"];
const BEHAELTER = new Set([
  "div", "section", "article", "aside", "li", "ul", "ol", "a", "label", "form", "fieldset",
  "details", "summary", "header", "footer", "nav", "main", "figure", "dl", "table",
  "Link", "NextLink", "Card",
  // Knöpfe mit Rahmen: normaler Knopf = pn-none, Auswahl-/Szenario-Karte = pn-tile, feldartiger Auslöser = pn-field
  "button", "motion.button",
  "motion.div", "motion.section", "motion.li", "motion.a", "motion.article", "motion.aside",
]);
const FELD_ROH = new Set(["input", "textarea", "select"]);
const FELD_BAUSTEIN = new Set(["Input", "Textarea", "SelectTrigger", "CommandInput"]);
const KEIN_TEXTFELD = new Set(["checkbox", "radio", "range", "hidden", "file", "color", "submit", "button", "reset", "image"]);

const ohneVariante = (t) => t.split(":").pop().replace(/^!/, "");
const istVollrand = (t) => {
  const s = ohneVariante(t);
  return /^border(-[1-9][0-9]*|-\[[^\]]+\])?$/.test(s);
};
const istSchatten = (t) => {
  const s = ohneVariante(t);
  return /^shadow(-|$)/.test(s) && s !== "shadow-none";
};

function stringsIn(node, out = []) {
  if (!node) return out;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
  else if (ts.isTemplateExpression(node)) {
    out.push(node.head.text);
    for (const sp of node.templateSpans) {
      stringsIn(sp.expression, out);
      out.push(sp.literal.text);
    }
    return out;
  } else if (ts.isPropertyAssignment(node) && (ts.isStringLiteral(node.name) || ts.isNoSubstitutionTemplateLiteral(node.name))) {
    out.push(node.name.text);
  }
  // forEachChild bricht ab, sobald der Rückruf etwas Wahres liefert – darum ohne Rückgabewert
  ts.forEachChild(node, (c) => {
    stringsIn(c, out);
  });
  return out;
}
const tokensAus = (strings) => strings.join(" ").split(/\s+/).filter(Boolean);

function attr(el, name) {
  for (const p of el.attributes.properties) {
    if (ts.isJsxAttribute(p) && p.name.getText() === name) return p;
  }
  return null;
}

function walkFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      walkFiles(p, out);
    } else if (/\.(tsx|jsx)$/.test(e.name) && !/\.(test|spec)\.(tsx|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

export function pruefe(root = ROOT) {
  const src = path.join(root, "src");
  const files = walkFiles(src);
  const verstoesse = [];
  const zaehlung = Object.fromEntries(ARTEN.map((a) => [a, 0]));
  const infos = [];
  let geprueft = 0;
  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (AUSGENOMMEN.some((a) => rel.startsWith(a) || rel === a)) continue;
    geprueft++;
    const text = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const imClassName = new Set();
    const zeile = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    const markiere = (n) => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) imClassName.add(n.pos);
      ts.forEachChild(n, markiere);
    };
    const besuche = (node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(sf);
        const cls = attr(node, "className") || attr(node, "class");
        if (cls && cls.initializer) markiere(cls.initializer);
        const tokens = cls && cls.initializer ? tokensAus(stringsIn(cls.initializer)) : [];
        const art = ARTEN.find((a) => tokens.includes(a));
        if (art) zaehlung[art]++;
        const vollrand = tokens.some(istVollrand);
        const glas = tokens.includes("glass-panel");
        const klassen = tokens.join(" ").slice(0, 160);
        if (FELD_ROH.has(tag)) {
          const typ = attr(node, "type");
          const typText = typ && typ.initializer && ts.isStringLiteral(typ.initializer) ? typ.initializer.text : "";
          if (tag !== "input" || !KEIN_TEXTFELD.has(typText)) {
            if (vollrand && !tokens.includes("pn-field")) {
              verstoesse.push({ datei: rel, zeile: zeile(node), tag, art: "Eingabefeld ohne pn-field", klassen });
            }
            if (tokens.some(istSchatten)) {
              verstoesse.push({ datei: rel, zeile: zeile(node), tag, art: "Eingabefeld mit Schatten (Regel 1: kein Schatten)", klassen });
            }
          }
        } else if (FELD_BAUSTEIN.has(tag)) {
          if (tokens.some(istSchatten)) {
            verstoesse.push({ datei: rel, zeile: zeile(node), tag, art: "Eingabefeld mit Schatten (Regel 1: kein Schatten)", klassen });
          }
        } else if (BEHAELTER.has(tag) && (vollrand || glas || tag === "Card") && !art) {
          verstoesse.push({ datei: rel, zeile: zeile(node), tag, art: "umrandeter Kasten ohne Zuordnung (pn-tile, pn-surface, pn-field oder pn-none)", klassen });
        }
        const stil = attr(node, "style");
        if (stil && stil.initializer && /\bborder(Width|Style)?\s*:/.test(stil.initializer.getText(sf)) && !art) {
          infos.push({ datei: rel, zeile: zeile(node), tag, hinweis: "Rahmen per style={{…}} — von Hand prüfen" });
        }
      }
      ts.forEachChild(node, besuche);
    };
    besuche(sf);
    // Klassen-Konstanten außerhalb von className (z. B. const kachel = "rounded-xl border …")
    const lose = (node) => {
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !imClassName.has(node.pos)) {
        const toks = tokensAus([node.text]);
        const sieht_nach_klassen_aus = toks.length >= 3 && toks.some((t) => /^(rounded|bg-|p-|px-|py-|flex|grid)/.test(ohneVariante(t)));
        if (sieht_nach_klassen_aus && toks.some(istVollrand) && !ARTEN.some((a) => toks.includes(a))) {
          verstoesse.push({ datei: rel, zeile: zeile(node), tag: "(Klassen-Text)", art: "Klassen-Text mit Rahmen ohne Zuordnung", klassen: toks.join(" ").slice(0, 160) });
        }
      }
      ts.forEachChild(node, lose);
    };
    lose(sf);
  }
  return { geprueft, verstoesse, zaehlung, infos };
}

const istHaupt = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (istHaupt) {
  const r = pruefe(ROOT);
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify(r, null, 2));
  } else {
    console.log(`Rahmen-Regel: ${r.geprueft} Dateien geprüft · Kacheln ${r.zaehlung["pn-tile"]} · Flächen ${r.zaehlung["pn-surface"]} · Eingabefelder ${r.zaehlung["pn-field"]} · Ausnahmen ${r.zaehlung["pn-none"]}`);
    if (process.argv.includes("--bericht")) for (const i of r.infos) console.log(`  Hinweis ${i.datei}:${i.zeile} <${i.tag}> ${i.hinweis}`);
    if (r.verstoesse.length) {
      console.error(`\n✗ ${r.verstoesse.length} Stelle(n) verletzen die Rahmen-Regel (SHELL-STANDARD Teil 2.7):`);
      for (const v of r.verstoesse) console.error(`  ${v.datei}:${v.zeile} <${v.tag}> ${v.art}\n      ${v.klassen}`);
      console.error(`\nSo behebst Du es: dem Kasten genau eine Klasse geben — pn-field (Eingabe), pn-tile (Kachel mit Mouse-over),\npn-surface (Fläche mit Kacheln/Feldern darin) oder pn-none (Knopf, Plakette, Hinweis, Menü, Dialog …).`);
      process.exit(1);
    }
    console.log("✓ Rahmen-Regel eingehalten.");
  }
}
