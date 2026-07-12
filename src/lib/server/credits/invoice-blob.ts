import "server-only";

import {
  BlobSASPermissions,
  BlobServiceClient,
  generateBlobSASQueryParameters,
  SASProtocol,
} from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";

/**
 * Invoice-PDF-Storage in Azure Blob (Gemini-Maszgabe: PDF NIE base64 ins Cosmos-
 * Doc). Auth durchgaengig ueber Managed Identity (DefaultAzureCredential) -> kein
 * Account-Key im ENV. Download via kurzlebiger USER-DELEGATION-SAS (mit MI
 * erzeugt, nicht Account-Key), auf die die /api/invoices/[id]-Route per 302
 * redirected, nachdem sie Auth + Workspace-Membership geprueft hat.
 */

const ACCOUNT = process.env.AZURE_STORAGE_ACCOUNT ?? "";
const CONTAINER = process.env.INVOICE_BLOB_CONTAINER ?? "invoices";

export function blobConfigured(): boolean {
  return !!ACCOUNT;
}

function accountUrl(): string {
  return `https://${ACCOUNT}.blob.core.windows.net`;
}

let service: BlobServiceClient | null = null;
function getService(): BlobServiceClient {
  if (!ACCOUNT) throw new Error("AZURE_STORAGE_ACCOUNT ist nicht gesetzt.");
  if (!service) {
    service = new BlobServiceClient(accountUrl(), new DefaultAzureCredential());
  }
  return service;
}

/** Deterministischer Blob-Pfad je Rechnung (Jahr-Praefix als Ordner). */
export function invoiceBlobPath(year: string, invoiceNumber: string): string {
  return `${year}/${invoiceNumber}.pdf`;
}

/**
 * Laedt das eager gerenderte PDF hoch. GoBD-WORM-tauglich: existiert der Blob
 * bereits, wird NICHT ueberschrieben (write-once) — das PDF entsteht ohnehin
 * deterministisch aus dem eingefrorenen Invoice-Doc, ein Re-Upload waere
 * byte-gleich. Unter einer Container-Immutability-Policy wuerde ein Overwrite
 * mit 409 abgewiesen; den Race (parallel entstandener Blob) behandeln wir
 * deshalb ebenfalls als Erfolg.
 */
export async function uploadInvoicePdf(blobPath: string, pdf: Buffer): Promise<void> {
  const container = getService().getContainerClient(CONTAINER);
  const blob = container.getBlockBlobClient(blobPath);
  if (await existingBlobMatches(blob, blobPath, pdf)) return;
  try {
    await blob.uploadData(pdf, {
      blobHTTPHeaders: {
        blobContentType: "application/pdf",
        blobContentDisposition: `inline; filename="${blobPath.split("/").pop()}"`,
      },
    });
  } catch (e: unknown) {
    // 409 = Blob existiert inzwischen (Race) oder Immutability-Policy verweigert
    // den Overwrite — wenn das vorhandene PDF passt, liegt es bereits
    // unveraenderbar vor und der Upload gilt als Erfolg.
    const code = (e as { statusCode?: number })?.statusCode;
    if (code === 409 && (await existingBlobMatches(blob, blobPath, pdf))) return;
    throw e;
  }
}

/**
 * Write-once-Pruefung: true = Blob existiert und die Groesse passt zum frisch
 * gerenderten PDF (Re-Render desselben eingefrorenen Docs ist laengengleich —
 * PDF-Timestamps sind fixe Breite). Abweichende Groesse = Tripwire fuer eine
 * Rechnungsnummern-Kollision (zwei Rechnungen -> gleicher Pfad): HART werfen,
 * damit nie das PDF einer fremden Rechnung am Doc verlinkt wird.
 */
async function existingBlobMatches(
  blob: ReturnType<ReturnType<BlobServiceClient["getContainerClient"]>["getBlockBlobClient"]>,
  blobPath: string,
  pdf: Buffer
): Promise<boolean> {
  if (!(await blob.exists())) return false;
  const props = await blob.getProperties();
  if (typeof props.contentLength === "number" && props.contentLength !== pdf.byteLength) {
    throw new Error(
      `uploadInvoicePdf: Blob ${blobPath} existiert mit abweichender Groesse ` +
        `(${props.contentLength} vs. ${pdf.byteLength} Bytes) — moegliche ` +
        `Rechnungsnummern-Kollision; write-once, NICHT ueberschrieben.`
    );
  }
  return true;
}

/**
 * Kurzlebige User-Delegation-SAS-URL (read-only). MI erzeugt den
 * User-Delegation-Key; kein Account-Key noetig. Default-TTL 2 Minuten.
 */
export async function getInvoiceSasUrl(blobPath: string, ttlMinutes = 2): Promise<string> {
  const svc = getService();
  const startsOn = new Date(Date.now() - 5 * 60 * 1000); // Clock-Skew-Puffer
  const expiresOn = new Date(Date.now() + ttlMinutes * 60 * 1000);

  const userDelegationKey = await svc.getUserDelegationKey(startsOn, expiresOn);
  const sas = generateBlobSASQueryParameters(
    {
      containerName: CONTAINER,
      blobName: blobPath,
      permissions: BlobSASPermissions.parse("r"),
      startsOn,
      expiresOn,
      protocol: SASProtocol.Https,
    },
    userDelegationKey,
    ACCOUNT
  ).toString();

  return `${accountUrl()}/${CONTAINER}/${encodeURI(blobPath)}?${sas}`;
}
