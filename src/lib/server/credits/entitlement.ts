import "server-only";

import { NextResponse } from "next/server";
import { creditsCentralEnabled, centralReserve, centralRefund, centralWalletStatus } from "./credit-service";
import { logger } from "@/lib/logger";

/**
 * Entitlement-Gate fuer den Analyse-Lauf (Point-of-Sale) — CENTRAL-ONLY.
 *
 * KK-1 (Go-Live-Blueprint): Der lokale Ledger-Zweig (PAYMENTS_ENABLED +
 * reserve/settle/refund gegen den workspaces-Container) wurde abgebaut.
 * Der zentrale CreditService ist die einzige Wallet-Wahrheit.
 *
 * Reihenfolge in POST /api/analyze:
 *   1) runId serverseitig erzeugen (bindet Spend & spaeteren Run aneinander)
 *   2) centralReserve -> finaler Spend (kein Hold) VOR dem teuren Gemini-Call
 *   3) Analyse laufen lassen
 *   4) Erfolg  -> settleEntitlement (No-Op, Spend war final)
 *      Fehler  -> compensateEntitlement (zentraler Refund mit spend-txId)
 *
 * Bei CREDITS_CENTRAL=off (z. B. lokal) greift kein Credit-Gate — die Analyse
 * laeuft unveraendert (nur cost-cap als Schutz).
 */

/** Greift das Credit-Gate fuer /api/analyze? Nur noch der zentrale Cutover-Flag. */
export function creditGateEnabled(): boolean {
  return creditsCentralEnabled();
}

export interface EntitlementGrant {
  /** Der serverseitig erzeugte Run-/Spend-Identifier; der Save muss ihn uebernehmen. */
  runId: string;
  workspaceId: string;
  /** true, wenn zentral verbraucht wurde (compensate erforderlich bei Abbruch). */
  held: boolean;
  /** Immer true: zentral verbraucht (Spend ist final, kein lokaler Hold). */
  central?: boolean;
  /** transactionId der zentralen spend-Antwort — Pflicht-Anker fuer den zentralen Refund. */
  centralTxId?: string;
}

export type EntitlementResult =
  | { ok: true; grant: EntitlementGrant }
  | { ok: false; response: NextResponse };

function topUpUrl(): string | undefined {
  // Welle D (IA-Masterplan 15.08.): fester Fallback auf DIE eine Kasse —
  // ohne Env fiel der Chip vorher still auf die interne /credits-Sackgasse.
  return process.env.CREDIT_TOPUP_URL || "https://pulsenorth.ai/preise";
}

/**
 * B13 (01.10.2026): Credits kauft nur der Admin (der CreditService erzwingt es am
 * Checkout). Wer zentral nur Mitglied ist, bekommt deshalb KEINEN Kauf-Link, sondern
 * `canTopUp: false` — die Oberfläche zeigt dann den vorhandenen Mitglieder-Text.
 * Gleiche Regel wie /api/credits (Welle F). Fail-soft: ist die Rolle nicht ermittelbar,
 * bleibt es beim bisherigen Verhalten (Link an).
 */
async function memberCanTopUp(): Promise<boolean> {
  try {
    const { auth } = await import("@/auth");
    const oid = ((await auth())?.user as { oid?: string } | undefined)?.oid;
    if (!oid) return true;
    const { getCentralMemberInfo } = await import("./member-info");
    const central = await getCentralMemberInfo(oid);
    return central?.role !== "member";
  } catch {
    return true;
  }
}

function paywall(workspaceId: string, canTopUp: boolean): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      code: "INSUFFICIENT_CREDITS",
      error: canTopUp
        ? "Kostenloses Kontingent aufgebraucht. Bitte Credits kaufen, um weitere Analysen zu starten."
        : "Das Kontingent deines Unternehmens ist aufgebraucht — dein Admin ist informiert.",
      workspaceId,
      canTopUp,
      ...(canTopUp && topUpUrl() ? { topUpUrl: topUpUrl() } : {}),
    },
    { status: 402 } // Payment Required
  );
}

