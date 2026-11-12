import "server-only";

import { deleteItem, runsContainer, upsertItem } from "@/lib/cosmos";
import { logger } from "@/lib/logger";
import type { EntitlementResult } from "./entitlement";

/**
 * Buchungsvermerk (Go-Live-Prüfung 12.11.2026, S3): Spur für Credit-Buchungen, die an keinem Lauf hängen.
 *
 * Die Wege Analyse, „Vorbereiten“ und Builder buchen 1 Credit, BEVOR sie rechnen (bis zu 170 Sekunden), unter einer
 * Kennung, die bisher nirgends stand. Endete der Prozess in dieser Zeit, antwortete der Credit-Dienst nicht klar oder
 * scheiterte die Rückbuchung, fehlte der Person ein Credit ohne jede Spur. Jetzt:
 *   1. vor der Buchung ein Vermerk in Cosmos (Person, Art, Kennung, Zeit),
 *   2. nach der Antwort Buchungsnummer und Arbeitsbereich dazu,
 *   3. nach Erfolg oder gelungener Rückbuchung wieder weg.
 * Bleibt er stehen, listet ihn `scripts/credits-abgleich.mts` neben den Vermerken der Rollenspiel-Auswertung
 * (`openCharge` am Lauf, `simulation-finish.ts`). Zurückgegeben wird von Hand; nichts hier bucht nach.
 *
 * Vierte Art `analyse-rueckgabe` (S1): Wer eine Analyse im Rückgabe-Fenster löscht, bekommt den Credit zurück. Das
 * Dokument der Analyse wird dabei wirklich gelöscht. Der Vermerk hält fest, dass eine Rückgabe fällig war; gelingt
 * sie, ist er wieder weg, sonst bleibt er als einzige Spur stehen (ohne Inhalte der Analyse).
 *
 * Fail-soft: Der Vermerk ist Buchführung. Scheitert sein Schreiben, läuft der Geldweg weiter wie zuvor und das
 * Protokoll nennt es.
 *
 * Ablage: Container `runs`, Partition `buchung:<uid>`, `docType: "buchungsvermerk"`. Der Doppelpunkt hält die
 * Partition aus dem Muster der Sitzungskennungen heraus. Über das Feld `uid` nimmt die Konto-Löschung die Vermerke mit.
 */
export const BUCHUNGSVERMERK_DOC_TYPE = "buchungsvermerk" as const;

export type BuchungsArt = "analyse" | "vorbereiten" | "builder" | "analyse-rueckgabe";

export interface Buchungsvermerk {
  /** `<art>:<kennung>` */
  id: string;
  /** Partition: `buchung:<uid>` */
  sessionId: string;
  docType: typeof BUCHUNGSVERMERK_DOC_TYPE;
  uid: string;
  art: BuchungsArt;
  /** Analyse und Rückgabe: Kennung des Laufs. „Vorbereiten“ und Builder: Zufallskennung des Aufrufs. */
  kennung: string;
  /** Zeitpunkt des Vermerks (vor der Buchung). */
  at: string;
  /** Buchungsnummer des Credit-Dienstes; fehlt sie, ist die Buchung unbestätigt. */
  txId?: string | null;
  workspaceId?: string | null;
  /** Gesetzt, wenn die Rückbuchung scheiterte: Der Credit fehlt der Person. */
  refundFailedAt?: string | null;
}

export function buchungsPartition(uid: string): string {
  return `buchung:${uid}`;
}

/** Schlüssel, unter dem der Credit-Dienst die Buchung (bei der Rückgabe: die Rückbuchung) führt. Rein. */
export function creditSchluessel(art: BuchungsArt, kennung: string): string {
  return art === "analyse-rueckgabe" ? `refund:${kennung}` : `spend:${kennung}`;
}

