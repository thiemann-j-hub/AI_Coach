/**
 * Paket 3, S8 (12.11.2026): Check-in nach dem Gespräch als zwei kurze Fragen nacheinander.
 *
 * Vorher stand eine Doppelfrage im Dialog, und erst nach dem Absenden begann die Auswertung. Jetzt rechnet der
 * Richter schon, während die Person antwortet. Regeln (WELLE2-ABLAUF.md): kein Nachhaken, „Weiter“ und
 * „Überspringen“ immer sichtbar, bei leerem Feld geht es nach 20 Sekunden ohne Eingabe von selbst weiter.
 * Schrittfolge und Frist stehen hier als reine Funktionen (getestet in checkin-ablauf.test.ts); der Dialog
 * im Gesprächs-Client zeigt sie nur an.
 */

/** Frage 1 „Was ist Dir gut gelungen?“, Frage 2 „Was würdest Du beim nächsten Mal anders machen?“ */
export const CHECKIN_FRAGEN = ['gut', 'anders'] as const;
export type CheckinFrage = (typeof CHECKIN_FRAGEN)[number];

/** Obergrenze je Antwort, wie in POST /api/simulation/checkin. */
export const CHECKIN_MAX_CHARS = 400;

/** So lange darf das leere Feld ohne Eingabe stehen, dann geht es von selbst weiter. */
export const CHECKIN_AUTO_WEITER_MS = 20_000;

export interface CheckinStand {
  frage: CheckinFrage;
  gut: string | null;
  anders: string | null;
}

/** Körper für POST /api/simulation/checkin (ohne `simId`). */
export interface CheckinBody {
  gut?: string;
  anders?: string;
  skipped?: boolean;
}

export type CheckinAktion =
  /** „Weiter“ oder die abgelaufene Frist: nimmt den Text des Feldes (leer = diese Frage bleibt ohne Antwort). */
  | { art: 'weiter'; text: string }
  /** „Überspringen“: beendet den Check-in sofort; schon gegebene Antworten bleiben, der Text im Feld nicht. */
  | { art: 'ueberspringen' };

export type CheckinFolge =
  | { fertig: false; stand: CheckinStand }
  | { fertig: true; body: CheckinBody };

export function checkinStart(): CheckinStand {
  return { frage: 'gut', gut: null, anders: null };
}

function antwort(text: string): string | null {
  return text.trim().slice(0, CHECKIN_MAX_CHARS).trim() || null;
}

/** Ohne jede Antwort gilt der Check-in als übersprungen (dann gibt es keinen Abgleich mit dem Selbstbild). */
function body(gut: string | null, anders: string | null): CheckinBody {
  if (!gut && !anders) return { skipped: true };
  return { ...(gut ? { gut } : {}), ...(anders ? { anders } : {}) };
}

/** Ein Schritt im Check-in: nächste Frage oder fertig mit dem Körper für den Server. */
export function checkinSchritt(stand: CheckinStand, aktion: CheckinAktion): CheckinFolge {
  if (aktion.art === 'ueberspringen') return { fertig: true, body: body(stand.gut, stand.anders) };
  if (stand.frage === 'gut') {
    return { fertig: false, stand: { frage: 'anders', gut: antwort(aktion.text), anders: null } };
  }
  return { fertig: true, body: body(stand.gut, antwort(aktion.text)) };
}

/**
 * Die 20-Sekunden-Regel: Millisekunden, bis es von selbst weitergeht, oder null, wenn die Uhr nicht läuft.
 * Sie läuft nur bei leerem Feld und ohne laufendes Diktat (wer spricht, gibt gerade ein; der Text kommt erst
 * nach dem Satz im Feld an). Jede Eingabe setzt `letzteEingabeMs` neu, damit beginnt die Uhr von vorn.
 */
export function checkinAutoWeiterIn(args: {
  text: string;
  diktatLaeuft: boolean;
  letzteEingabeMs: number;
  jetztMs: number;
}): number | null {
  if (args.diktatLaeuft || args.text.trim() !== '') return null;
  return Math.max(0, args.letzteEingabeMs + CHECKIN_AUTO_WEITER_MS - args.jetztMs);
}
