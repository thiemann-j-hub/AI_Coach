import type { SimulationScenario } from "./types";

/**
 * Spielbuch (Owner-GO 28.10.2026, N4-231 Talker-Reasoner-Muster):
 * Im Gespräch spricht ein schnelles Modell (Gemini Live bzw. Flash). Damit wissenslastige Rollen
 * trotzdem mit Substanz argumentieren, schreibt ein starkes Modell VOR dem Gespräch ein vertrauliches
 * Spielbuch: Sachkern, erwartete Züge des Gegenübers mit passender Antwort, Formeln für Wissenslücken,
 * Öffnungsverlauf. Das Spielbuch wird je Szenario einmal erzeugt und wandert in die Rollenanweisung.
 *
 * Dieses Modul ist rein (keine Server-Abhängigkeiten): Anweisung an das starke Modell + Einbau-Block.
 */

/** Erhöhen, wenn sich die Anweisung so ändert, dass alte Spielbücher neu entstehen sollen. */
export const SPIELBUCH_VERSION = 1;

/** Obergrenze für den eingebauten Text (Schutz der Rollenanweisung vor einem ausufernden Spielbuch). */
export const SPIELBUCH_MAX_CHARS = 12_000;

export function buildSpielbuchSystem(locale: SimulationScenario["locale"]): string {
  return locale === "en"
    ? `You are a dramaturg for conversation simulations in leadership training. You prepare a confidential playbook for an AI character so that a fast conversational model can play the role with substance and consistency. You write for the character, never for the learner. Plain prose and short bullet lines, no markdown headings other than the five numbered section titles given, no tables.`
    : `Du bist Dramaturg:in für Gesprächssimulationen im Führungskräftetraining. Du bereitest ein vertrauliches Spielbuch für eine KI-Rolle vor, damit ein schnelles Gesprächsmodell die Rolle mit Substanz und Konsequenz spielen kann. Du schreibst für die Rolle, nie für die lernende Person. Klare Prosa und kurze Spiegelstriche, keine Markdown-Überschriften außer den fünf vorgegebenen nummerierten Abschnittstiteln, keine Tabellen.`;
}

export function buildSpielbuchPrompt(s: SimulationScenario): string {
  const d = s.personaDna;
  const dna = JSON.stringify(
    {
      name: d.name,
      role: d.role,
      background: d.background,
      selfImage: d.selfImage,
      publicBehavior: d.publicBehavior,
      hiddenDrivers: d.hiddenDrivers,
      positions: d.positions,
      interests: d.interests,
      objectionPlaybook: d.objectionPlaybook,
      concessionConditions: d.concessionConditions,
      escalationTriggers: d.escalationTriggers,
      personality: d.personality,
      knowledgeBounds: d.knowledgeBounds,
      facts: d.facts,
      openingLine: d.openingLine,
    },
    null,
    1
  );
  const goals = s.candidateBriefing.goals?.map((g) => `- ${g}`).join("\n") ?? "";
  if (s.locale === "en") {
    return `SCENARIO: "${s.title}" (${s.conversationType}). The learner plays the counterpart of ${d.name}, ${d.role}, at NorthBay Foods.

WHAT THE LEARNER IS TRYING TO ACHIEVE (so you can anticipate their moves):
${goals}

THE CHARACTER (confidential briefing, JSON):
${dna}

Write the playbook for ${d.name} in English with exactly these five sections, in this order, titled exactly like this:

1. CORE SUBSTANCE
8–12 points: what the character knows and how they use it in argument. Turn each fact into a line of argument the character can actually deliver. You may add real-world expertise typical for this role (how such a person argues, which objections and counter-questions they raise). Do NOT invent new hard numbers, names or dates about NorthBay; where the facts are silent, the character stays vague or deflects.

2. EXPECTED MOVES OF THE COUNTERPART
12–15 moves the learner is likely to make (accusations, questions, offers, pressure, empathy, silence). For each move: the character's stance in one line, then an example reply in spoken language, 1–3 sentences, in the character's voice. Vary the replies; never repeat an objection verbatim.

3. QUESTIONS OUTSIDE THE CHARACTER'S KNOWLEDGE
4–6 ready phrasings, in character, for things the character does not know (see knowledgeBounds). They sound natural, never like a disclaimer.

4. OPENING-UP TRAJECTORY
Stages 0–3. For each stage: what the learner must have done (see concessionConditions), what the character then admits, offers or asks, and how tone and sentence length change. Also: what throws the character back a stage (see escalationTriggers).

5. NEVER
3–5 things the character must never do (e.g. giving in without the conditions, lecturing, breaking character, reading out notes).

Length: 900–1,400 words in total. Confidential: the learner never sees this text.`;
  }
  return `SZENARIO: „${s.title}“ (${s.conversationType}). Die lernende Person spielt das Gegenüber von ${d.name}, ${d.role}, bei NorthBay Foods.

WAS DIE LERNENDE PERSON ERREICHEN WILL (damit du ihre Züge vorhersehen kannst):
${goals}

DIE ROLLE (vertrauliches Briefing, JSON):
${dna}

Schreibe das Spielbuch für ${d.name} auf Deutsch mit genau diesen fünf Abschnitten, in dieser Reihenfolge, exakt so betitelt:

1. SACHKERN
8–12 Punkte: Was die Rolle weiß und wie sie es im Gespräch einsetzt. Mach aus jedem Fakt eine Argumentationslinie, die die Rolle wirklich sagen kann. Fachwissen aus der echten Welt, das für diese Rolle typisch ist (wie so jemand argumentiert, welche Einwände und Gegenfragen kommen), darfst du einbringen. Erfinde KEINE neuen harten Zahlen, Namen oder Daten über NorthBay; wo die Fakten schweigen, bleibt die Rolle vage oder weicht aus.

2. ERWARTETE ZÜGE DES GEGENÜBERS
12–15 Züge, die die lernende Person wahrscheinlich macht (Vorwürfe, Fragen, Angebote, Druck, Empathie, Schweigen). Je Zug: Haltung der Rolle in einer Zeile, dann eine Beispielantwort in gesprochener Sprache, 1–3 Sätze, in der Stimme der Rolle. Variiere die Antworten; kein Einwand wird wortgleich wiederholt.

3. FRAGEN AUSSERHALB DES WISSENS
4–6 fertige Formulierungen in der Rolle für Dinge, die die Rolle nicht weiß (siehe knowledgeBounds). Sie klingen natürlich, nie wie ein Hinweis.

4. ÖFFNUNGSVERLAUF
Stufen 0–3. Je Stufe: Was die lernende Person dafür getan haben muss (siehe concessionConditions), was die Rolle dann zugibt, anbietet oder fragt, und wie sich Ton und Satzlänge verändern. Außerdem: Was die Rolle eine Stufe zurückwirft (siehe escalationTriggers).

5. NIEMALS
3–5 Dinge, die die Rolle nie tut (z. B. ohne Bedingungen einlenken, dozieren, aus der Rolle fallen, Notizen vorlesen).

Umfang: 900–1.400 Wörter insgesamt. Vertraulich: Die lernende Person sieht diesen Text nie.`;
}

