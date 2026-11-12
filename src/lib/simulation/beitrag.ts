/**
 * Go-Live-Prüfung 12.11.2026 (Befund S6): Beiträge der übenden Person entschärfen, bevor sie an ein Modell gehen.
 * Am gespeicherten Gespräch ändert sich nichts; beide Funktionen wirken nur auf dem Weg zum Modell. Rein, getestet.
 */

/**
 * Die Rolle befolgt Regie-Notizen in eckigen Klammern (`[REGIE …]`, `[STAGE NOTE …]`). Frühere Beiträge der Person
 * standen ohne Zaun im Verlauf: Wer eine solche Klammer schrieb, gab der Rolle ab dem nächsten Zug Anweisungen
 * (einlenken, verdeckte Motive nennen). Eckige Klammern der Person werden deshalb zu runden.
 */
export function ohneRegieKlammern(text: string): string {
  return String(text ?? '')
    .replace(/[\[\uFF3B\u3010\u3014]/g, '(')
    .replace(/[\]\uFF3D\u3011\u3015]/g, ')');
}

/**
 * Ein Beitrag in einer Zeile. Im zusammengebauten Gespräch trennt eine Leerzeile die Beiträge, davor steht der Name.
 * Wer in seinen Beitrag eine Leerzeile und dann »Name der Rolle: …« schrieb, legte der Rolle Worte in den Mund,
 * die der Richter als Beleg nehmen konnte. Zeilenumbrüche innerhalb eines Beitrags werden deshalb zu Leerzeichen.
 */
export function einzeilig(text: string): string {
  return String(text ?? '')
    .replace(/\s*[\r\n\u2028\u2029]+\s*/g, ' ')
    .trim();
}
