/**
 * Paket 3, S11 (12.11.2026): die Messlatte zeigen.
 *
 * Anlass: Die vier Stufentexte je Fähigkeit sah bisher nur der Richter. Lernende lasen ein Etikett
 * („Ansätze erkennbar“), aber nicht, was die Stufe bedeutet und wie die nächste aussieht. Jetzt steht beides
 * auf der Karte der Fähigkeit. Quelle ist die Fähigkeiten-Bibliothek (nur lesen); Stufentexte gibt es in den
 * vier Gesprächssprachen Deutsch, Englisch, Französisch und Spanisch. Fehlt ein Text (freie Fähigkeit, nicht
 * beobachtbar), entfällt die Messlatte still. Reine Funktion, getestet in messlatte.test.ts.
 */
import { faehigkeit, faehigkeitStufen } from './faehigkeiten';

export interface Messlatte {
  /** Stufe 1 bis 4 (die Skala des Richters). */
  stufe: 1 | 2 | 3 | 4;
  /** Beobachtbares Verhalten auf der erreichten Stufe. */
  deine: string;
  /** Verhalten der nächsthöheren Stufe; null auf Stufe 4. */
  naechste: string | null;
}

export function messlatte(
  key: string | null | undefined,
  score: number | null | undefined,
  sprache: string | null | undefined
): Messlatte | null {
  if (!key || typeof score !== 'number' || !Number.isFinite(score)) return null;
  const kurz = (sprache ?? '').slice(0, 2).toLowerCase();
  const f = faehigkeit(key);
  if (!f) return null;
  const stufen = faehigkeitStufen(f, kurz);
  if (!stufen) return null;
  const stufe = Math.min(4, Math.max(1, Math.round(score))) as 1 | 2 | 3 | 4;
  const deine = stufen[stufe - 1]?.trim();
  if (!deine) return null;
  const naechste = stufe < 4 ? stufen[stufe]?.trim() || null : null;
  return { stufe, deine, naechste };
}
