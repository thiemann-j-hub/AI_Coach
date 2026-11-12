import "server-only";

import { logger } from "@/lib/logger";

/**
 * Paket 4, S24 (12.11.2026): Zählpunkte auf dem Weg ins Gespräch. Niemand sah bisher, wo Menschen vor dem ersten
 * Wort aussteigen. Jeder Schritt ist EINE Protokollzeile mit demselben Ereignisnamen, ohne Nutzertext und ohne
 * Kennung der Person. Mehr nicht: keine Ablage, keine Auswertungsseite.
 *   briefing          Briefing geöffnet                (POST /api/simulation/zaehlpunkt)
 *   start             Gespräch gestartet               (Start-Route)
 *   mikro_ok          Mikrofon-Check bestanden         (POST /api/simulation/zaehlpunkt)
 *   mikro_verweigert  Mikrofon nicht freigegeben       (POST /api/simulation/zaehlpunkt)
 *   erstes_wort       erster eigener Zug               (Zug-Route = schreiben, Relais = sprechen)
 */
export const TRICHTER_EREIGNIS = "/api/simulation/trichter";

export type TrichterSchritt = "briefing" | "start" | "mikro_ok" | "mikro_verweigert" | "erstes_wort";
export type TrichterWeg = "sprechen" | "schreiben";

export function zaehlpunkt(schritt: TrichterSchritt, scenarioId: string, weg?: TrichterWeg | null): void {
  logger.api(TRICHTER_EREIGNIS, schritt, { scenarioId, ...(weg ? { weg } : {}) });
}
