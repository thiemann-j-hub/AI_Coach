// Einmaliges Sparring-Skript (IA-Konzept-Review) — nutzt denselben SDK-Weg
// wie der Coach selbst (@google/genai + GEMINI_API_KEY). Nach Gebrauch loeschbar.
import { GoogleGenAI } from "@google/genai";
import { readFileSync, writeFileSync } from "node:fs";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY fehlt");
  process.exit(1);
}
const model = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-pro";
const prompt = readFileSync(process.argv[2], "utf8");

const ai = new GoogleGenAI({ apiKey });
const res = await ai.models.generateContent({
  model,
  contents: prompt,
  config: { temperature: 0.4 },
});
const text = res.text;
writeFileSync(process.argv[3], text, "utf8");
console.log(`Antwort (${model}), ${text.length} Zeichen:`);
console.log(text);
