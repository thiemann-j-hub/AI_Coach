/**
 * B12 (Rechte-Härtung 01.10.2026): Sitzungen aus dem Magic-Link-Login des Hubs.
 *
 * Der Hub stellt für Lernende ohne Microsoft-Konto eine Sitzung aus, deren oid mit
 * "ml:" beginnt (vom CreditService vergeben, `ml:<uuid>`). Das geteilte Session-Cookie
 * gilt cluster-weit, also auch hier im Coach. Diese Lernenden haben aber KEINE
 * App-Freigabe (im Mandanten-Register stehen sie mit einer leeren App-Liste) und
 * keinen Eintrag im Entra-Token-Store. Das zentrale Tor in `requireAuth` lief für sie
 * deshalb ins Leere (ohne Token keine Auskunft → fail-soft → durchgelassen).
 *
 * Entra-oids sind GUIDs und beginnen nie mit "ml:" — die Erkennung ist eindeutig.
 * Reine Funktion (kein server-only), damit sie getestet werden kann.
 */
export function isMagicLinkOid(oid: string | null | undefined): boolean {
  return typeof oid === "string" && oid.startsWith("ml:");
}
