import { BASE_PATH } from "@/lib/base-path";

/**
 * S26 (Paket 5, 12.11.2026): Einstiegslink eines Szenarios zum Weitergeben, z. B. `https://…/coach?szenario=ws-abc`.
 * Die Startseite öffnet damit das Briefing des Szenarios. Der Link schaltet nichts frei: Er führt nur angemeldete
 * Personen ans Ziel, die das Szenario ohnehin in ihrem Katalog haben. Kein öffentlicher Link.
 */
export function szenarioLink(origin: string, scenarioId: string, basePath: string = BASE_PATH): string {
  return `${origin}${basePath || "/"}?szenario=${encodeURIComponent(scenarioId)}`;
}
