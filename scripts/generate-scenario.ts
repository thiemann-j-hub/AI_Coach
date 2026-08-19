// B3b — Concierge-Generator (CLI): Brief + optionales Kunden-Material →
// validierter Szenario-ENTWURF als JSON-Datei. Bewusst ZWEISTUFIG:
// dieses Skript schreibt NIE in die Datenbank — der Betreiber reviewt den
// Entwurf und schaltet ihn danach mit scripts/upsert-scenario.ts frei.
//
// Aufruf (--conditions react-server entschärft den server-only-Wächter der
// importierten App-Module — der Flow läuft hier bewusst als Betreiber-CLI):
//   GEMINI_API_KEY=… npx tsx --conditions react-server scripts/generate-scenario.ts \
//     --id ws-mein-szenario \
//     --brief "Situation, Zielgruppe, Lernziel …"   (oder --brief-file pfad.txt)
//     [--doc kundenmaterial.txt|.md]                 (Fakten-Quelle)
//     [--category vertrieb] [--difficulty 2] [--locale de]
//     [--out pfad/entwurf.json]                      (Default: scenario-drafts/<id>.json)
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { generateScenarioDraft } from "../src/ai/flows/scenario-generator";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const id = arg("id");
  if (!id?.startsWith("ws-")) throw new Error("--id ws-… fehlt");
  const brief = arg("brief") ?? (arg("brief-file") ? readFileSync(arg("brief-file")!, "utf-8") : "");
  if (!brief.trim()) throw new Error("--brief oder --brief-file fehlt");
  const docPath = arg("doc");
  const sourceDocument = docPath ? readFileSync(docPath, "utf-8") : undefined;

  const category = arg("category") as
    | "mitarbeiterfuehrung" | "zusammenarbeit" | "vertrieb" | "stakeholder" | undefined;
  const difficulty = arg("difficulty") ? (Number(arg("difficulty")) as 1 | 2 | 3) : undefined;
  const locale = arg("locale") as "de" | "en" | undefined;

  console.log(`Generiere Entwurf ${id} …`);
  const scenario = await generateScenarioDraft({
    brief, id, sourceDocument, category, difficulty, locale,
  });

  const out = arg("out") ?? join("scenario-drafts", `${id}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(scenario, null, 2) + "\n", "utf-8");

  console.log(`Schema OK — Entwurf geschrieben: ${out}`);
  console.log(`Titel:    ${scenario.title}`);
  console.log(`Persona:  ${scenario.persona.name} (${scenario.persona.role})`);
  console.log(`Anker:    ${scenario.assessment.competencies.map((c) => `${c.key}(${c.weight ?? 1})`).join(" ")}`);
  console.log(`Momente:  ${scenario.assessment.checkpoints.length} · Einwände: ${scenario.personaDna.objectionPlaybook.length}`);
  console.log(`\nNächster Schritt (nach Review): WORKSPACE_ID=<ws> npx tsx scripts/upsert-scenario.ts ${out}`);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
