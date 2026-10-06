import "server-only";

import { requireAuth } from "@/lib/api-auth";

/**
 * Lernenden-Sicht S5 (Owner-GO 06.10.2026) — „In den Werkzeugen nur, was Lernende brauchen“.
 *
 * Ohne das Häkchen „KI-Coach“ (Team & Zugänge im Hub) lehnt das Tor der API jeden Abruf ab
 * (requireAuth: APP_NOT_ENABLED). Die Seiten luden trotzdem mit der Oberfläche zum Üben.
 * Jetzt fragt der Rahmen der Seiten DIESELBE Entscheidung ab und zeigt statt der App eine
 * klare Seite „kein Zugang“ mit dem Weg in „Mein Lernbereich“.
 *
 * Es entscheidet genau das Tor der API — keine zweite Regel. Nur die Ablehnung
 * „App nicht freigeschaltet“ führt zur Seite; keine Sitzung, abgelaufene Anmeldung,
 * deaktiviertes Konto und Störungen bleiben wie bisher.
 *
 * Rückweg ohne Neu-Auslieferung: COACH_NO_ACCESS_PAGE=off → wie zuvor. Pro Aufruf gelesen.
 */
export function noAccessPageOn(): boolean {
  return (process.env.COACH_NO_ACCESS_PAGE ?? "on").trim().toLowerCase() !== "off";
}

/** Ist diese Antwort des Tors die Ablehnung „App nicht freigeschaltet“? */
export async function isAppNotEnabledResponse(r: unknown): Promise<boolean> {
  if (!(r instanceof Response) || r.status !== 403) return false;
  const body = (await r.clone().json().catch(() => null)) as { code?: unknown } | null;
  return body?.code === "APP_NOT_ENABLED";
}

export async function coachNotEnabled(): Promise<boolean> {
  if (!noAccessPageOn()) return false;
  try {
    // requireAuth liest die Sitzung aus auth(); der Request dient nur der Sprache der Meldung.
    const r = await requireAuth(new Request("http://localhost/rahmen"));
    return await isAppNotEnabledResponse(r);
  } catch {
    return false;
  }
}
