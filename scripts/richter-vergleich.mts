/**
 * Richter-Vergleich (Welle 1, Owner-GO 30.10.2026): dieselben Gespräche aus dem Rollenspiel-Prüfset,
 * einmal mit Gemini (heutiger Richter), einmal mit Claude Opus @eu beurteilt. Schreibt eine Leseausgabe
 * für den Owner (beide Auswertungen nebeneinander) und eine Kennzahlen-Tabelle: unbelegte Zitate
 * (deterministische Zitatprüfung), nicht bewertbare Anker, Wortzahlen, Laufzeit.
 *
 *   node --conditions=react-server --import tsx scripts/richter-vergleich.mts [--only=<id>] [--out=<pfad.md>]
 *
 * Env: GEMINI_API_KEY (oder Vertex-Variablen), VERTEX_PROJECT + GOOGLE_SA_KEY_JSON_FILE (Opus), COSMOS_* (Karten).
 * Kein Credit, kein Radar-Punkt, keine Kundendaten (Prüfset = NorthBay-Welt).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: join(here, "..", ".env.local") });
if (process.env.GOOGLE_SA_KEY_JSON_FILE) {
  process.env.GOOGLE_SA_KEY_JSON = readFileSync(process.env.GOOGLE_SA_KEY_JSON_FILE, "utf8");
}

const { getScenario } = await import("../src/lib/simulation/scenarios");
const { generateSimulationFeedback } = await import("../src/ai/flows/simulation-feedback");
const { collectQualityNotes } = await import("../src/lib/quality-core");
const { computeDebrief } = await import("../src/lib/simulation/debrief");
const { GENKIT_MODEL_ID } = await import("../src/ai/genkit");
const { claudeModel } = await import("../src/lib/server/claude-vertex");

type Case = { id: string; scenarioId: string; convoLocale: "de" | "en"; turns: Array<{ role: "user" | "persona"; text: string }> };
const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.split("=")[1];
const outPath = args.find((a) => a.startsWith("--out="))?.split("=")[1];
const cases: Case[] = JSON.parse(readFileSync(join(here, "quality", "sim-golden-set.json"), "utf8")).filter((c: Case) => !only || c.id === only);

const words = (s: string) => String(s ?? "").trim().split(/\s+/).filter(Boolean).length;

async function richten(c: Case, richter: "gemini" | "opus") {
  const scenario = getScenario(c.scenarioId)!;
  const turns = c.turns.map((t, i) => ({ ...t, ts: new Date(Date.UTC(2026, 9, 30, 9, 0, i)).toISOString() }));
  const t0 = Date.now();
  const fb = await generateSimulationFeedback({ scenario, turns, convoLocale: c.convoLocale, richter });
  const ms = Date.now() - t0;
  const notes = collectQualityNotes(
    { summary: fb.summary, competency_ratings: fb.rubric.map((r) => ({ id: r.key, score: r.score, evidence: r.evidence ?? [] })) },
    turns.map((t) => t.text).join("\n")
  );
  const ungrounded = notes.filter((n) => /UNGROUNDED/.test(String(n.code))).length;
  const debrief = computeDebrief({
    rubric: fb.rubric.map((r) => ({ key: r.key, label: r.label, score: r.score, weight: scenario.assessment.competencies.find((x) => x.key === r.key)?.weight })),
    checkpoints: fb.checkpoints.map((x) => ({ id: x.id, hit: x.hit })),
    passThreshold: scenario.assessment.passThreshold,
  });
  return { fb, ms, ungrounded, notes: notes.length, nulls: fb.rubric.filter((r) => r.score == null).length, overall: debrief.overall, verdict: debrief.verdict, wordsNext: words(fb.nextStep), wordsWhy: fb.rubric.reduce((a, r) => a + words(r.why), 0), judge: fb.judge };
}

const rows: string[] = [];
const lese: string[] = [];
lese.push(`# Richter-Vergleich Gemini vs. Opus — ${new Date().toISOString().slice(0, 10)}`, "", `Gemini: \`${GENKIT_MODEL_ID}\` · Opus: \`${claudeModel()}\` @eu · Prüfset \`scripts/quality/sim-golden-set.json\` (${cases.length} Fälle)`, "");
for (const c of cases) {
  console.log(`── ${c.id}`);
  const g = await richten(c, "gemini");
  const o = await richten(c, "opus");
  rows.push(`| ${c.id} | ${g.overall ?? "–"} / ${g.verdict} | ${o.overall ?? "–"} / ${o.verdict} | ${g.ungrounded} | ${o.ungrounded} | ${g.nulls} | ${o.nulls} | ${g.wordsNext} | ${o.wordsNext} | ${Math.round(g.ms / 1000)} s | ${Math.round(o.ms / 1000)} s | ${o.judge} |`);
  lese.push(`## ${c.id} (${c.scenarioId}, ${c.convoLocale})`, "");
  for (const [name, r] of [["Gemini", g], ["Opus", o]] as const) {
    lese.push(`### ${name} — Gesamt ${r.overall ?? "–"} (${r.verdict}), unbelegte Zitate ${r.ungrounded}, nicht bewertbar ${r.nulls}, ${Math.round(r.ms / 1000)} s`, "", `**Gesamtbild:** ${r.fb.summary}`, "");
    for (const a of r.fb.rubric) {
      lese.push(`**${a.label}** — Stufe ${a.score ?? "–"}`);
      for (const e of a.evidence) lese.push(`> ${e}`);
      lese.push(`- Begründung: ${a.why}`);
      for (const w of a.wentWell ?? []) lese.push(`- Gelang: ${w}`);
      for (const t of a.tryNext ?? []) lese.push(`- Nächstes Mal: ${t}`);
      lese.push("");
    }
    lese.push(`**Größter Hebel (${r.fb.nextStepKey || "–"}):** ${r.fb.nextStep}`, "", `**Micro-Transfer:** ${r.fb.microTransfer.step} (${r.fb.microTransfer.when})`, "");
  }
}
const tabelle = [
  "## Kennzahlen",
  "",
  "| Fall | Gemini Gesamt | Opus Gesamt | unbelegt G | unbelegt O | nicht bewertbar G | nicht bewertbar O | Hebel-Wörter G | O | Zeit G | Zeit O | Richter O |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...rows,
  "",
  "unbelegt = Zitate, die die deterministische Zitatprüfung nicht im Gespräch findet (weniger ist besser). nicht bewertbar = Anker ohne Beleg (ehrlich, aber bei gleichem Gespräch sollte der bessere Richter mehr belegen können). Richter O = „opus“, oder „gemini“, wenn Opus ausgefallen ist (Rückfall).",
  "",
];
const md = [...lese.slice(0, 3), ...tabelle, ...lese.slice(3)].join("\n");
const out = outPath ?? join(process.env.USERPROFILE ?? here, "OneDrive", "Cowork", `Richter-Vergleich-${new Date().toISOString().slice(0, 10)}.md`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, md, "utf8");
console.log(`\n${tabelle.join("\n")}\n\nLeseausgabe: ${out}`);