/** Vermerk schreiben. Gibt null zurück, wenn das Schreiben scheitert (Protokollzeile); wirft nie. */
export async function vermerkAnlegen(a: {
  uid: string;
  art: BuchungsArt;
  kennung: string;
  txId?: string | null;
  workspaceId?: string | null;
  at?: string;
  refundFailedAt?: string | null;
}): Promise<Buchungsvermerk | null> {
  const doc: Buchungsvermerk = {
    id: `${a.art}:${a.kennung}`,
    sessionId: buchungsPartition(a.uid),
    docType: BUCHUNGSVERMERK_DOC_TYPE,
    uid: a.uid,
    art: a.art,
    kennung: a.kennung,
    at: a.at ?? new Date().toISOString(),
    ...(a.txId ? { txId: a.txId } : {}),
    ...(a.workspaceId ? { workspaceId: a.workspaceId } : {}),
    ...(a.refundFailedAt ? { refundFailedAt: a.refundFailedAt } : {}),
  };
  try {
    await upsertItem(runsContainer(), doc);
    return doc;
  } catch (e) {
    logger.apiError("credits/buchungsvermerk", e, { schritt: "anlegen", art: a.art, kennung: a.kennung });
    return null;
  }
}

async function vermerkErgaenzen(
  v: Buchungsvermerk,
  patch: Partial<Pick<Buchungsvermerk, "txId" | "workspaceId" | "refundFailedAt">>
): Promise<Buchungsvermerk> {
  const neu = { ...v, ...patch };
  try {
    await upsertItem(runsContainer(), neu);
  } catch (e) {
    logger.apiError("credits/buchungsvermerk", e, { schritt: "ergaenzen", art: v.art, kennung: v.kennung });
  }
  return neu;
}

