/**
 * Paket 3, U17 und S12 (12.11.2026): Zitat der Auswertung → Stelle im Gespräch.
 *
 * Anlass: Die Auswertung nennt wörtliche Belege, das Gespräch selbst stand aber nicht auf der Seite. Jetzt steht es
 * im Reiter „Gespräch“, und ein Klick auf ein Zitat rollt zur Stelle. Der Richter schreibt Zitate mit Sprecher davor
 * („Teilnehmer:in: …“ oder der Name der Rolle), mit wechselnden Anführungszeichen und manchmal mit Auslassung („…“).
 * Verglichen wird deshalb tolerant bei Leerraum, Anführungszeichen, Groß- und Kleinschreibung und Satzzeichen am Rand.
 * Kein Treffer heißt: das Zitat bleibt ohne Sprung. Reine Funktionen, getestet in zitat-stelle.test.ts.
 */

export interface ZugLike {
  role: string;
  text: string;
}

export interface ZitatStelle {
  /** Index des Zugs im Gespräch. */
  turn: number;
  /** Zeichenbereich im Originaltext des Zugs (Ende ausschließlich). */
  start: number;
  end: number;
}

const ANFUEHRUNG = new Set(['"', '„', '“', '”', '«', '»', '‚', '‘', '’', "'", '‹', '›', '`', '´']);
const STRICHE = new Set(['–', '—', '‑', '‐', '−']);
/** Kürzere Bruchstücke eines Zitats mit Auslassung sagen nichts über die Stelle. */
const MIN_BRUCHSTUECK = 8;

/**
 * Vergleichsform eines Textes: klein geschrieben, ohne Anführungszeichen, Leerraum als ein Leerzeichen,
 * Gedankenstriche als „-“, „…“ als drei Punkte. `map[i]` ist die Stelle des Zeichens im Original.
 */
export function vergleichsform(text: string): { norm: string; map: number[] } {
  let norm = '';
  const map: number[] = [];
  const src = String(text ?? '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ANFUEHRUNG.has(ch)) continue;
    let out: string;
    if (/\s/.test(ch)) {
      if (!norm || norm.endsWith(' ')) continue;
      out = ' ';
    } else if (STRICHE.has(ch)) out = '-';
    else if (ch === '…') out = '...';
    else out = ch.toLowerCase();
    for (let k = 0; k < out.length; k++) {
      norm += out[k];
      map.push(i);
    }
  }
  if (norm.endsWith(' ')) {
    norm = norm.slice(0, -1);
    map.pop();
  }
  return { norm, map };
}

const istWortzeichen = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

/** Sucht `nadel` als ganze Wörter in `heu` (kein Treffer mitten im Wort), ab der Stelle `ab`. */
function findeGanz(heu: string, nadel: string, ab = 0): number {
  if (!nadel) return -1;
  for (let from = ab; ; ) {
    const idx = heu.indexOf(nadel, from);
    if (idx < 0) return -1;
    const vorn = istWortzeichen(nadel[0]) && istWortzeichen(heu[idx - 1]);
    const hinten = istWortzeichen(nadel[nadel.length - 1]) && istWortzeichen(heu[idx + nadel.length]);
    if (!vorn && !hinten) return idx;
    from = idx + 1;
  }
}