/** Markdown-Reste (Fett, Überschriften-Rauten) entfernen — das Gesprächsmodell soll Prosa lesen, nicht Auszeichnung. */
export function spielbuchBereinigen(text: string): string {
  return text.replace(/\*\*/g, "").replace(/^#+\s*/gm, "").trim();
}

/** Block für die Rollenanweisung (nach den FAKTEN, vor den VERHALTENSREGELN). */
export function spielbuchBlock(text: string, locale: SimulationScenario["locale"]): string {
  const sauber = spielbuchBereinigen(text);
  const body = sauber.length > SPIELBUCH_MAX_CHARS ? sauber.slice(0, SPIELBUCH_MAX_CHARS) : sauber;
  return locale === "en"
    ? `\n\n=== PLAYBOOK (CONFIDENTIAL — prepared for you) ===\nUse it as your memory: pick what fits the moment, do not quote it verbatim, do not read it out, and invent nothing beyond it. The FACTS above always win over the playbook.\n${body}\n=== END OF PLAYBOOK ===`
    : `\n\n=== SPIELBUCH (VERTRAULICH — für dich vorbereitet) ===\nNutze es als Gedächtnis: Wähle, was zum Moment passt, zitiere es nicht wörtlich, lies es nicht vor und erfinde nichts darüber hinaus. Die FAKTEN oben gehen dem Spielbuch immer vor.\n${body}\n=== ENDE SPIELBUCH ===`;
}

/**
 * Grober Plausibilitätscheck: mindestens vier der fünf Abschnitte erkennbar (Nummer + Stichwort, Opus
 * formuliert Titel gelegentlich leicht um), nicht leer, nicht ausufernd.
 */
export function spielbuchPlausibel(text: string, locale: SimulationScenario["locale"]): boolean {
  if (!text || text.length < 1500 || text.length > SPIELBUCH_MAX_CHARS * 2) return false;
  const marks: ReadonlyArray<[string, RegExp]> =
    locale === "en"
      ? [["1", /CORE|SUBSTANCE/], ["2", /MOVES|COUNTERPART/], ["3", /OUTSIDE|KNOWLEDGE/], ["4", /OPENING|TRAJECTORY/], ["5", /NEVER/]]
      : [["1", /SACHKERN/], ["2", /ZÜGE|GEGENÜBER/], ["3", /WISSEN/], ["4", /ÖFFNUNG/], ["5", /NIEMALS|NIE /]];
  const upper = text.toUpperCase();
  const treffer = marks.filter(([n, re]) => new RegExp(`(^|\n)[#* ]*${n}[.)]\s*[^\n]*`, "m").test(upper) && re.test(upper)).length;
  return treffer >= 4;
}