/** Vermerk austragen: Das Ergebnis ist gespeichert oder der Credit ist zurück. Wirft nie. */
export async function vermerkAustragen(v: Buchungsvermerk | null): Promise<void> {
  if (!v) return;
  try {
    await deleteItem(runsContainer(), v.id, v.sessionId);
  } catch (e) {
    logger.error("[credits] Buchungsvermerk nicht ausgetragen – er steht im Abgleich, obwohl kein Geld offen ist", {
      art: v.art,
      kennung: v.kennung,
      err: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Buchen mit Spur: Vermerk anlegen, DANN buchen. `buchen` bekommt die Kennung und ruft `reserveEntitlement`.
 *  - gebucht: Buchungsnummer und Arbeitsbereich am Vermerk nachtragen,
 *  - klare Ablehnung (kein Guthaben, KI aus, neu anmelden): Es wurde nichts gebucht, der Vermerk ist wieder weg,
 *  - Antwort ohne klares Ergebnis (Frist, Netz, 5xx): Der Vermerk BLEIBT, denn zentral kann gebucht sein.
 * Wirft `buchen`, bleibt der Vermerk ebenfalls stehen und der Fehler geht an den Aufrufer.
 */
export async function buchenMitVermerk(
  a: { uid: string; art: BuchungsArt; kennung: string },
  buchen: (kennung: string) => Promise<EntitlementResult>
): Promise<{ ent: EntitlementResult; vermerk: Buchungsvermerk | null }> {
  let vermerk = await vermerkAnlegen(a);
  const ent = await buchen(a.kennung);
  if (ent.ok) {
    if (vermerk) {
      vermerk = await vermerkErgaenzen(vermerk, { txId: ent.grant.centralTxId ?? null, workspaceId: ent.grant.workspaceId });
    }
  } else if (ent.unklar) {
    logger.warn("[credits] Buchung ohne klare Antwort – der Vermerk bleibt stehen (scripts/credits-abgleich.mts)", {
      art: a.art,
      kennung: a.kennung,
      vermerkt: vermerk !== null,
    });
  } else {
    await vermerkAustragen(vermerk);
    vermerk = null;
  }
  return { ent, vermerk };
}

/**
 * Zurückbuchen mit Spur. `rueckbuchen` ruft `compensateEntitlement` (technischer Fehler) oder `centralRefund`
 * (Rückgabe beim Löschen). Gelungen: Vermerk weg. Gescheitert: Der Credit ist NICHT zurück, der Vermerk bleibt mit
 * dem Zeitpunkt des Fehlschlags stehen, dazu eine klare Protokollzeile. Wirft nie. Antwort: Ist der Credit zurück?
 */
export async function rueckbuchenMitVermerk(
  a: { art: BuchungsArt; kennung: string; vermerk: Buchungsvermerk | null },
  rueckbuchen: () => Promise<{ ok: boolean }>
): Promise<boolean> {
  let ok = false;
  try {
    ok = (await rueckbuchen())?.ok === true;
  } catch (e) {
    logger.apiError("credits/buchungsvermerk", e, { schritt: "rueckbuchen", art: a.art, kennung: a.kennung });
  }
  if (ok) {
    await vermerkAustragen(a.vermerk);
    return true;
  }
  logger.error("[credits] Rückbuchung gescheitert – der Credit ist NICHT zurück, der Vermerk bleibt stehen (scripts/credits-abgleich.mts)", {
    art: a.art,
    kennung: a.kennung,
    vermerkt: a.vermerk !== null,
  });
  if (a.vermerk) await vermerkErgaenzen(a.vermerk, { refundFailedAt: new Date().toISOString() });
  return false;
}

// ── Einordnung für den Abgleich (rein, ohne I/O) ─────────────────────────────

export type VermerkLage =
  /** Jung: Der Weg rechnet vermutlich noch. Kein Befund. */
  | "laeuft"
  /** Keine Buchungsnummer: Der Credit-Dienst antwortete nicht klar, oder der Prozess endete vor der Antwort. */
  | "unbestaetigt"
  /** Gebucht, aber weder Ergebnis gespeichert noch zurückgebucht (Prozess-Ende dazwischen). */
  | "gebucht-ohne-ergebnis"
  /** Die Rückbuchung scheiterte: Der Credit fehlt der Person. */
  | "rueckbuchung-gescheitert"
  /** Analyse im Rückgabe-Fenster gelöscht, Rückgabe nicht bestätigt (Prozess-Ende dazwischen). */
  | "rueckgabe-offen";

export function vermerkLage(
  v: Pick<Buchungsvermerk, "art" | "at" | "txId" | "refundFailedAt">,
  now: Date,
  minMinutes: number
): VermerkLage {
  if (v.refundFailedAt) return "rueckbuchung-gescheitert";
  const alterMin = (now.getTime() - new Date(v.at).getTime()) / 60_000;
  if (Number.isFinite(alterMin) && alterMin < minMinutes) return "laeuft";
  if (v.art === "analyse-rueckgabe") return "rueckgabe-offen";
  return v.txId ? "gebucht-ohne-ergebnis" : "unbestaetigt";
}

/** Was im Betrieb zu tun ist. Rein. */
export function vermerkHinweis(art: BuchungsArt, lage: VermerkLage): string {
  if (lage === "laeuft") return "Der Weg rechnet vermutlich noch – später erneut prüfen.";
  if (art === "analyse-rueckgabe") {
    return lage === "rueckbuchung-gescheitert"
      ? "Die Analyse wurde im Rückgabe-Fenster gelöscht, die Rückgabe scheiterte. Mit der Buchungsnummer zurückgeben."
      : "Die Analyse wurde im Rückgabe-Fenster gelöscht, die Rückgabe ist nicht bestätigt. Im Credit-Dienst mit dem Schlüssel prüfen; fehlt sie, mit der Buchungsnummer zurückgeben.";
  }
  if (lage === "rueckbuchung-gescheitert") {
    return "Credit ist gebucht, der Weg scheiterte, die Rückbuchung auch. Mit der Buchungsnummer zurückgeben.";
  }
  if (lage === "gebucht-ohne-ergebnis") {
    return "Credit ist gebucht, der Prozess endete vor Ergebnis oder Rückbuchung. Prüfen, ob das Ergebnis doch gespeichert ist (Analyse: Lauf mit dieser Kennung; sonst: Szenario der Person kurz nach dem Zeitpunkt). Wenn nicht: mit der Buchungsnummer zurückgeben.";
  }
  return "Im Credit-Dienst mit dem Schlüssel prüfen, ob gebucht wurde. Wenn ja: zurückgeben, denn zu dieser Kennung entstand kein Ergebnis.";
}
