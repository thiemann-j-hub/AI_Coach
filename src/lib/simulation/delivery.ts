/**
 * Delivery-Panel (Welle A2, SYNTHESIA-ROLEPLAY-VERGLEICH §7): misst WIE
 * kommuniziert wurde — deterministisch aus den Turns, ohne LLM-Call.
 *
 * Sparring-Beschlüsse 18.08. (eingefroren):
 * - Kennzahlen fließen NICHT in den Gesamtscore ein — Hinweise, keine Noten.
 * - Weichmacher werden als RATE pro 100 Wörter gegen Bänder bewertet, nie als
 *   Einzelwort-Fehler; die gezählten Treffer sind mit Kontext einsehbar
 *   (Beleg-Philosophie: der Nutzer sieht selbst, ob ein Treffer unfair war).
 * - »Repair rate« bewusst gestrichen: im Text-Chat wird vor dem Absenden
 *   editiert — die Kennzahl wäre dort Pseudo-Messung.
 * - Bänder aus Bestandstranskripten kalibrierbar (scripts/calibrate-delivery),
 *   Startwerte konservativ gewählt.
 *
 * Pure + isomorph: läuft client- wie serverseitig, Alt-Läufe bekommen das
 * Panel beim Lesen (dieselbe Idee wie computeDebrief).
 */

export interface DeliveryTurnLike {
  role: string;
  text: string;
}

export interface SoftenerMatch {
  /** Getroffene Wendung (wie im Lexikon). */
  phrase: string;
  /** Fundstelle mit etwas Umgebung — macht Fehltreffer selbst erkennbar. */
  context: string;
}

export interface DeliveryReport {
  userWords: number;
  personaWords: number;
  sentenceCount: number;
  /** Redeanteil des Übenden in % (Wortanteil) — null bei zu wenig Material. */
  talkRatioPct: number | null;
  talkBand: 'listening' | 'balanced' | 'talking' | null;
  /** Mittlere (Median-)Satzlänge in Wörtern. */
  medianSentenceWords: number | null;
  sentenceBand: 'short' | 'normal' | 'long' | null;
  /** Anteil der Sätze, deren Anfang (erste zwei Wörter) mehrfach vorkommt. */
  openerRepetitionPct: number | null;
  openerBand: 'varied' | 'some' | 'repetitive' | null;
  /** Weichmacher/Füllwörter je 100 Wörter. */
  softenersPer100: number | null;
  softenerBand: 'normal' | 'elevated' | 'many' | null;
  softenerMatches: SoftenerMatch[];
}

/** Unter diesen Schwellen ist jede Aussage unseriös → Bänder bleiben null. */
export const MIN_WORDS_FOR_DELIVERY = 30;
export const MIN_SENTENCES_FOR_DELIVERY = 3;

/**
 * Bänder — Startkalibrierung (konservativ; Feinjustage über
 * scripts/calibrate-delivery.ts gegen Bestandstranskripte).
 */
export const DELIVERY_BANDS = {
  talk: { listeningMax: 35, balancedMax: 65 },
  sentence: { shortMax: 7, normalMax: 18 },
  opener: { variedMax: 25, someMax: 50 },
  softener: { normalMax: 2, elevatedMax: 4 },
} as const;

/**
 * Weichmacher-/Füllwort-Lexika je Sprache. Bewusst kompakt: nur Wendungen,
 * die in gesprochener/diktierter Sprache überwiegend abschwächend wirken.
 * Mehrwort-Wendungen zuerst (längster Treffer gewinnt, keine Doppelzählung).
 */
const SOFTENERS: Record<string, string[]> = {
  de: [
    'ich glaube schon',
    'ich denke mal',
    'ich würde sagen',
    'ein bisschen',
    'ein wenig',
    'sozusagen',
    'gewissermaßen',
    'irgendwie',
    'eigentlich',
    'vielleicht',
    'eventuell',
    'möglicherweise',
    'quasi',
    'halt',
    'äh',
    'ähm',
  ],
  en: [
    'i guess',
    'i suppose',
    'kind of',
    'sort of',
    'a little bit',
    'basically',
    'actually',
    'maybe',
    'perhaps',
    'possibly',
    'just',
    'um',
    'uh',
  ],
  es: ['un poco', 'quizás', 'quizá', 'tal vez', 'en realidad', 'como que', 'este'],
  fr: ['un peu', 'peut-être', 'en fait', 'quand même', 'genre', 'euh'],
};

/** Häufige Abkürzungen, die kein Satzende markieren (vor dem Split maskiert). */
const ABBREVIATIONS = [
  'z. B.', 'z.B.', 'u. a.', 'u.a.', 'd. h.', 'd.h.', 'bzw.', 'ca.', 'evtl.',
  'ggf.', 'inkl.', 'Nr.', 'Dr.', 'Hr.', 'Fr.', 'usw.', 'etc.', 'vs.',
  'Mr.', 'Mrs.', 'Ms.', 'e.g.', 'i.e.',
];

function words(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
}

/** Punkt-Platzhalter beim Abkürzungsschutz (kommt in normalem Text nicht vor). */
const DOT_MASK = '\u0001';

