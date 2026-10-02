/**
 * Kennung eines Kontos OHNE Microsoft ("ml:…", vom CreditService vergeben, `ml:<uuid>`).
 *
 * B12 (Rechte-Härtung 01.10.2026): Der Hub stellt für diese Konten eine Sitzung aus, deren
 * oid mit "ml:" beginnt. Das geteilte Session-Cookie gilt cluster-weit, also auch hier im
 * Coach. Sie haben keinen Eintrag im Entra-Token-Store; das zentrale Tor in `requireAuth`
 * lief für sie deshalb ins Leere (ohne Token keine Auskunft → fail-soft → durchgelassen) —
 * seitdem werden sie hart abgewiesen.
 *
 * Anmeldung-Umbau Schritt 2c (02.10.2026): Dieselbe Kennung tragen jetzt die PulseNorth-
 * Konten (Anmeldung ohne Microsoft, vollwertig). Sind sie eingeschaltet (cs-credential:
 * pnAccountsEnabled), entscheidet das Register per Dienst-Ausweis über den Zugang; sonst
 * bleibt es bei der harten Abweisung.
 *
 * Entra-oids sind GUIDs und beginnen nie mit "ml:" — die Erkennung ist eindeutig.
 * Reine Funktion (kein server-only): auch die Oberfläche nutzt sie („Neu anmelden" führt
 * ein solches Konto zur Anmeldekarte im Hub, nie zu Microsoft). Die strenge Regel für den
 * Dienst-Ausweis steht in cs-credential (isPnMemberId).
 */
export function isMagicLinkOid(oid: string | null | undefined): boolean {
  return typeof oid === "string" && oid.startsWith("ml:");
}
