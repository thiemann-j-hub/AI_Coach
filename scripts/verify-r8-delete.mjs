/**
 * R8-Sicherheits-Verifikation: testet die Kaskaden-Query+Delete-Logik gegen den
 * ECHTEN runs-Container, aber ausschließlich mit einem synthetischen Wegwerf-uid
 * (__r8_verify__) — NULL Risiko für echte Nutzerdaten.
 *
 * Ablauf: (1) 2 Fake-Run-Docs unter dem Test-uid anlegen, (2) prüfen dass sie da
 * sind, (3) exakt die Kaskaden-Query (WHERE c.uid=@uid) + Delete (id,sessionId)
 * ausführen, (4) prüfen dass 0 übrig. Und Gegenprobe: ein Fremd-uid-Doc bleibt.
 *
 * Lauf: COSMOS_ENDPOINT=… COSMOS_KEY=… node scripts/verify-r8-delete.mjs
 */
import { CosmosClient } from "@azure/cosmos";

const TEST_UID = "__r8_verify__";
const OTHER_UID = "__r8_other__";

const c = new CosmosClient({
  endpoint: process.env.COSMOS_ENDPOINT,
  key: process.env.COSMOS_KEY,
  connectionPolicy: { retryOptions: { maxRetryAttemptCount: 9, maxWaitTimeInSeconds: 60 } },
})
  .database(process.env.COSMOS_DATABASE ?? "coach")
  .container("runs");

const runDoc = (uid, runId, sessionId) => ({
  id: runId,
  sessionId,
  uid,
  workspaceId: "ws-" + uid,
  createdAt: new Date().toISOString(),
  conversationType: "r8-verify",
  __r8_test: true,
});

async function main() {
  // 1) Seed: 2 Test-Runs + 1 Fremd-Run
  await c.items.upsert(runDoc(TEST_UID, "r8-run-1", "r8-sess-1"));
  await c.items.upsert(runDoc(TEST_UID, "r8-run-2", "r8-sess-2"));
  await c.items.upsert(runDoc(OTHER_UID, "r8-other-1", "r8-sess-o"));

  const before = (
    await c.items
      .query({ query: "SELECT c.id, c.sessionId FROM c WHERE c.uid=@u", parameters: [{ name: "@u", value: TEST_UID }] })
      .fetchAll()
  ).resources;
  console.log(`  seed: ${before.length} Test-Runs angelegt (erwartet 2)`);

  // 3) Kaskade nachbilden: query by uid, delete by (id, sessionId)
  let deleted = 0;
  for (const r of before) {
    await c.item(r.id, r.sessionId).delete();
    deleted++;
  }

  // 4) Verify: 0 Test-Runs übrig, Fremd-Run bleibt
  const afterTest = (
    await c.items
      .query({ query: "SELECT VALUE COUNT(1) FROM c WHERE c.uid=@u", parameters: [{ name: "@u", value: TEST_UID }] })
      .fetchAll()
  ).resources[0];
  const afterOther = (
    await c.items
      .query({ query: "SELECT VALUE COUNT(1) FROM c WHERE c.uid=@u", parameters: [{ name: "@u", value: OTHER_UID }] })
      .fetchAll()
  ).resources[0];

  // Aufräumen: Fremd-Run wieder entfernen (Test-Hygiene)
  await c.item("r8-other-1", "r8-sess-o").delete().catch(() => {});

  const ok = deleted === 2 && afterTest === 0 && afterOther === 1;
  console.log(`  gelöscht: ${deleted} | Test-uid übrig: ${afterTest} (soll 0) | Fremd-uid übrig: ${afterOther} (soll 1)`);
  console.log(ok ? "  ✓✓ R8-Kaskade: scoped + vollständig + fremde Daten unberührt" : "  ✗ FEHLER");
  process.exit(ok ? 0 : 1);
}
main().catch((e) => {
  console.error("R8-VERIFY FAILED:", e?.message || e);
  process.exit(1);
});
