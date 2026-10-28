/**
 * Spielbücher der Standard-Szenarien erzeugen (Opus @eu) und ins Repo schreiben.
 *
 *   node --conditions=react-server --import tsx scripts/spielbuch-erzeugen.mts [szenario-id …] [--force]
 *
 * Env: VERTEX_PROJECT, GOOGLE_SA_KEY_JSON (oder GOOGLE_SA_KEY_JSON_FILE), optional COACH_SPIELBUCH_MODEL/_REGION.
 * Schreibt `src/lib/simulation/spielbuecher/<id>.json` und baut `index.ts` neu. Ohne --force werden Einträge
 * mit passendem Hash übersprungen. Druckt nie Schlüssel.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

// Die Datei gewinnt immer (Env-Dateien tragen den Schlüssel oft gekürzt, Lehre vom Relais-Test 28.10.).
if (process.env.GOOGLE_SA_KEY_JSON_FILE) {
  process.env.GOOGLE_SA_KEY_JSON = readFileSync(process.env.GOOGLE_SA_KEY_JSON_FILE, "utf8");
}

const { SIMULATION_SCENARIOS } = await import("../src/lib/simulation/scenarios");
const { generateSpielbuch, spielbuchHash } = await import("../src/lib/server/spielbuch/store");

const args = process.argv.slice(2);
const force = args.includes("--force");
const ids = args.filter((a) => !a.startsWith("--"));
const dir = path.resolve("src/lib/simulation/spielbuecher");

const auswahl = SIMULATION_SCENARIOS.filter((s) => !ids.length || ids.includes(s.id));
let kosten = { prompt: 0, output: 0 };
for (const s of auswahl) {
  const hash = spielbuchHash(s);
  const datei = path.join(dir, `${s.id}.json`);
  if (!force && existsSync(datei)) {
    const alt = JSON.parse(readFileSync(datei, "utf8")) as { hash?: string };
    if (alt.hash === hash) {
      console.log(`${s.id}: unverändert (${hash}), übersprungen`);
      continue;
    }
  }
  process.stdout.write(`${s.id}: erzeuge … `);
  const r = await generateSpielbuch(s);
  kosten = { prompt: kosten.prompt + (r.tokens.prompt ?? 0), output: kosten.output + (r.tokens.output ?? 0) };
  const eintrag = { scenarioId: s.id, hash, model: r.model, createdAt: new Date().toISOString(), text: r.text };
  writeFileSync(datei, JSON.stringify(eintrag, null, 1) + "\n", "utf8");
  console.log(`${(r.ms / 1000).toFixed(1)} s, ${r.text.length} Zeichen, ${r.text.split(/\s+/).length} Wörter → ${path.basename(datei)}`);
}

// index.ts neu bauen
const dateien = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const imports = dateien.map((f, i) => `import s${i} from "./${f}";`).join("\n");
const eintraege = dateien.map((f, i) => `  [s${i}.scenarioId]: s${i},`).join("\n");
const index = `/**
 * Spielbücher der Standard-Szenarien (erzeugt mit \`scripts/spielbuch-erzeugen.mts\`, Opus @eu).
 * Liegen als Inhalt im Repo, damit sie versioniert und lesbar sind; \`hash\` bindet sie an den Stand
 * der Rollen-DNA — ändert sich die DNA, greift der Zwischenspeicher nicht mehr und der Server
 * erzeugt im Hintergrund ein neues (oder das Skript wird erneut ausgeführt).
 * DIESE DATEI WIRD VOM SKRIPT GESCHRIEBEN.
 */
${imports}

export interface SpielbuchEintrag {
  scenarioId: string;
  hash: string;
  model: string;
  createdAt: string;
  text: string;
}

export const SPIELBUECHER_BUILTIN: Readonly<Record<string, SpielbuchEintrag>> = {
${eintraege}
};
`;
writeFileSync(path.join(dir, "index.ts"), index, "utf8");
console.log(`index.ts: ${dateien.length} Spielbücher. Tokens gesamt: ${kosten.prompt} rein / ${kosten.output} raus.`);
