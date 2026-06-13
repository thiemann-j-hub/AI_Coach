import "server-only";

import { NextResponse } from "next/server";
import { usageContainer } from "@/lib/cosmos";

/**
 * Pro-User-Token-Budget pro Tag (Cosmos `usage`-Container, TTL 35 Tage).
 *
 * Ersetzt für teure LLM-Routen das wirkungslose In-Memory-IP-Rate-Limit:
 * der Zähler lebt in Cosmos und gilt damit über alle App-Service-Instanzen
 * hinweg. Schlüssel ist die uid (nicht die spoofbare IP).
 *
 * Adaptiert vom Cost-Cap-Muster der Schwester-App (W85): atomarer
 * Server-seitiger Increment (Cosmos patch `incr`) statt Read-Modify-Write,
 * dadurch race-sicher gegen parallele Calls.
 */

const DAILY_TOKEN_LIMIT = Number(process.env.DAILY_TOKEN_LIMIT ?? "500000");

/** "enforce" (Default) blockt bei Überschreitung mit 429; "off" zählt nur. */
function mode(): "off" | "enforce" {
  return (process.env.COST_CAP_MODE ?? "enforce").toLowerCase() === "off"
    ? "off"
    : "enforce";
}

function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

function todayKey(uid: string): string {
  // YYYY-MM-DD in UTC — stabil über Instanzen
  const d = new Date().toISOString().slice(0, 10);
  return `${uid}_${d}`;
}

type UsageDoc = {
  id: string;
  uid: string;
  date: string;
  tokensUsed: number;
  updatedAt: string;
  // ttl wird container-seitig (35 Tage) gesetzt; pro Doc nicht nötig
};

export interface BudgetResult {
  allowed: boolean;
  used: number;
  limit: number;
  response?: NextResponse; // gesetzt, wenn !allowed (429)
}

/**
 * Reserviert `estimatedTokens` im Tagesbudget des Users. Bei Überschreitung
 * (und mode=enforce, kein Admin) → allowed=false + 429-Response.
 * Atomar via Cosmos patch-incr; legt das Tagesdoc bei Bedarf an.
 */
export async function checkAndConsumeBudget(opts: {
  uid: string;
  email?: string | null;
  estimatedTokens: number;
  message?: string;
}): Promise<BudgetResult> {
  const { uid, email, estimatedTokens } = opts;
  const limit = DAILY_TOKEN_LIMIT;

  // Admin-Bypass (E-Mail-Allowlist) — der Owner blockt sich nie selbst
  if (email && adminEmails().has(email.toLowerCase())) {
    return { allowed: true, used: 0, limit };
  }

  const container = usageContainer();
  const id = todayKey(uid);
  const date = id.slice(id.indexOf("_") + 1);
  const now = new Date().toISOString();
  const inc = Math.max(0, Math.round(estimatedTokens));

  let used = inc;
  try {
    // Atomarer Increment; schlägt mit 404 fehl, wenn das Doc noch nicht existiert.
    const { resource } = await container.item(id, id).patch([
      { op: "incr", path: "/tokensUsed", value: inc },
      { op: "set", path: "/updatedAt", value: now },
    ]);
    used = (resource as UsageDoc)?.tokensUsed ?? inc;
  } catch (err: any) {
    if (err?.code === 404) {
      // Erstes Doc des Tages anlegen
      const doc: UsageDoc = { id, uid, date, tokensUsed: inc, updatedAt: now };
      try {
        await container.items.create(doc);
        used = inc;
      } catch (err2: any) {
        // Race: jemand anderes hat es gerade angelegt → erneut increment
        if (err2?.code === 409) {
          const { resource } = await container.item(id, id).patch([
            { op: "incr", path: "/tokensUsed", value: inc },
            { op: "set", path: "/updatedAt", value: now },
          ]);
          used = (resource as UsageDoc)?.tokensUsed ?? inc;
        } else {
          // Budget-Infra darf den eigentlichen Request nicht killen → durchlassen
          console.warn("[cost-cap] usage write failed, allowing request:", err2?.message);
          return { allowed: true, used: inc, limit };
        }
      }
    } else {
      console.warn("[cost-cap] usage patch failed, allowing request:", err?.message);
      return { allowed: true, used: inc, limit };
    }
  }

  if (mode() === "enforce" && used > limit) {
    const message =
      opts.message ?? "Tägliches Nutzungslimit erreicht. Bitte morgen erneut versuchen.";
    return {
      allowed: false,
      used,
      limit,
      response: NextResponse.json(
        { ok: false, error: message, code: "QUOTA_EXCEEDED", limit, used },
        { status: 429 }
      ),
    };
  }

  return { allowed: true, used, limit };
}

/** Grobe Token-Schätzung (≈4 Zeichen/Token) für die Vorab-Reservierung. */
export function estimateTokens(...texts: (string | null | undefined)[]): number {
  const chars = texts.reduce((n, t) => n + (t ? t.length : 0), 0);
  // Input + erwarteter Output (Analyse erzeugt ~2-3k Token), grob gerundet
  return Math.ceil(chars / 4) + 3000;
}
