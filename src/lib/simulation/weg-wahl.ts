/**
 * Paket 4, U1 und S1 (Owner-Entscheid 12.11.2026: Sprechen ist der erste Weg): die Vorwahl „Sprechen | Schreiben“
 * im Briefing als reine Entscheidung.
 *
 * Anlass: Das Sprachgespräch hing an einem kleinen Mikrofon-Symbol im Chat; wer es nicht fand, erlebte einen
 * Chatbot. Jetzt wählt die Person im Briefing. Sprechen ist vorgewählt, wenn (a) das Szenario das Sprachgespräch
 * erlaubt, (b) der Browser Live-Ton kann, (c) ein Mikrofon vorhanden ist (unbekannt gilt als vorhanden).
 * Fehlt (a) oder (b), gibt es keine Wahl, nur Schreiben. Die letzte eigene Wahl merkt sich das Gerät.
 */

export type Weg = 'sprechen' | 'schreiben';

/** Unter diesem Namen merkt sich das Gerät die letzte eigene Wahl (localStorage). */
export const WEG_MERKER = 'coach_sim-weg';

export interface WegLage {
  /** `liveAvailable` des Szenarios aus dem Katalog. */
  liveAvailable: boolean;
  /** `liveAudioSupported()` des Browsers. */
  liveTon: boolean;
  /** Mikrofon vorhanden? `null` = unbekannt (gilt als vorhanden). */
  mikrofon: boolean | null;
  /** Die letzte eigene Wahl auf diesem Gerät. */
  gemerkt: Weg | null;
}

export interface WegVorwahl {
  /** Gibt es die Wahl überhaupt? */
  wahl: boolean;
  /** Der vorgewählte Weg. */
  weg: Weg;
}

export function wegVorwahl(l: WegLage): WegVorwahl {
  if (!l.liveAvailable || !l.liveTon) return { wahl: false, weg: 'schreiben' };
  if (l.gemerkt === 'schreiben') return { wahl: true, weg: 'schreiben' };
  return { wahl: true, weg: l.mikrofon === false ? 'schreiben' : 'sprechen' };
}

/**
 * Weg beim Fortsetzen eines offenen Laufs: Sprechen nur, wenn die Person es auf diesem Gerät zuletzt selbst
 * gewählt hat. Wer bisher geschrieben hat, landet nicht ungefragt im Mikrofon-Check.
 */
export function wegBeimFortsetzen(l: WegLage): Weg {
  const v = wegVorwahl(l);
  return v.wahl && l.gemerkt === 'sprechen' && v.weg === 'sprechen' ? 'sprechen' : 'schreiben';
}

/** Gemerkten Wert lesen: nur die zwei bekannten Wörter zählen. */
export function gemerkterWeg(roh: string | null | undefined): Weg | null {
  return roh === 'sprechen' || roh === 'schreiben' ? roh : null;
}

/**
 * Ist ein Mikrofon da? Aus der Geräteliste des Browsers (`enumerateDevices`). Leere oder fehlende Liste = unbekannt
 * (`null`): Manche Browser nennen vor der Freigabe gar keine Geräte.
 */
export function mikrofonVorhanden(geraete: ReadonlyArray<{ kind: string }> | null | undefined): boolean | null {
  if (!geraete || geraete.length === 0) return null;
  return geraete.some((g) => g.kind === 'audioinput');
}
