/**
 * Abgleich offener Credit-Buchungen der Auswertung (Paket 2, C8, 12.11.2026). NUR LESEN.
 *
 *   node --conditions=react-server --import tsx scripts/credits-abgleich.mts [--min=15] [--alle] [--json=pfad.json]
 *
 * Anlass: Die Auswertung eines Rollenspiels bucht 1 Credit, BEVOR sie rechnet. Vorher vermerkt sie am Lauf eine
 * „offene Buchung“ (`openCharge`: Kennung, Zeitpunkt, nach der Antwort des Credit-Dienstes Buchungsnummer und
 * Arbeitsbereich) und trägt sie mit dem Speichern der Auswertung oder nach gelungener Rückbuchung wieder aus.
 * Bleibt der Vermerk stehen, fehlt der Person womöglich ein Credit ohne Auswertung:
 *   - der Prozess endete zwischen Buchung und Speichern (Deploy, Absturz),
 *   - der Credit-Dienst antwortete auf die Buchung nicht klar (Frist, Netz, 5xx),
 *   - die Rückbuchung nach einem Fehler scheiterte.
 * Dieses Skript listet solche Läufe über alle Personen und sagt je Lauf, was der Vermerk bedeutet.
 *
 * Es ändert NICHTS — weder am Lauf noch am Guthaben (bewusst kein --fix). Zurückgegeben wird von Hand im
 * Credit-Dienst, mit der Buchungsnummer (`txId`) und dem Arbeitsbereich aus der Liste.
 *
 *   --min=15   Vermerke an aktiven Läufen, die jünger sind (Minuten), gelten als „rechnet noch“ und werden ausgelassen.
 *   --alle     auch diese jungen Vermerke und gedeckte Vermerke zeigen.
 *   --json=…   die Liste zusätzlich als JSON schreiben.
 *
 * Env (aus .env.local): COSMOS_ENDPOINT, COSMOS_KEY, COSMOS_DATABASE. Gibt keine Schlüssel und keine Gesprächsinhalte aus.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: join(here, "..", ".env.local") });

const { runsContainer } = await import("../src/lib/cosmos");
const { OPEN_CHARGE_HINWEIS, OPEN_CHARGE_MIN_MINUTES, openChargeLage } = await import("../src/lib/server/simulation-finish-abgleich");
type OpenChargeRow = import("../src/lib/server/simulation-finish-abgleich").OpenChargeRow;

const args = process.argv.slice(2);
const minArg = Number(args.find((a) => a.startsWith("--min="))?.split("=")[1]);
const minMinutes = Number.isFinite(minArg) && minArg >= 0 ? minArg : OPEN_CHARGE_MIN_MINUTES;
const alle = args.includes("--alle");
const jsonOut = args.find((a) => a.startsWith("--json="))?.split("=")[1];

type Row = OpenChargeRow & { uid: string; scenarioId: string; createdAt: string; updatedAt: string; chargeRefunds?: number; workspaceId?: string };

// Über alle Personen (Cross-Partition), nur die Felder des Geldwegs — keine Gesprächsinhalte.
const { resources } = await runsContainer()
  .items.query<Row>({
    query:
      "SELECT c.id, c.uid, c.status, c.scenarioId, c.createdAt, c.updatedAt, c.openCharge, c.chargeRefunds, c.centralSpendTxId, c.workspaceId " +
      "FROM c WHERE c.docType = 'simulation' AND IS_DEFINED(c.openCharge) AND NOT IS_NULL(c.openCharge)",
  })
  .fetchAll();

const now = new Date();
const liste = resources
  .filter((r) => r.openCharge && typeof r.openCharge.key === "string")
  .map((r) => ({ ...r, lage: openChargeLage(r, now, minMinutes) }))
  .filter((r) => alle || (r.lage !== "laeuft" && r.lage !== "gedeckt"))
  .sort((a, b) => a.openCharge.at.localeCompare(b.openCharge.at));

console.log(`── Offene Buchungen der Auswertung (Stand ${now.toISOString()}, Vermerke gesamt: ${resources.length}, gezeigt: ${liste.length}) ──`);
if (!liste.length) console.log("Keine stehengebliebenen Vermerke.");
const zaehler: Record<string, number> = {};
for (const r of liste) {
  zaehler[r.lage] = (zaehler[r.lage] ?? 0) + 1;
  const m = r.openCharge;
  const alterMin = Math.round((now.getTime() - new Date(m.at).getTime()) / 60_000);
  console.log(
    `\n${r.lage.toUpperCase()}  Lauf ${r.id} (${r.status}, Szenario ${r.scenarioId})\n` +
      `  Person: ${r.uid} · Arbeitsbereich: ${m.workspaceId ?? r.workspaceId ?? "unbekannt"}\n` +
      `  Kennung: ${m.key} · Buchungsnummer: ${m.txId ?? "keine (Buchung unbestätigt)"} · Rückbuchungen bisher: ${r.chargeRefunds ?? 0}\n` +
      `  vermerkt: ${m.at} (vor ${alterMin} min)${m.refundFailedAt ? ` · Rückbuchung gescheitert: ${m.refundFailedAt}` : ""}\n` +
      `  → ${OPEN_CHARGE_HINWEIS[r.lage]}`
  );
}
if (liste.length) console.log(`\nZusammenfassung: ${Object.entries(zaehler).map(([k, v]) => `${k} ${v}`).join(" · ")}`);

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ stand: now.toISOString(), minMinutes, liste }, null, 2), "utf8");
  console.log(`JSON: ${jsonOut}`);
}
