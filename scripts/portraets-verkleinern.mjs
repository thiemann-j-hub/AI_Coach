#!/usr/bin/env node
/**
 * Porträts der Rollen verkleinern (Paket 6, C37, 12.11.2026).
 *
 * Anlass: public/personas/*.jpg lagen mit 1024 × 1024 Pixeln und 200 bis 300 KB je Bild im Repo, gezeigt werden
 * sie mit 28 bis 64 Pixeln und in der Sprechansicht mit höchstens rund 320 Pixeln Breite. 640 Pixel reichen
 * auch für Bildschirme mit doppelter Pixeldichte.
 *
 *   node scripts/portraets-verkleinern.mjs
 *
 * Jedes Bild: höchstens 640 Pixel Kantenlänge (nie vergrößern), JPEG Qualität 80, derselbe Dateiname.
 * Geschrieben wird nur, wenn die Datei dadurch mindestens 10 % kleiner wird. So bleibt ein zweiter Lauf
 * folgenlos und kodiert schon verkleinerte Bilder nicht noch einmal (jede Neukodierung kostet etwas Schärfe).
 * Nach neuen Porträts aus generate-persona-portraits.mjs einfach noch einmal aufrufen.
 * Die Originale stehen in der Git-Geschichte.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const DIR = path.join(process.cwd(), "public", "personas");
const MAX_KANTE = 640;
const QUALITAET = 80;

if (!fs.existsSync(DIR)) {
  console.error(`portraets-verkleinern: Ordner fehlt: ${DIR} (im Repo-Stamm aufrufen)`);
  process.exit(1);
}

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
const dateien = fs.readdirSync(DIR).filter((f) => /\.jpe?g$/i.test(f)).sort();
let summeVorher = 0;
let summeNachher = 0;

for (const name of dateien) {
  const datei = path.join(DIR, name);
  // Über einen Puffer lesen: sharp darf nicht in die Datei schreiben, aus der es gerade liest.
  const vorher = fs.readFileSync(datei);
  const masse = await sharp(vorher).metadata();
  const neu = await sharp(vorher)
    .rotate() // Drehung aus den Bilddaten anwenden, bevor sie beim Kodieren wegfallen
    .resize({ width: MAX_KANTE, height: MAX_KANTE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: QUALITAET, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  summeVorher += vorher.length;
  if (neu.data.length > vorher.length * 0.9) {
    summeNachher += vorher.length;
    console.log(`${name}: bleibt (${masse.width} × ${masse.height}, ${kb(vorher.length)})`);
    continue;
  }
  fs.writeFileSync(datei, neu.data);
  summeNachher += neu.data.length;
  console.log(
    `${name}: ${masse.width} × ${masse.height}, ${kb(vorher.length)} → ${neu.info.width} × ${neu.info.height}, ${kb(neu.data.length)}`,
  );
}

console.log(`portraets-verkleinern: ${dateien.length} Bilder, ${kb(summeVorher)} → ${kb(summeNachher)}`);
