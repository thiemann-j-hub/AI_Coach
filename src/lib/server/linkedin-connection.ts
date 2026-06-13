import "server-only";

import crypto from "crypto";
import { readItem, upsertItem, usersContainer } from "@/lib/cosmos";

/**
 * Persistenz der LinkedIn-Verbindung pro User (LI-E3).
 *
 * Das Access-Token liegt AES-256-GCM-verschluesselt als Feld `linkedin` im
 * users-Dokument (Cosmos) — der Container ist ausschliesslich serverseitig
 * erreichbar (Key aus Key Vault), /api/users/profile gibt das Feld nie zurueck.
 *
 * Der OAuth-state ist HMAC-signiert und traegt die uid, damit der Callback
 * (ein Browser-Redirect ohne eigene Session-Pruefung) das Token dem
 * richtigen User zuordnen kann.
 */

const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Schluesselmaterial: LINKEDIN_TOKEN_KEY (dediziert, empfohlen) oder
 * abgeleitet aus LINKEDIN_CLIENT_SECRET. Rotiert der Schluessel, werden
 * gespeicherte Tokens unlesbar — User muessen sich neu verbinden (kein
 * Datenverlust, nur Reconnect).
 */
function keyMaterial(label: string): Buffer {
  const base =
    process.env.LINKEDIN_TOKEN_KEY?.trim() ||
    process.env.LINKEDIN_CLIENT_SECRET?.trim();
  if (!base) {
    throw new Error(
      "LINKEDIN_TOKEN_KEY oder LINKEDIN_CLIENT_SECRET muss gesetzt sein (Token-Verschluesselung)."
    );
  }
  return crypto.createHash("sha256").update(`${label}:${base}`).digest();
}

export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    keyMaterial("linkedin-token-encryption"),
    iv
  );
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptToken(stored: string): string | null {
  try {
    const [version, ivB64, tagB64, ctB64] = stored.split(".");
    if (version !== "v1" || !ivB64 || !tagB64 || !ctB64) return null;
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      keyMaterial("linkedin-token-encryption"),
      Buffer.from(ivB64, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Schluessel rotiert oder Daten korrupt -> als "nicht verbunden" behandeln
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  OAuth-State (CSRF + uid-Bindung)                                   */
/* ------------------------------------------------------------------ */

export function createSignedState(uid: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      uid,
      nonce: crypto.randomBytes(8).toString("hex"),
      exp: Date.now() + STATE_TTL_MS,
    })
  ).toString("base64url");
  const sig = crypto
    .createHmac("sha256", keyMaterial("linkedin-state-hmac"))
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySignedState(state: string): { uid: string } | null {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;

  const expected = crypto
    .createHmac("sha256", keyMaterial("linkedin-state-hmac"))
    .update(payload)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof data?.uid !== "string" || typeof data?.exp !== "number") return null;
    if (Date.now() > data.exp) return null;
    return { uid: data.uid };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Cosmos-Persistenz (Feld `linkedin` im users-Dokument)              */
/* ------------------------------------------------------------------ */

export interface LinkedInConnection {
  accessToken: string;
  personUrn: string;
  name: string;
  /** Epoch-Millisekunden */
  expiresAt: number;
}

type StoredConnection = {
  accessTokenEnc: string;
  personUrn: string;
  name: string;
  expiresAt: number;
  scope: string | null;
  updatedAt: number;
};

type UserDocWithLinkedIn = {
  id: string;
  linkedin?: StoredConnection;
  [key: string]: unknown;
};

export async function saveLinkedInConnection(
  uid: string,
  conn: LinkedInConnection & { scope?: string }
): Promise<void> {
  // Read-Modify-Upsert: Cosmos hat kein Feld-merge. Das users-Dokument
  // existiert nach dem ersten Login (Profil-Provisionierung); falls der
  // Callback früher feuert, wird ein Skelett angelegt.
  const existing = await readItem<UserDocWithLinkedIn>(usersContainer(), uid, uid);
  const now = new Date().toISOString();
  await upsertItem(usersContainer(), {
    ...(existing ?? { id: uid, createdAt: now }),
    id: uid,
    updatedAt: now,
    linkedin: {
      accessTokenEnc: encryptToken(conn.accessToken),
      personUrn: conn.personUrn,
      name: conn.name,
      expiresAt: conn.expiresAt,
      scope: conn.scope ?? null,
      updatedAt: Date.now(),
    },
  });
}

export async function getLinkedInConnection(
  uid: string
): Promise<(LinkedInConnection & { expired: boolean }) | null> {
  const doc = await readItem<UserDocWithLinkedIn>(usersContainer(), uid, uid);
  const data = doc?.linkedin;
  if (!data) return null;

  const accessToken =
    typeof data.accessTokenEnc === "string" ? decryptToken(data.accessTokenEnc) : null;
  if (!accessToken || typeof data.personUrn !== "string") return null;

  const expiresAt = typeof data.expiresAt === "number" ? data.expiresAt : 0;
  return {
    accessToken,
    personUrn: data.personUrn,
    name: typeof data.name === "string" ? data.name : "",
    expiresAt,
    expired: Date.now() >= expiresAt,
  };
}
