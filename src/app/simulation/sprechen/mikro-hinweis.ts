/**
 * CP-3.4 (M21 Option 1, Compliance-Blueprint 31.08.): Aufklärung vor der ERSTEN Mikrofon-Nutzung je Gerät.
 * Die Bestätigung liegt in localStorage (try/catch, Vorgabe Browser-Storage). Ist localStorage gesperrt
 * (Privatmodus), gilt sie für die laufende Sitzung, ohne Endlos-Hinweis.
 *
 * Paket 4, C25 (12.11.2026): aus SimulationClient herausgelöst, weil jetzt zwei Stellen fragen: der Mikrofon-Check
 * vor dem Sprechen (Hinweis als erster Schritt der Ansicht) und das Diktat im Chat und im Check-in (Dialog).
 */
const MIC_ACK_KEY = 'pn-mic-notice-ack';

let inDieserSitzung = false;

export function mikroHinweisBestaetigt(): boolean {
  if (inDieserSitzung) return true;
  try {
    inDieserSitzung = localStorage.getItem(MIC_ACK_KEY) === '1';
  } catch {
    /* localStorage gesperrt: Es gilt die Sitzung. */
  }
  return inDieserSitzung;
}

export function mikroHinweisBestaetigen(): void {
  inDieserSitzung = true;
  try {
    localStorage.setItem(MIC_ACK_KEY, '1');
  } catch {
    /* Privatmodus: Die Bestätigung gilt für diese Sitzung. */
  }
}
