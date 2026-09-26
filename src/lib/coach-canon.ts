/**
 * Beobachter-Kanon (V2, Owner-GO 25.09.2026 nach Gemini-Sparring).
 *
 * Destillat aus 30 AC-Ergebnisberichten (1.355 Übungsaussagen, offline
 * ausgewertet — KEIN Wortlaut aus dem Korpus, nur die Regeln):
 * - Stärken: Verb zuerst, Wirkung, Beleg („Zeigt/Vermittelt/Wirkt/Stellt …“).
 * - Entwicklungsfelder: Modalverb + Wirkung + Beispiel („Könnte/Sollte/Darf …“),
 *   in 15–23 % mit wörtlichem Beleg.
 * Harte Übersetzungsregel (Gemini): Beobachter-3.-Person → Du-Botschaft
 *   MOMENT → WIRKUNG → WIRKSAMERER WEG. Verhalten, nie die Person.
 *   Der Coach ist Begleiter:in, nicht Richter:in.
 *
 * Reines Modul (kein I/O): wird in die Prompts eingesetzt (simulation-feedback,
 * simulation-coach, generate-tailored-feedback) und vom Judge (scripts/quality)
 * als Dimension `observer_canon` gemessen.
 */

export const OBSERVER_CANON_DE = `BEOBACHTER-KANON (verbindlich für jede Formulierung)
- Du bist Begleiter:in, nicht Richter:in. Beschreibe VERHALTEN und seine WIRKUNG — nie die Person. „Du bist …“ ist tabu; richtig ist „Du hast … gesagt — das führte dazu, dass …“.
- Jede Stärke: Verb zuerst + Wirkung + Beleg. Muster: „Du stellst offene Fragen (»…«) — dadurch öffnet sich dein Gegenüber.“
- Jedes Entwicklungsfeld ist eine Du-Botschaft in drei Schritten:
  MOMENT („In dem Moment, als …, hast du … gesagt“) → WIRKUNG („Das führte dazu, dass …“) → WIRKSAMERER WEG („Ein wirksamerer Weg wäre … zum Beispiel: »…«“).
  Modalverben (du könntest / solltest / darfst) statt Befehle. Abschwächungen („mitunter“, „bisweilen“) nur, wenn die Wirkung wirklich schwankte.
- Konkret statt Etikett: kein „besser kommunizieren“, keine Generalisierungen („immer“, „nie“, „total“), keine Persönlichkeitsdiagnosen, keine Noten-Sprache.
- Jeder Punkt braucht einen Beleg aus DIESEM Gespräch (kurzes Zitat oder benannter Moment). Ohne Beleg kein Punkt.`;

export const OBSERVER_CANON_EN = `OBSERVER CANON (binding for every sentence of feedback)
- You are a companion, not a judge. Describe BEHAVIOUR and its EFFECT — never the person. "You are …" is off-limits; "You said … — which led to …" is right.
- Every strength: verb first + effect + evidence. Pattern: "You ask open questions ("…") — that is what makes your counterpart open up."
- Every development point is a you-message in three steps:
  MOMENT ("At the moment when …, you said …") → EFFECT ("That led to …") → MORE EFFECTIVE PATH ("A more effective path would be … for example: "…"").
  Modal verbs (you could / should / may) instead of orders. Softeners ("at times", "occasionally") only when the effect really varied.
- Concrete instead of labels: no "communicate better", no generalisations ("always", "never", "totally"), no personality diagnoses, no grading language.
- Every point needs evidence from THIS conversation (a short quote or a named moment). No evidence, no point.`;

/** Kanon in der Sprache der Prompt-Ausgabe (Prompt-Text ist deutsch oder englisch). */
export function observerCanon(lang: 'de' | 'en'): string {
  return lang === 'en' ? OBSERVER_CANON_EN : OBSERVER_CANON_DE;
}

/**
 * Deterministischer Kanon-Check: Personen-Urteile („Du bist zu …“, „you are too …“)
 * und Generalisierungs-Verstärker („total“, „wahnsinnig“, „immer“, „nie“) im
 * Feedback-Text. Liefert die gefundenen Stellen (leer = sauber). Kein Gate —
 * eine Messgröße für Judge/Regression, damit Verstöße zählbar sind.
 */
const PERSON_JUDGMENT_PATTERNS: RegExp[] = [
  // „du bist (zu|sehr|ein/eine|eher|einfach|nicht) …“ — Person statt Verhalten
  /\bdu bist (?:zu|sehr|ein|eine|eher|einfach|ziemlich|nicht|kein|keine|total|wenig)\b[^.!?\n]{0,60}/gi,
  /\byou are (?:too|very|a|an|rather|simply|quite|not|no|totally)\b[^.!?\n]{0,60}/gi,
  // Generalisierungen / Verstärker
  /\b(?:total|wahnsinnig|komplett|völlig)\s+(?:un)?[a-zäöüß]{4,}/gi,
  /\b(?:du|sie)\s+(?:machst|machen|bist|sind|sagst|sagen|redest|reden|hörst|hören)\s+(?:immer|nie|niemals|ständig)\b/gi,
  /\byou (?:always|never|constantly)\b/gi,
];

export function findPersonJudgments(text: string): string[] {
  const t = String(text ?? '');
  const hits: string[] = [];
  for (const re of PERSON_JUDGMENT_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      hits.push(m[0].trim());
      if (hits.length >= 20) return hits;
    }
  }
  return hits;
}
