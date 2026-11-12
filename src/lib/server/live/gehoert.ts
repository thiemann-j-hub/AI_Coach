/**
 * Paket 4, S31 (12.11.2026): Nur Gehörtes in den Verlauf.
 *
 * Das Live-Modell erzeugt eine Antwort schneller, als sie abgespielt wird. Fällt die Person der Rolle ins Wort,
 * ist oft schon die ganze Antwort erzeugt und mitgeschrieben, gehört wurde aber nur der Anfang. Vorher landete der
 * ganze Text im Verlauf und konnte als Zitat in der Auswertung auftauchen.
 *
 * Das Relais merkt deshalb je Antwort, bei wie vielen Millisekunden Ton welcher Textstand erreicht war, und kürzt
 * nach einer Unterbrechung auf den Stand, der wirklich gespielt wurde. Alles hier ist rein (keine Außenwelt).
 */

/** Ton der Rolle: PCM 24 kHz, 16 Bit, Mono → 48 Bytes je Millisekunde. */
export const TON_BYTES_JE_MS = 48;

export function tonMs(bytes: number): number {
  return bytes / TON_BYTES_JE_MS;
}

/** Marke je Textstück: Als die Mitschrift `zeichen` lang war, waren `ms` Millisekunden Ton der Antwort unterwegs. */
export interface TextMarke {
  ms: number;
  zeichen: number;
}

/** Wie viele Zeichen der Antwort waren gesprochen, als `ms` Millisekunden Ton gespielt waren? */
export function textstandBei(marken: readonly TextMarke[], ms: number): number {
  if (!(ms > 0)) return 0;
  let stand = 0;
  for (const m of marken) {
    if (m.ms > ms) break;
    stand = Math.max(stand, m.zeichen);
  }
  return stand;
}

/**
 * Kürzt die Mitschrift der Rolle auf das, was bis `gehoertMs` gespielt war: an einer Wortgrenze, mit „…“ am Ende.
 * Wurde alles gehört, bleibt der Text unverändert. `gekuerzt` = Zahl der weggelassenen Zeichen.
 */
export function kuerzeAufGehoertes(
  text: string,
  marken: readonly TextMarke[],
  gehoertMs: number
): { text: string; gekuerzt: number } {
  const voll = text.trimEnd();
  let ende = Math.min(voll.length, textstandBei(marken, gehoertMs));
  if (ende >= voll.length) return { text, gekuerzt: 0 };
  // Mitten im Wort? Dann zurück bis hinter das letzte ganze Wort.
  if (ende > 0 && /\S/.test(voll[ende]) && /\S/.test(voll[ende - 1])) {
    ende = Math.max(0, voll.slice(0, ende).search(/\s\S*$/));
  }
  const kopf = voll.slice(0, ende).trimEnd();
  if (!kopf) return { text: "", gekuerzt: voll.length };
  // Nach einem ganzen Satz steht „…“ für sich, sonst hängt es am letzten Wort (ohne Komma davor).
  const gekuerzt = /[.!?]$/.test(kopf) ? `${kopf} …` : `${kopf.replace(/[,;:–-]+$/, "").trimEnd()}…`;
  return { text: gekuerzt, gekuerzt: voll.length - kopf.length };
}

/**
 * Ohne Meldung des Browsers (alter Client): Gespielt ist ungefähr die Zeit seit dem ersten Ton dieser Antwort,
 * höchstens aber der Ton, der überhaupt unterwegs war.
 */
export function schaetzeGehoertMs(a: { ersterTonAt: number | null; jetzt: number; tonMsGesamt: number }): number {
  if (a.ersterTonAt == null) return 0;
  return Math.max(0, Math.min(a.tonMsGesamt, a.jetzt - a.ersterTonAt));
}

/** `ms` aus `{ t: "heard", ms }`: nur eine endliche Zahl ab 0 gilt, sonst greift die Schätzung (null). */
export function gehoertVomBrowser(ms: unknown): number | null {
  return typeof ms === "number" && Number.isFinite(ms) && ms >= 0 ? ms : null;
}
