// Liest den Credit-/Rechnungs-Stand eines Workspaces.  node scripts/provision/inspect-credits.mjs <workspaceId>
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
function loadEnv(){ try{ const t=readFileSync(new URL("../../.env.local",import.meta.url),"utf8"); for(const l of t.split(/\r?\n/)){ const m=/^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2]; } }catch{} }
loadEnv();
const ws = process.argv[2];
const c = new CosmosClient({ endpoint: process.env.COSMOS_ENDPOINT, key: process.env.COSMOS_KEY });
const db = c.database(process.env.COSMOS_DATABASE ?? "coach");
const eur = (cents)=> (cents/100).toFixed(2)+" EUR";

const { resources: wsDocs } = await db.container("workspaces").items
  .query({ query: "SELECT * FROM c WHERE c.workspaceId=@w", parameters:[{name:"@w",value:ws}] }).fetchAll();
const workspace = wsDocs.find(d=>d.type==="workspace");
const batches = wsDocs.filter(d=>d.type==="creditBatch");
const ledger = wsDocs.filter(d=>d.type==="ledger");
const events = wsDocs.filter(d=>d.type==="stripeEvent");

console.log("WORKSPACE:", workspace ? { balance: workspace.balance, members: workspace.members?.length } : "(none)");
const activeCredits = batches.filter(b=>b.amount>0 && new Date(b.expiresAt)>new Date()).reduce((s,b)=>s+b.amount,0);
console.log("AKTIVE CREDITS (Summe gueltiger Batches):", activeCredits);
console.log("BATCHES:");
batches.forEach(b=> console.log("  -", b.source, "amount", b.amount+"/"+b.originalAmount, "exp", b.expiresAt.slice(0,10)));
console.log("LEDGER (", ledger.length, "Eintraege):");
ledger.sort((a,b)=> (a.createdAt||"").localeCompare(b.createdAt||"")).forEach(l=> console.log("  -", l.reason, "delta", l.delta, "status", l.status, l.runId?("run "+l.runId.slice(0,8)):""));
console.log("STRIPE-EVENTS (Idempotenz):", events.length);

const { resources: inv } = await db.container("invoices").items
  .query({ query: "SELECT * FROM c WHERE c.workspaceId=@w AND c.type='invoice' ORDER BY c.seq ASC", parameters:[{name:"@w",value:ws}] }).fetchAll();
console.log("\nRECHNUNGEN (", inv.length, "):");
inv.forEach(i=> console.log("  -", i.invoiceNumber, "|", i.taxTreatment, "| netto", eur(i.netCents), "USt", eur(i.taxCents), "("+(Math.round(i.taxRate*100))+"%)", "brutto", eur(i.grossCents), "| Land", i.billing?.country, "| PDF:", i.pdfBlobPath||"(pending)"));
