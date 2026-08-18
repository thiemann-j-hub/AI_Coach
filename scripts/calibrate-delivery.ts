// Welle A2 — Bänder-Kalibrierung des Delivery-Panels (Sparring-Beschluss
// 18.08.: Bänder aus BESTANDSTRANSKRIPTEN ableiten, nicht aus Literatur).
//
// Liest alle abgeschlossenen Simulationen (cross-partition, read-only) und
// druckt die Verteilung der vier Kennzahlen. Ergebnis dient der Justage von
// DELIVERY_BANDS in src/lib/simulation/delivery.ts — das Skript ändert nichts.
//
// Aufruf: COSMOS_ENDPOINT=… COSMOS_KEY=… [COSMOS_DATABASE=coach] \
//   npx tsx scripts/calibrate-delivery.ts
import { CosmosClient } from "@azure/cosmos";
import { computeDelivery } from "../src/lib/simulation/delivery";

async function main() {
  const endpoint = process.env.COSMOS_ENDPOINT;
  const key = process.env.COSMOS_KEY;
  if (!endpoint || !key) throw new Error("COSMOS_ENDPOINT / COSMOS_KEY fehlen");
  const db = new CosmosClient({ endpoint, key }).database(
    process.env.COSMOS_DATABASE ?? "coach"
  );
  const { resources } = await db
    .container("runs")
    .items.query<{
      id: string;
      convoLocale?: string;
      turns?: Array<{ role: string; text: string }>;
    }>(
      "SELECT c.id, c.convoLocale, c.turns FROM c WHERE c.docType = 'simulation' AND c.status = 'finished'",
      { maxItemCount: 500 }
    )
    .fetchAll();

  const rows = resources
    .map((r) => computeDelivery(r.turns ?? [], r.convoLocale ?? "de"))
    .filter((d) => d.talkRatioPct != null);

  console.log(`Auswertbare Läufe: ${rows.length} von ${resources.length}`);
  if (!rows.length) return;

  const dist = (label: string, vals: Array<number | null>) => {
    const v = vals.filter((x): x is number => x != null).sort((a, b) => a - b);
    if (!v.length) return console.log(`${label}: keine Werte`);
    const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
    console.log(
      `${label}: n=${v.length} min=${v[0]} p25=${q(0.25)} p50=${q(0.5)} p75=${q(0.75)} max=${v[v.length - 1]}`
    );
  };
  dist("Redeanteil %", rows.map((r) => r.talkRatioPct));
  dist("Satzlänge (Median Wörter)", rows.map((r) => r.medianSentenceWords));
  dist("Satzanfang-Wiederholung %", rows.map((r) => r.openerRepetitionPct));
  dist("Weichmacher je 100 Wörter", rows.map((r) => r.softenersPer100));
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