/**
 * Verbraucht 1 Credit zentral (finaler Spend, kein Hold). Gibt bei leerem Saldo
 * eine 402-Paywall zurueck. Der Aufrufer MUSS im Fehlerfall compensate()
 * aufrufen (Refund mit der spend-transactionId).
 */
export async function reserveEntitlement(opts: {
  uid: string;
  email?: string | null;
  runId: string;
}): Promise<EntitlementResult> {
  const { runId } = opts;

  const c = await centralReserve({ runId });
  if (!c.ok) {
    if (c.reason === "ki_aus") {
      return { ok: false, response: NextResponse.json({ ok: false, code: "KI_AUS", error: KI_AUS_TEXT }, { status: 403 }) };
    }
    if (c.reason === "insufficient") {
      return { ok: false, response: paywall(c.workspaceId, await memberCanTopUp()) };
    }
    if (c.reason === "no_token") {
      // Kein nutzbares CreditService-Token: Refresh fehlgeschlagen
      // (error="RefreshFailed") oder alte Session vor dem Scope -> Re-Login
      // noetig. Fail-closed (kein Gratis-Run); der Client zeigt CENTRAL_REAUTH.
      return {
        ok: false,
        response: NextResponse.json(
          { ok: false, code: "CENTRAL_REAUTH", error: "Bitte neu anmelden, um Guthaben zu nutzen." },
          { status: 401 }
        ),
      };
    }
    // zentraler Dienst gestoert -> fail-closed (kein Gratis-Run), Client kann erneut
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, code: "CENTRAL_UNAVAILABLE", error: "Guthaben-Dienst nicht erreichbar. Bitte erneut versuchen." },
        { status: 503 }
      ),
    };
  }
  return {
    ok: true,
    grant: { runId, workspaceId: c.workspaceId, held: true, central: true, centralTxId: c.transactionId },
  };
}

/** Bei erfolgreicher Analyse: nichts zu tun — der zentrale Spend war bereits final. */
export async function settleEntitlement(_grant: EntitlementGrant): Promise<void> {
  // Zentral: spend war bereits final (kein Hold) -> nichts zu settlen.
}

/** Bei technischem Abbruch: zentral zurueckerstatten (MIT der spend-transactionId). */
export async function compensateEntitlement(grant: EntitlementGrant): Promise<void> {
  // Refund MIT der spend-transactionId (Pflicht-Anker). Ohne sie kann der
  // zentrale Refund nicht greifen -> hart loggen (haengende Belastung).
  if (!grant.centralTxId) {
    logger.apiError(
      "/api/analyze/compensate",
      new Error("central compensate without spend transactionId"),
      { runId: grant.runId, workspaceId: grant.workspaceId }
    );
    return;
  }
  await centralRefund({
    amount: 1,
    description: "coach:refund_technical_failure",
    spendTransactionId: grant.centralTxId,
    idempotencyKey: `refund:tech:${grant.runId}`,
  });
}

/**
 * S4-4 (Syren-Auftrag, Owner-GO 14.10.2026): Vorabprüfung VOR dem Rollenspiel.
 * Vorher prüfte der Coach das Guthaben erst bei der Auswertung — ein Rollenspiel
 * konnte vollständig laufen und scheiterte dann mit 402, die Übung war verloren.
 * Jetzt liest der Start den zentralen Saldo (nur lesen, keine Buchung) und
 * antwortet bei leerem Guthaben mit derselben 402-Form wie die Paywall, dazu
 * `preflight: true` und dem Satz, der zum Zeitpunkt passt. Fail-open: Ist der
 * Saldo nicht lesbar (abgelaufen/inert), startet das Rollenspiel wie bisher —
 * das Tor bei der Auswertung bleibt. Betriebskonto (fester Saldo) wird nie
 * gesperrt. Rückweg: COACH_PREFLIGHT=off.
 */
export function coachPreflightOn(): boolean {
  return (process.env.COACH_PREFLIGHT ?? "").trim().toLowerCase() !== "off";
}

export const PREFLIGHT_TEXT =
  "Für die Auswertung brauchst Du 1 Credit. Dein Guthaben ist leer. Lade jetzt auf, dann geht Deine Übung nicht verloren.";

