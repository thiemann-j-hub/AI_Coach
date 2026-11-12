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
 * Seit der Go-Live-Prüfung (S3, 12.11.2026) listet es zusätzlich die Buchungsvermerke der Wege, die an keinem Lauf
 * hängen (`src/lib/server/credits/buchungsvermerk.ts`): Transkript-Analyse, „Vorbereiten“, Builder und die Rückgabe
 * beim Löschen einer Analyse. Dieselben drei Ursachen, dieselbe Regel: nur lesen, von Hand zurückgeben.
 *
 * Es ändert NICHTS — weder am Lauf noch am Guthaben (bewusst kein --fix). Zurückgegeben wird von Hand im
 * Credit-Dienst, mit der Buchungsnummer (`txId`) und dem Arbeitsbereich aus der Liste.
 *
 *   --min=15   Vermerke an aktiven Läufen und Buchungsvermerke, die jünger sind (Minuten), gelten als „rechnet noch“
 *              und werden ausgelassen.
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
const { creditSchluessel, vermerkHinweis, vermerkLage } = await import("../src/lib/server/credits/buchungsvermerk");
type Buchungsvermerk = import("../src/lib/server/credits/buchungsvermerk").Buchungsvermerk;

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

// ── Buchungsvermerke ohne Lauf (S3): Analyse, „Vorbereiten“, Builder, Rückgabe beim Löschen ──
// Nur die Felder des Vermerks; er trägt keine Inhalte.
const { resources: vermerkDocs } = await runsContainer()
  .items.query<Buchungsvermerk>({
    query:
      "SELECT c.id, c.uid, c.art, c.kennung, c.at, c.txId, c.workspaceId, c.refundFailedAt " +
      "FROM c WHERE c.docType = 'buchungsvermerk'",
  })
  .fetchAll();

const vermerke = vermerkDocs
  .filter((v) => typeof v.kennung === "string" && typeof v.at === "string")
  .map((v) => ({ ...v, lage: vermerkLage(v, now, minMinutes) }))
  .filter((v) => alle || v.lage !== "laeuft")
  .sort((a, b) => a.at.localeCompare(b.at));

console.log(`\n── Buchungsvermerke ohne Lauf (Vermerke gesamt: ${vermerkDocs.length}, gezeigt: ${vermerke.length}) ──`);
if (!vermerke.length) console.log("Keine stehengebliebenen Vermerke.");
const zaehlerVermerke: Record<string, number> = {};
for (const v of vermerke) {
  zaehlerVermerke[v.lage] = (zaehlerVermerke[v.lage] ?? 0) + 1;
  const alterMin = Math.round((now.getTime() - new Date(v.at).getTime()) / 60_000);
  console.log(
    `\n${v.lage.toUpperCase()}  ${v.art}\n` +
      `  Person: ${v.uid} · Arbeitsbereich: ${v.workspaceId ?? "unbekannt"}\n` +
      `  Kennung: ${v.kennung} · Schlüssel im Credit-Dienst: ${creditSchluessel(v.art, v.kennung)} · Buchungsnummer: ${v.txId ?? "keine (Buchung unbestätigt)"}\n` +
      `  vermerkt: ${v.at} (vor ${alterMin} min)${v.refundFailedAt ? ` · Rückbuchung gescheitert: ${v.refundFailedAt}` : ""}\n` +
      `  → ${vermerkHinweis(v.art, v.lage)}`
  );
}
if (vermerke.length) console.log(`\nZusammenfassung: ${Object.entries(zaehlerVermerke).map(([k, v]) => `${k} ${v}`).join(" · ")}`);

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ stand: now.toISOString(), minMinutes, liste, vermerke }, null, 2), "utf8");
  console.log(`JSON: ${jsonOut}`);
}
