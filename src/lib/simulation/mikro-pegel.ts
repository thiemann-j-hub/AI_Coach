/**
 * Paket 4, S2 (12.11.2026): Pegel im Mikrofon-Check als reine Rechnung.
 *
 * Anlass: Vor dem ersten Wort gab es weder Pegel noch Gerätewahl; ob das Mikrofon etwas aufnimmt, merkte die Person
 * erst im Gespräch. Der Mikrofon-Check zeigt einen Balken und sagt „Ich höre Dich“, sobald der Pegel zwei Sekunden
 * lang über der Schwelle war. „Los geht's“ ist wählbar, sobald ein Pegel da war, und nach acht Sekunden ohne Pegel
 * trotzdem (mit Hinweis). Der Pegel selbst kommt aus einem AnalyserNode am Mikrofon-Strom (src/lib/live-audio.ts).
 */

/** Ab diesem Pegel (Effektivwert 0 bis 1) gilt: Da spricht jemand. Raumrauschen liegt nach der Rauschminderung deutlich darunter. */
export const PEGEL_SCHWELLE = 0.015;
/** So lange muss der Pegel über der Schwelle gewesen sein, bis „Ich höre Dich“ steht. */
export const PEGEL_GEHOERT_MS = 2000;
/** Sprechpausen bis zu dieser Länge zählen nicht als Abbruch (Atemholen, Wortgrenzen). */
export const PEGEL_PAUSE_MS = 1000;
/** Nach dieser Zeit ohne jeden Pegel ist „Los geht's“ trotzdem wählbar. */
export const PEGEL_OHNE_MS = 8000;

export interface PegelStand {
  /** Zeit über der Schwelle seit der letzten langen Stille. */
  ueberMs: number;
  /** Laufende Stille. */
  stilleMs: number;
  /** Seit das Mikrofon offen ist. */
  laeuftMs: number;
  /** Es war schon einmal ein Pegel da. */
  pegelDa: boolean;
  /** Zwei Sekunden über der Schwelle erreicht (bleibt stehen). */
  gehoert: boolean;
}

export function pegelStart(): PegelStand {
  return { ueberMs: 0, stilleMs: 0, laeuftMs: 0, pegelDa: false, gehoert: false };
}

/** Ein Messschritt: `pegel` ist der Effektivwert der letzten `dtMs` Millisekunden. */
export function pegelSchritt(s: PegelStand, pegel: number, dtMs: number): PegelStand {
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  const laeuftMs = s.laeuftMs + dt;
  if (Number.isFinite(pegel) && pegel >= PEGEL_SCHWELLE) {
    const ueberMs = s.ueberMs + dt;
    return { ueberMs, stilleMs: 0, laeuftMs, pegelDa: true, gehoert: s.gehoert || ueberMs >= PEGEL_GEHOERT_MS };
  }
  const stilleMs = s.stilleMs + dt;
  // Eine lange Stille setzt die Zählung zurück: Ein einzelnes Geräusch alle paar Sekunden ist kein Sprechen.
  return { ...s, laeuftMs, stilleMs, ueberMs: stilleMs > PEGEL_PAUSE_MS ? 0 : s.ueberMs };
}

/** „Los geht's“ ist wählbar: Ein Pegel war da, oder acht Sekunden sind ohne Pegel vergangen. */
export function losErlaubt(s: PegelStand): boolean {
  return s.pegelDa || s.laeuftMs >= PEGEL_OHNE_MS;
}

/** Hinweis „Ich höre noch nichts“: acht Sekunden ohne jeden Pegel. */
export function ohnePegel(s: PegelStand): boolean {
  return !s.pegelDa && s.laeuftMs >= PEGEL_OHNE_MS;
}

/**
 * Effektivwert (0 bis 1) aus den Bytes eines AnalyserNode (`getByteTimeDomainData`: 128 = Ruhe, 0 und 255 = Vollausschlag).
 * Die Byte-Fassung gibt es in jedem Browser; die Gleitkomma-Fassung fehlt in älteren Safari-Versionen.
 */
export function pegelAusBytes(bytes: ArrayLike<number>): number {
  const n = bytes.length;
  if (!n) return 0;
  let summe = 0;
  for (let i = 0; i < n; i++) {
    const v = (bytes[i] - 128) / 128;
    summe += v * v;
  }
  return Math.sqrt(summe / n);
}

/**
 * Breite des Balkens in Prozent (0 bis 100). Die Wurzel hebt leise Stimmen an: Normales Sprechen liegt bei einem
 * Effektivwert von 0,05 bis 0,2 und soll den Balken sichtbar füllen.
 */
export function balkenProzent(pegel: number): number {
  if (!Number.isFinite(pegel) || pegel <= 0) return 0;
  return Math.round(Math.min(1, Math.sqrt(pegel / 0.25)) * 100);
}