export const KI_AUS_TEXT = "Rollenspiele und Gesprächsanalyse sind für Euer Unternehmen ausgeschaltet. Ein Admin kann sie im Hub unter Einstellungen › KI-Funktionen einschalten.";

/**
 * A4 (Prüfung Sichtbarkeit, 31.10.2026): Kern der Schalter-Prüfung für EINE Kennung, auch ohne Anfrage
 * (die Live-Sitzung am Server-Mantel fragt damit zwischen den Zügen nach).
 * true = der Schalter „Rollenspiele und Gesprächsanalyse (Coach)“ oder der Hauptschalter
 * „Alle KI-Funktionen … ausschalten“ ist aus. Wie bisher bleibt die KI an, wenn es keine Kennung gibt oder die
 * Einstellungen nicht lesbar sind (Verfügbarkeit vor Strenge) — neu ist die Warnung im Protokoll dazu.
 * Die Einstellungen kommen aus dem 60-s-Zwischenspeicher (member-info): Ausschalten wirkt nach spätestens einer Minute.
 * `ort` steht nur in der Warnung (welcher Einstieg); Kennungen kommen nicht ins Protokoll.
 */
export async function kiSchalterAus(oid: string | null | undefined, ort = "coach"): Promise<boolean> {
  const warnen = (grund: string, meta: Record<string, unknown> = {}) =>
    logger.warn("[ki-schalter] Einstellungen nicht lesbar, KI bleibt an", { ort, grund, ...meta });
  if (!oid) {
    // Zentrale aus (lokal): es gibt keine Einstellungen zu lesen, also auch keinen Lesefehler.
    if (creditsCentralEnabled()) warnen("ohne-kennung");
    return false;
  }
  try {
    const { getCentralMemberState, kiErlaubt } = await import("./member-info");
    const state = await getCentralMemberState(oid);
    if (state.kind === "info") return !kiErlaubt(state.info, "rollenspiele");
    if (creditsCentralEnabled()) warnen(state.kind);
  } catch (e) {
    warnen("fehler", { err: e instanceof Error ? e.message : String(e) });
  }
  return false;
}

/**
 * Schritt 9 / A-07: KI-Schalter des Unternehmens (Hub › Einstellungen › KI-Funktionen) — vor jedem Start und
 * seit A4 (31.10.2026) auch vor jedem KI-Schritt im laufenden Gespräch (Gesprächszug, Time-out-Tipp, Live-Karte,
 * Vorlesen, Sprach-Token, Interview-Zug). Antwort wie bisher: 403 KI_AUS mit KI_AUS_TEXT.
 */
export async function kiSchalterBlockt(ort?: string): Promise<NextResponse | null> {
  let oid: string | undefined;
  try {
    const { auth } = await import("@/auth");
    oid = ((await auth())?.user as { oid?: string } | undefined)?.oid;
  } catch (e) {
    logger.apiError("entitlement/ki-schalter", e);
    return null;
  }
  if (!(await kiSchalterAus(oid, ort))) return null;
  return NextResponse.json({ ok: false, code: "KI_AUS", error: KI_AUS_TEXT }, { status: 403 });
}

export async function preflightEntitlement(): Promise<NextResponse | null> {
  const kiAus = await kiSchalterBlockt();
  if (kiAus) return kiAus;
  if (!creditGateEnabled() || !coachPreflightOn()) return null;
  let w: Awaited<ReturnType<typeof centralWalletStatus>>;
  try {
    w = await centralWalletStatus();
  } catch (e) {
    logger.apiError("entitlement/preflight", e);
    return null;
  }
  if (w.state !== "active" || w.credits >= 1) return null;
  const canTopUp = await memberCanTopUp();
  return NextResponse.json(
    {
      ok: false,
      code: "INSUFFICIENT_CREDITS",
      preflight: true,
      error: canTopUp
        ? PREFLIGHT_TEXT
        : "Das Kontingent deines Unternehmens ist aufgebraucht — dein Admin ist informiert.",
      workspaceId: w.workspaceId,
      canTopUp,
      ...(canTopUp && topUpUrl() ? { topUpUrl: topUpUrl() } : {}),
    },
    { status: 402 }
  );
}
