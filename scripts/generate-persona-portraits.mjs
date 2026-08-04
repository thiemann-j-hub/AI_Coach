// D4 — statische Persona-Porträts über die freigegebene fal.ai-Pipeline
// (Blueprint COACH-DEBRIEF-BLUEPRINT.md: »statische Porträts je Persona (fal,
// einmalig) statt Video«). Erzeugt je Szenario EIN fotorealistisches
// Business-Porträt einer ERFUNDENEN Person und legt es unter
// public/personas/<scenarioId>.jpg ab. Einmal-Skript; existierende Dateien
// werden übersprungen (Kosten-Schutz).
//
//   FAL_KEY="<key>" node scripts/generate-persona-portraits.mjs
//
// Modell: fal-ai/nano-banana (bewährt aus der Video-Pipeline P1/P2).

import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const KEY = process.env.FAL_KEY;
if (!KEY) { console.error("FAL_KEY fehlt"); process.exit(1); }

const OUT_DIR = join(process.cwd(), "public", "personas");
mkdirSync(OUT_DIR, { recursive: true });

const BASE_STYLE =
  "Photorealistic corporate headshot portrait, fictional person, " +
  "soft natural office lighting, shallow depth of field, neutral modern " +
  "office background softly blurred, looking at camera with subtle " +
  "professional expression, high detail, 85mm lens look. No text, no logos.";

const PERSONAS = [
  { id: "sim-coaching-morgan", prompt: "Woman in her early 30s, warm open smile, energetic, shoulder-length brown hair, smart-casual blazer over blouse." },
  { id: "sim-peer-lang", prompt: "Man in his mid 50s, reserved serious expression, short grey hair, rimless glasses, engineer vibe, plain dark polo shirt under a work jacket." },
  { id: "sim-critique-vance", prompt: "Person in their mid 40s, sharp intelligent gaze, slight ironic half-smile, dark short hair, black turtleneck, IT-leader vibe." },
  { id: "sim-azubi-roth", prompt: "Young man about 20, confident charming grin, modern short haircut, casual hoodie over t-shirt, apprentice vibe." },
  { id: "sim-performance-reed", prompt: "Man in his early 40s, calm precise expression, neatly combed hair, light-blue shirt, analytical office-professional vibe." },
  { id: "sim-merge-brandt", prompt: "Man around 45, composed friendly-but-firm expression, short dark hair with first grey, navy sweater over collared shirt, seasoned project-manager vibe." },
  { id: "sim-peer-falk", prompt: "Man of 52, polished confident presence, well-groomed silver-streaked hair, tailored suit jacket without tie, slight knowing smile, senior sales-executive vibe." },
  { id: "sim-appraisal-stone", prompt: "Man of 37, athletic, direct confident look, short styled hair, fitted business shirt with rolled-up sleeves, top-performer sales-manager vibe." },
];

async function generate(p) {
  const file = join(OUT_DIR, `${p.id}.jpg`);
  if (existsSync(file)) { console.log(`übersprungen (existiert): ${p.id}`); return; }

  const res = await fetch("https://fal.run/fal-ai/nano-banana", {
    method: "POST",
    headers: { Authorization: `Key ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: `${p.prompt} ${BASE_STYLE}`,
      num_images: 1,
      output_format: "jpeg",
      aspect_ratio: "1:1",
    }),
  });
  if (!res.ok) throw new Error(`${p.id}: fal HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const url = data?.images?.[0]?.url;
  if (!url) throw new Error(`${p.id}: keine Bild-URL in der Antwort`);
  const img = await fetch(url);
  writeFileSync(file, Buffer.from(await img.arrayBuffer()));
  console.log(`erzeugt: ${p.id}.jpg (${Math.round((await import("node:fs")).statSync(file).size / 1024)} kB)`);
}

for (const p of PERSONAS) {
  await generate(p);
}
console.log("fertig.");
