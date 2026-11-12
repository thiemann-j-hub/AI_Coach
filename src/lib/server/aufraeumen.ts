import "server-only";

import { deleteExpiredPrivateScenarios } from "@/lib/server/scenario-store";
import { deleteAbortedSimulationsBefore } from "@/lib/server/simulation-store";
import { logger } from "@/lib/logger";

/**
 * Paket 2, C19 (12.11.2026): gelegentliches Aufräumen über alle Personen.
 *
 * Zwei Löschlücken blieben offen, weil nur beim eigenen Listenaufruf gelöscht wurde:
 *   - private Szenarien („Mein echtes Gespräch“) verfallen nach 30 Tagen, verschwanden aber erst, wenn dieselbe
 *     Person wieder ihre Liste öffnete,
 *   - abgebrochene Rollenspiele behalten ihr Gespräch, stehen in keiner Liste und sind für die Person nicht löschbar.
 * Ein ohnehin laufender Listenaufruf stößt deshalb höchstens einmal pro Stunde je Prozess einen Durchgang an.
 * Er läuft neben der Anfrage (nie blockierend), jeder Teil für sich fail-soft, mit einer Protokollzeile.
 * Bewusst ohne Änderung an Cosmos (kein Container-TTL) und ohne Schalter.
 */
export const AUFRAEUMEN_ABSTAND_MS = 60 * 60_000;
/** Abgebrochene Rollenspiele werden gelöscht, wenn sie so viele Tage unverändert sind. */
export const ABGEBROCHEN_TAGE = 30;

export interface AufraeumErgebnis {
  /** Gelöschte abgelaufene private Szenarien (samt Spielbuch); null = dieser Teil ist gescheitert. */
  szenarien: number | null;
  /** Gelöschte abgebrochene Rollenspiele; null = dieser Teil ist gescheitert. */
  laeufe: number | null;
}

/** Ein Durchgang. Wirft nie: Scheitert ein Teil, läuft der andere trotzdem. */
export async function raeumeAuf(now: Date = new Date()): Promise<AufraeumErgebnis> {
  const teil = async (name: string, fn: () => Promise<number>): Promise<number | null> => {
    try {
      return await fn();
    } catch (e) {
      logger.apiError(`aufraeumen/${name}`, e);
      return null;
    }
  };
  const szenarien = await teil("szenarien", () => deleteExpiredPrivateScenarios(now));
  const cutoff = new Date(now.getTime() - ABGEBROCHEN_TAGE * 86_400_000).toISOString();
  const laeufe = await teil("laeufe", () => deleteAbortedSimulationsBefore(cutoff));
  return { szenarien, laeufe };
}

/**
 * Von einem Listenaufruf angestoßen: startet höchstens einmal pro Stunde je Prozess einen Durchgang und kehrt
 * sofort zurück. Der Zeitpunkt liegt an `globalThis` (ein Stand je Prozess, wie der Karten-Laden).
 */
export function aufraeumenAnstossen(now: number = Date.now()): void {
  const g = globalThis as typeof globalThis & { __coachAufraeumenAt?: number };
  if (g.__coachAufraeumenAt !== undefined && now - g.__coachAufraeumenAt < AUFRAEUMEN_ABSTAND_MS) return;
  g.__coachAufraeumenAt = now;
  const t0 = Date.now();
  void raeumeAuf(new Date(now))
    .then((r) => logger.info("[aufraeumen] Durchgang fertig", { ...r, ms: Date.now() - t0 }))
    .catch((e) => logger.apiError("aufraeumen", e));
}