/** Satz-Split mit Abkürzungsschutz (exportiert für Tests). */
export function splitSentences(text: string): string[] {
  let masked = text;
  for (const a of ABBREVIATIONS) {
    masked = masked.split(a).join(a.split('.').join(DOT_MASK));
  }
  return masked
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.split(DOT_MASK).join('.').trim())
    .filter((s) => words(s).length > 0);
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function findSofteners(text: string, lexicon: string[]): SoftenerMatch[] {
  const matches: SoftenerMatch[] = [];
  const lower = text.toLowerCase();
  // Längste Wendungen zuerst — »ich glaube schon« schluckt »glaube«.
  const sorted = [...lexicon].sort((a, b) => b.length - a.length);
  const taken: Array<[number, number]> = [];
  for (const phrase of sorted) {
    let from = 0;
    for (;;) {
      const idx = lower.indexOf(phrase, from);
      if (idx < 0) break;
      from = idx + phrase.length;
      // Wortgrenzen: davor/danach kein Buchstabe.
      const before = idx === 0 ? '' : lower[idx - 1];
      const after = lower[idx + phrase.length] ?? '';
      if (/[\p{L}]/u.test(before) || /[\p{L}]/u.test(after)) continue;
      // Überlappung mit bereits gezählter (längerer) Wendung? Dann überspringen.
      if (taken.some(([s, e]) => idx < e && idx + phrase.length > s)) continue;
      taken.push([idx, idx + phrase.length]);
      const ctxStart = Math.max(0, idx - 30);
      const ctxEnd = Math.min(text.length, idx + phrase.length + 30);
      matches.push({
        phrase,
        context:
          (ctxStart > 0 ? '…' : '') +
          text.slice(ctxStart, ctxEnd).trim() +
          (ctxEnd < text.length ? '…' : ''),
      });
    }
  }
  return matches;
}

export function computeDelivery(
  turns: DeliveryTurnLike[],
  locale?: string | null
): DeliveryReport {
  const userTexts = turns.filter((t) => t.role === 'user').map((t) => t.text ?? '');
  const personaTexts = turns.filter((t) => t.role === 'persona').map((t) => t.text ?? '');

  const userWordList = userTexts.flatMap(words);
  const userWords = userWordList.length;
  const personaWords = personaTexts.flatMap(words).length;

  const sentences = userTexts.flatMap(splitSentences);
  const sentenceCount = sentences.length;

  const enough = userWords >= MIN_WORDS_FOR_DELIVERY && sentenceCount >= MIN_SENTENCES_FOR_DELIVERY;

  // Redeanteil
  const total = userWords + personaWords;
  const talkRatioPct = enough && total > 0 ? Math.round((userWords / total) * 100) : null;
  const talkBand =
    talkRatioPct == null
      ? null
      : talkRatioPct <= DELIVERY_BANDS.talk.listeningMax
        ? 'listening'
        : talkRatioPct <= DELIVERY_BANDS.talk.balancedMax
          ? 'balanced'
          : 'talking';

  // Satzlänge
  const medianSentenceWords = enough
    ? Math.round(median(sentences.map((s) => words(s).length)) * 10) / 10
    : null;
  const sentenceBand =
    medianSentenceWords == null
      ? null
      : medianSentenceWords <= DELIVERY_BANDS.sentence.shortMax
        ? 'short'
        : medianSentenceWords <= DELIVERY_BANDS.sentence.normalMax
          ? 'normal'
          : 'long';

  // Satzanfänge: erste zwei Wörter, kleingeschrieben.
  let openerRepetitionPct: number | null = null;
  if (enough) {
    const openers = sentences.map((s) =>
      words(s)
        .slice(0, 2)
        .join(' ')
        .toLowerCase()
        .replace(/[^\p{L}\p{N} ]/gu, '')
    );
    const counts = new Map<string, number>();
    for (const o of openers) counts.set(o, (counts.get(o) ?? 0) + 1);
    const repeated = openers.filter((o) => (counts.get(o) ?? 0) > 1).length;
    openerRepetitionPct = Math.round((repeated / openers.length) * 100);
  }
  const openerBand =
    openerRepetitionPct == null
      ? null
      : openerRepetitionPct <= DELIVERY_BANDS.opener.variedMax
        ? 'varied'
        : openerRepetitionPct <= DELIVERY_BANDS.opener.someMax
          ? 'some'
          : 'repetitive';

  // Weichmacher
  const lexicon = SOFTENERS[(locale ?? 'de').slice(0, 2)] ?? SOFTENERS.de;
  const softenerMatches = enough
    ? userTexts.flatMap((t) => findSofteners(t, lexicon))
    : [];
  const softenersPer100 =
    enough && userWords > 0
      ? Math.round((softenerMatches.length / userWords) * 100 * 10) / 10
      : null;
  const softenerBand =
    softenersPer100 == null
      ? null
      : softenersPer100 <= DELIVERY_BANDS.softener.normalMax
        ? 'normal'
        : softenersPer100 <= DELIVERY_BANDS.softener.elevatedMax
          ? 'elevated'
          : 'many';

  return {
    userWords,
    personaWords,
    sentenceCount,
    talkRatioPct,
    talkBand,
    medianSentenceWords,
    sentenceBand,
    openerRepetitionPct,
    openerBand,
    softenersPer100,
    softenerBand,
    softenerMatches,
  };
}
