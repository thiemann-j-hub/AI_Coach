/**
 * Paket 3, U12, S7 und S10 (12.11.2026): Ablauf der Auswertungsseite als reine Funktionen.
 *
 * Anlass: Die Auswertung startet jetzt beim „Ja, auswerten“ und läuft als Auftrag (Zustand `finishing`).
 * Die Seite /simulation/[simId] zeigt bis dahin ehrlich, wie lange es meist noch dauert, und danach die
 * Auswertung in vier Reitern. Welche Ansicht gilt, wie der Fortschritt aus Start und üblicher Dauer entsteht,
 * welcher Reiter in der Adresse steht und wann der Abgleich „Selbstbild und Auswertung“ noch aussteht,
 * entscheidet diese Datei (getestet in auswertung-ablauf.test.ts). Formate: WELLE2-ABLAUF.md.
 */

/** Abstand der Abfrage `GET /api/simulation/status`, solange gerechnet wird. */
export const STATUS_ABSTAND_MS = 2000;
/** So viele Abfragen dürfen hintereinander scheitern, bevor die Seite den Fehler zeigt. */
export const STATUS_FEHLER_MAX = 5;
/** Abgleich nachladen: höchstens dreimal im Abstand von vier Sekunden. */
export const ABGLEICH_VERSUCHE = 3;
export const ABGLEICH_ABSTAND_MS = 4000;

/** ready = Auswertung zeigen · finishing = Warteansicht · failed = Fehlschlag mit „Noch einmal“ · home = zum Einstieg. */
export type SeitenPhase = 'ready' | 'finishing' | 'failed' | 'home';

export function seitenPhase(
  s: { status?: unknown; feedback?: unknown; finishError?: unknown } | null | undefined
): SeitenPhase {
  if (!s) return 'home';
  if (s.status === 'finished' && s.feedback) return 'ready';
  if (s.status === 'finishing') return 'finishing';
  if (s.status === 'active' && s.finishError) return 'failed';
  return 'home';
}

export interface Wartestand {
  /** Füllung des Balkens, 0 bis 0,95 (voll wird er erst mit dem Ergebnis). */
  anteil: number;
  /** „Meist noch etwa {n} Sekunden“ in Fünferschritten; null = länger als üblich („Gleich fertig“). */
  restSekunden: number | null;
}

/**
 * Fortschritt aus dem Start der Rechnung und der üblichen Dauer (beides vom Server).
 * `now` ist die Uhr des Servers (Uhr des Geräts plus Abstand), damit eine falsch gestellte Uhr nichts verzerrt.
 * Ohne brauchbare Angaben: null (Balken ohne Zahl).
 */
export function wartestand(a: { startedAt?: string | null; typicalMs?: number | null; now: number }): Wartestand | null {
  const start = typeof a.startedAt === 'string' ? Date.parse(a.startedAt) : NaN;
  const typisch = typeof a.typicalMs === 'number' ? a.typicalMs : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(typisch) || typisch <= 0 || !Number.isFinite(a.now)) return null;
  const vergangen = Math.max(0, a.now - start);
  const rest = typisch - vergangen;
  if (rest <= 0) return { anteil: 0.95, restSekunden: null };
  return {
    anteil: Math.min(0.95, vergangen / typisch),
    restSekunden: Math.max(5, Math.ceil(rest / 5000) * 5),
  };
}

/** Die vier Reiter der Auswertung; der Name steht als `#name` in der Adresse. */
export const AUSWERTUNG_REITER = ['ueberblick', 'faehigkeiten', 'gespraech', 'weiter'] as const;
export type AuswertungReiter = (typeof AUSWERTUNG_REITER)[number];

export function reiterAusHash(hash: string | null | undefined): AuswertungReiter | null {
  const name = String(hash ?? '').replace(/^#/, '').toLowerCase();
  return (AUSWERTUNG_REITER as readonly string[]).includes(name) ? (name as AuswertungReiter) : null;
}

/** Die zwei Antworten des Check-ins (Felder des Laufs, alle optional: alte Läufe haben sie nie). */
export interface CheckinLike {
  gut?: string | null;
  anders?: string | null;
  skipped?: boolean | null;
}

/** Die gegebenen Antworten, in der Reihenfolge der Fragen; übersprungen oder leer → keine. */
export function checkinAntworten(c: CheckinLike | null | undefined): string[] {
  if (!c || c.skipped === true) return [];
  return [c.gut, c.anders].map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
}

/** Check-in beantwortet, der Abgleich „Selbstbild und Auswertung“ aber noch nicht da → nachladen. */
export function abgleichStehtAus(checkin: CheckinLike | null | undefined, selfReview: unknown): boolean {
  return !selfReview && checkinAntworten(checkin).length > 0;
}