/** Trennt den Sprecher vor dem Zitat ab: „Teilnehmer:in: …“, „Alex Morgan: »…«“. */
export function trenneSprecher(zitat: string): { sprecher: string | null; text: string } {
  const m = /^\s*([^\n"„“”«»]{1,40}?)\s*:(?:\s+|(?=["„“«»‚‘']))/.exec(zitat);
  if (!m) return { sprecher: null, text: zitat };
  return { sprecher: m[1].trim(), text: zitat.slice(m[0].length) };
}

function rolleVon(sprecher: string | null, personaName?: string | null): 'user' | 'persona' | null {
  if (!sprecher) return null;
  const s = sprecher.toLowerCase();
  const p = (personaName ?? '').trim().toLowerCase();
  if (p && (s === p || p.split(/\s+/).includes(s) || s.includes(p))) return 'persona';
  if (/^(teilnehmer|participant|übende|lernende|learner|trainee|nutzer|user|du|you|ich)/.test(s)) return 'user';
  return null;
}

interface Nadeln {
  ganz: string[];
  teile: string[];
}

/** Vergleichsformen eines Zitats, die strengste zuerst: ganz, ohne Satzzeichen am Rand, dann die Bruchstücke um „…“. */
function nadeln(text: string): Nadeln {
  const rand = (s: string) => s.replace(/^[\s.,;:!?()[\]-]+/, '').replace(/[\s.,;:!?()[\]-]+$/, '');
  const voll = vergleichsform(text).norm;
  const ganz = [...new Set([voll, rand(voll)])].filter((s) => s.length >= 2);
  const teile = voll
    .split(/\s*[[(]?\.{3,}[\])]?\s*/)
    .map(rand)
    .filter((s) => s.length >= MIN_BRUCHSTUECK);
  return { ganz, teile: teile.length > 1 || (teile.length === 1 && teile[0] !== rand(voll)) ? teile : [] };
}

function sucheImZug(zugText: string, n: Nadeln): { start: number; end: number } | null {
  const { norm, map } = vergleichsform(zugText);
  const bereich = (idx: number, len: number) => ({ start: map[idx], end: map[idx + len - 1] + 1 });
  for (const g of n.ganz) {
    const idx = findeGanz(norm, g);
    if (idx >= 0) return bereich(idx, g.length);
  }
  if (!n.teile.length) return null;
  // Zitat mit Auslassung: alle Bruchstücke in dieser Reihenfolge → vom ersten bis zum letzten markieren.
  let ab = 0;
  let erster = -1;
  let ende = -1;
  let alle = true;
  for (const t of n.teile) {
    const idx = findeGanz(norm, t, ab);
    if (idx < 0) {
      alle = false;
      break;
    }
    if (erster < 0) erster = idx;
    ende = idx + t.length;
    ab = ende;
  }
  if (alle && erster >= 0) return bereich(erster, ende - erster);
  // Sonst zählt nur das längste Bruchstück.
  const laengstes = [...n.teile].sort((a, b) => b.length - a.length)[0];
  const idx = findeGanz(norm, laengstes);
  return idx >= 0 ? bereich(idx, laengstes.length) : null;
}

/**
 * Findet den Zug, in dem das Zitat wörtlich steht. Züge des genannten Sprechers gehen vor;
 * `bevorzugt` gilt, wenn das Zitat keinen Sprecher nennt (im „Größten Hebel“ spricht die lernende Person).
 */
export function findeZitatStelle(
  zitat: string,
  turns: ReadonlyArray<ZugLike> | null | undefined,
  opts: { personaName?: string | null; bevorzugt?: 'user' | 'persona' } = {}
): ZitatStelle | null {
  if (!turns?.length || typeof zitat !== 'string' || !zitat.trim()) return null;
  const { sprecher, text } = trenneSprecher(zitat);
  const rolle = rolleVon(sprecher, opts.personaName) ?? opts.bevorzugt ?? null;
  // Erst das ganze Zitat (ein Doppelpunkt kann auch zum Satz gehören), dann ohne Sprecher.
  const formen = sprecher ? [nadeln(zitat), nadeln(text)] : [nadeln(zitat)];
  const reihen = rolle ? [(t: ZugLike) => t.role === rolle, (t: ZugLike) => t.role !== rolle] : [() => true];
  for (const passt of reihen) {
    for (const n of formen) {
      for (let i = 0; i < turns.length; i++) {
        if (!passt(turns[i])) continue;
        const b = sucheImZug(turns[i].text ?? '', n);
        if (b) return { turn: i, ...b };
      }
    }
  }
  return null;
}

/** Wörtliche Rede in einem Fließtext („…“, “…”, "…", »…«): Bereich samt Anführungszeichen und der Inhalt. */
export function zitateImText(text: string): Array<{ start: number; end: number; text: string }> {
  const out: Array<{ start: number; end: number; text: string }> = [];
  const re = /[„“"»«]([^„“”"»«\n]{6,}?)[“”"«»]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text ?? '')))) out.push({ start: m.index, end: m.index + m[0].length, text: m[1] });
  return out;
}

/**
 * Fließtext (z. B. „Größter Hebel“) in Stücke: wörtliche Rede, die im Gespräch steht, trägt den Zug als Sprungziel.
 * Ein Beispielsatz für das nächste Mal steht nicht im Gespräch und bleibt gewöhnlicher Text.
 */
export function textMitSpruengen(
  text: string,
  turns: ReadonlyArray<ZugLike> | null | undefined,
  personaName?: string | null
): Array<{ text: string; turn: number | null }> {
  const src = String(text ?? '');
  const out: Array<{ text: string; turn: number | null }> = [];
  let pos = 0;
  for (const z of zitateImText(src)) {
    const s = findeZitatStelle(z.text, turns, { personaName, bevorzugt: 'user' });
    if (!s) continue;
    if (z.start > pos) out.push({ text: src.slice(pos, z.start), turn: null });
    out.push({ text: src.slice(z.start, z.end), turn: s.turn });
    pos = z.end;
  }
  if (pos < src.length) out.push({ text: src.slice(pos), turn: null });
  return out;
}

export type MarkenArt = 'beleg' | 'sachlich';

export interface ZitatEingabe {
  zitat: string;
  art: MarkenArt;
  /** Zeile unter dem Zug: Name der Fähigkeit (Beleg) oder der Grund (sachlich nicht gedeckt). */
  hinweis: string;
}

export interface ZugMarken {
  bereiche: Array<{ start: number; end: number; art: MarkenArt }>;
  hinweise: Array<{ art: MarkenArt; text: string }>;
}

/** Je Zug die markierten Bereiche und die Zeilen darunter. Zitate ohne Treffer fallen still weg. */
export function markiereZuege(
  turns: ReadonlyArray<ZugLike>,
  zitate: ReadonlyArray<ZitatEingabe>,
  personaName?: string | null
): ZugMarken[] {
  const out: ZugMarken[] = turns.map(() => ({ bereiche: [], hinweise: [] }));
  for (const z of zitate) {
    const s = findeZitatStelle(z.zitat, turns, { personaName, bevorzugt: 'user' });
    if (!s) continue;
    const zug = out[s.turn];
    zug.bereiche.push({ start: s.start, end: s.end, art: z.art });
    const text = z.hinweis.trim();
    if (text && !zug.hinweise.some((h) => h.art === z.art && h.text === text)) zug.hinweise.push({ art: z.art, text });
  }
  return out;
}

export interface TextStueck {
  text: string;
  art: MarkenArt | null;
}

/** Zerlegt den Text eines Zugs in markierte und unmarkierte Stücke; bei Überlappung gewinnt „sachlich“. */
export function textStuecke(text: string, bereiche: ZugMarken['bereiche']): TextStueck[] {
  const src = String(text ?? '');
  if (!bereiche.length) return src ? [{ text: src, art: null }] : [];
  const grenzen = [...new Set([0, src.length, ...bereiche.flatMap((b) => [b.start, b.end])])]
    .filter((g) => g >= 0 && g <= src.length)
    .sort((a, b) => a - b);
  const out: TextStueck[] = [];
  for (let i = 0; i < grenzen.length - 1; i++) {
    const [a, e] = [grenzen[i], grenzen[i + 1]];
    const treffer = bereiche.filter((b) => b.start <= a && b.end >= e);
    const art: MarkenArt | null = treffer.some((b) => b.art === 'sachlich') ? 'sachlich' : treffer.length ? 'beleg' : null;
    const letztes = out[out.length - 1];
    if (letztes && letztes.art === art) letztes.text += src.slice(a, e);
    else out.push({ text: src.slice(a, e), art });
  }
  return out;
}
