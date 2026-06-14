// Laedt ein Rechnungs-PDF aus dem Azure Blob (DefaultAzureCredential = az-Login)
// nach Downloads, zur lokalen Compliance-Pruefung.
//   node scripts/provision/download-invoice-pdf.mjs <year/RE-....pdf> [zielPfad]
import { readFileSync, writeFileSync } from "node:fs";
import { BlobServiceClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";

function loadEnv() {
  try {
    const t = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
    for (const l of t.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {}
}
loadEnv();

const blobPath = process.argv[2];
if (!blobPath) { console.error("Usage: node download-invoice-pdf.mjs <year/RE-....pdf> [dest]"); process.exit(1); }
const account = process.env.AZURE_STORAGE_ACCOUNT;
const container = process.env.INVOICE_BLOB_CONTAINER || "invoices";
const dest = process.argv[3] || ("C:\\Users\\Thiem\\Downloads\\" + blobPath.split("/").pop());

const svc = new BlobServiceClient(`https://${account}.blob.core.windows.net`, new DefaultAzureCredential());
const blob = svc.getContainerClient(container).getBlockBlobClient(blobPath);
const buf = await blob.downloadToBuffer();
writeFileSync(dest, buf);
console.log("OK", buf.length, "bytes ->", dest);
