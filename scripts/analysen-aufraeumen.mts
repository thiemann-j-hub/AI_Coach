/**
 * Als gelöscht markierte Analysen wirklich löschen (Go-Live-Prüfung 12.11.2026, S1).
 *
 *   node --conditions=react-server --import tsx scripts/analysen-aufraeumen.mts                # Trockenlauf: zählt nur
 *   node --conditions=react-server --import tsx scripts/analysen-aufraeumen.mts --ausfuehren   # löscht
 *
 * Anlass: Bis 12.11.2026 hat „Analyse löschen“ das Dokument nur markiert (`deleted: true`). Zusammenfassung,
 * Belegzitate, Umformulierungen und, wenn gespeichert, das Transkript blieben in der Datenbank liegen; nichts räumte
 * sie weg. Seitdem entfernt /api/runs/delete das Dokument. Dieses Skript löscht den Altbestand.
 *
 * Offene Rückgaben: `refundPending: true` hieß, dass die Rückgabe des Credits beim Löschen gescheitert ist (nachgeholt
 * hat sie nie jemand). Für diese Läufe schreibt das Skript VOR dem Löschen einen Buchungsvermerk ohne Inhalte
 * (Art `analyse-rueckgabe`: Lauf-Kennung, Buchungsnummer, Arbeitsbereich, Person, Zeitpunkt), damit
 * `scripts/credits-abgleich.mts` sie listet. Es bucht nichts zurück. Lässt sich der Vermerk nicht schreiben, bleibt
 * das Dokument liegen.
 *
 * Der Messpunkt im Radar ist schon beim Markieren gelöscht worden; hier ist dazu nichts zu tun.
 *
 * Env (aus .env.local): COSMOS_ENDPOINT, COSMOS_KEY, COSMOS_DATABASE. Gibt keine Schlüssel und keine Inhalte aus.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: join(here, "..", ".env.local") });

const { deleteItem, runsContainer } = await import("../src/lib/cosmos");
const { vermerkAnlegen } = await import("../src/lib/server/credits/buchungsvermerk");

const ausfuehren = process.argv.slice(2).includes("--ausfuehren");

interface Row {
  id: string;
  sessionId: string;
  uid?: string;
  workspaceId?: string;
  centralSpendTxId?: string | null;
  deletedAt?: string;
  refundPending?: boolean;
  hatTranskript?: boolean;
}

// Über alle Sitzungen (Cross-Partition). Nur Analysen: Andere Dokumentarten im Container tragen `docType`.
const { resources } = await runsContainer()
  .items.query<Row>({
    query:
      "SELECT c.id, c.sessionId, c.uid, c.workspaceId, c.centralSpendTxId, c.deletedAt, c.refundPending, " +
      "(IS_STRING(c.transcriptText) AND LENGTH(c.transcriptText) > 0) AS hatTranskript " +
      "FROM c WHERE c.deleted = true AND NOT IS_DEFINED(c.docType)",
  })
  .fetchAll();

const rows = resources.filter((r) => typeof r.id === "string" && typeof r.sessionId === "string");
const offen = rows.filter((r) => r.refundPending === true && r.centralSpendTxId);

console.log(`── Als gelöscht markierte Analysen (Stand ${new Date().toISOString()}) ──`);
console.log(`Gefunden: ${rows.length} · davon mit gespeichertem Transkript: ${rows.filter((r) => r.hatTranskript === true).length} · davon mit offener Rückgabe: ${offen.length}`);
for (const r of offen) {
  console.log(
    `  offene Rückgabe: Lauf ${r.id} · Person ${r.uid ?? "unbekannt"} · Arbeitsbereich ${r.workspaceId ?? "unbekannt"} · ` +
      `Buchungsnummer ${r.centralSpendTxId} · gelöscht ${r.deletedAt ?? "unbekannt"}`
  );
}

if (!ausfuehren) {
  console.log("\nTrockenlauf: nichts gelöscht. Mit --ausfuehren werden diese Dokumente endgültig entfernt.");
} else {
  let geloescht = 0;
  let vermerkt = 0;
  let behalten = 0;
  for (const r of rows) {
    if (r.refundPending === true && r.centralSpendTxId) {
      const zeit = r.deletedAt ?? new Date().toISOString();
      const vermerk = r.uid
        ? await vermerkAnlegen({
            uid: r.uid,
            art: "analyse-rueckgabe",
            kennung: r.id,
            txId: r.centralSpendTxId,
            workspaceId: r.workspaceId ?? null,
            at: zeit,
            refundFailedAt: zeit,
          })
        : null;
      if (!vermerk) {
        behalten++;
        console.log(`  NICHT gelöscht (Vermerk der offenen Rückgabe ließ sich nicht schreiben): Lauf ${r.id}`);
        continue;
      }
      vermerkt++;
    }
    try {
      await deleteItem(runsContainer(), r.id, r.sessionId);
      geloescht++;
    } catch (e) {
      behalten++;
      console.log(`  NICHT gelöscht (Fehler): Lauf ${r.id} · ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`\nGelöscht: ${geloescht} · offene Rückgaben als Buchungsvermerk übernommen: ${vermerkt} · liegen geblieben: ${behalten}`);
  if (vermerkt) console.log("Die übernommenen Rückgaben listet scripts/credits-abgleich.mts (Art analyse-rueckgabe).");
}
