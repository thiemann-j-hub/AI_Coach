import type { SimRubricCompetency } from "./types";

/**
 * Fähigkeiten-Bibliothek (Welle 1, Owner-GO 30.10.2026, Register N4-240):
 * Jede Fähigkeit hat eine Definition und VIER Stufen mit beobachtbarem Verhalten. Die Stufen sind die
 * Bewertungs-Rubrik des Richters (Stufe 1–4 = unsere Skala) und zugleich der Text, den Lernende vor dem
 * Gespräch sehen („Darauf achte ich“). Eigene Worte, eigene Beispiele — kein Wortlaut von anderen.
 *
 * Client-sicher (keine Server-Abhängigkeiten): die Briefing-Seite liest Titel und Definition über den Key.
 */

export type Zweisprachig = { de: string; en: string };

export type FaehigkeitGruppe =
  | "fuehrung" // Mitarbeitergespräch: Kritik, Leistung
  | "entwicklung" // Mitarbeitergespräch: Anerkennung, Entwicklung
  | "kollegen" // Kollegengespräch, Verhandlung auf Augenhöhe
  | "kaltakquise"
  | "bedarf" // Bedarfsgespräch
  | "beschwerde" // Kundenbeschwerde
  | "medien"; // Interview, Pressegespräch

export interface Faehigkeit {
  /** Schlüssel = Anker-Key im Szenario (max. 20 Zeichen, nur Kleinbuchstaben und Bindestrich). */
  id: string;
  gruppe: FaehigkeitGruppe;
  titel: Zweisprachig;
  /** Ein Satz: Was die Fähigkeit im Gespräch bedeutet. */
  definition: Zweisprachig;
  /** Stufen 1–4: beobachtbares Verhalten je Stufe. */
  stufen: [Zweisprachig, Zweisprachig, Zweisprachig, Zweisprachig];
}

/** Stufennamen (entsprechen den Erwartungslabels below / approaching / meets / exceeds). */
export const STUFEN_NAMEN: [Zweisprachig, Zweisprachig, Zweisprachig, Zweisprachig] = [
  { de: "Nicht gezeigt", en: "Not shown" },
  { de: "Ansätze", en: "Early signs" },
  { de: "Erfüllt", en: "Meets the bar" },
  { de: "Übertroffen", en: "Exceeds the bar" },
];

const f = (
  id: string,
  gruppe: FaehigkeitGruppe,
  titel: Zweisprachig,
  definition: Zweisprachig,
  stufen: [Zweisprachig, Zweisprachig, Zweisprachig, Zweisprachig]
): Faehigkeit => ({ id, gruppe, titel, definition, stufen });

export const FAEHIGKEITEN: ReadonlyArray<Faehigkeit> = [
  // ── Mitarbeitergespräch: Kritik und Leistung ────────────────────────────────────────────────
  f(
    "rahmen",
    "fuehrung",
    { de: "Rahmen setzen und Sicherheit geben", en: "Set the frame and make it safe" },
    {
      de: "Sagt zu Beginn, worum es geht und mit welcher Absicht, und trennt die Sache von der Person.",
      en: "Says up front what the conversation is about and why, and keeps the issue separate from the person.",
    },
    [
      {
        de: "Steigt mit Vorwurf, Urteil oder ohne erkennbaren Anlass ein; das Gegenüber weiß nicht, worum es geht, und geht in Abwehr.",
        en: "Opens with an accusation, a verdict or no stated reason; the other person does not know what this is about and goes defensive.",
      },
      {
        de: "Nennt das Thema irgendwann, aber ohne Absicht und ohne Zeichen, dass es konstruktiv gemeint ist; höflich, aber ziellos.",
        en: "Names the topic at some point, but without purpose or any sign that the intent is constructive; polite but aimless.",
      },
      {
        de: "Benennt klar Anlass und Absicht („Ich will mit dir über das Angebot sprechen, damit es rausgeht“); das Gegenüber weiß, dass es kein Hinterhalt ist.",
        en: "States reason and intent plainly (“I want to talk about the offer so we get it out the door”); the other person knows it is not an ambush.",
      },
      {
        de: "Rahmt das Gespräch zusätzlich als Interesse am Gegenüber, trennt ausdrücklich Verhalten vom Wert der Person und kehrt bei Spannung zu diesem Rahmen zurück.",
        en: "Also frames the talk as being in the other person's interest, explicitly separates behaviour from their worth, and returns to that frame when tension rises.",
      },
    ]
  ),
  f(
    "konkret",
    "fuehrung",
    { de: "Konkret bleiben", en: "Stay concrete" },
    {
      de: "Benennt beobachtbares Verhalten und seine Wirkung statt Etiketten, und hält das auch unter Widerspruch durch.",
      en: "Names observable behaviour and its impact instead of labels, and holds that line under pushback.",
    },
    [
      {
        de: "Keine konkrete Beobachtung; aus dem Gespräch ließe sich nicht sagen, welches Verhalten gemeint ist.",
        en: "No concrete observation; from the conversation you could not say which behaviour is meant.",
      },
      {
        de: "Nur Etiketten („unzuverlässig“, „schwierig“) ohne Beispiel oder Wirkung; auf Nachfrage wird das Etikett wiederholt.",
        en: "Labels only (“unreliable”, “difficult”) with no example or impact; asked for one, the label is repeated.",
      },
      {
        de: "Mindestens einmal ein konkretes Verhalten mit Wirkung („Das Angebot lag zwei Wochen, der Kunde hat sich beschwert“), so genau, dass das Gegenüber weiß, was gemeint ist.",
        en: "At least once a concrete behaviour with its impact (“the offer sat for two weeks and the customer complained”), precise enough that the other person knows exactly what is meant.",
      },
      {
        de: "Mehrfach Verhalten plus Wirkung, die Sprache bleibt beim Verhalten statt bei der Person, der Bezug zur erwarteten Norm ist klar, und es bleibt konkret, wenn das Gegenüber relativiert oder Belege fordert.",
        en: "Behaviour plus impact more than once, language stays on behaviour rather than the person, the expected standard is clear, and it stays concrete when the other person minimises or demands proof.",
      },
    ]
  ),
  f(
    "ursache",
    "fuehrung",
    { de: "Bis zur Ursache zuhören", en: "Listen through to the cause" },
    {
      de: "Fragt nach der Sicht des Gegenübers, greift Antworten auf und bleibt dran, bis der eigentliche Grund sichtbar ist, bevor Lösungen kommen.",
      en: "Asks for the other person's view, builds on the answers and keeps going until the real cause shows, before any solution.",
    },
    [
      {
        de: "Fragt nie nach der Sicht des Gegenübers; redet oder urteilt in eine Richtung.",
        en: "Never asks for the other person's view; talks or judges in one direction only.",
      },
      {
        de: "Höchstens eine Alibi-Frage, deren Antwort nichts ändert; unterbricht oder geht zur vorgefassten Schlussfolgerung über.",
        en: "At most a token question whose answer changes nothing; interrupts or moves to a pre-set conclusion.",
      },
      {
        de: "Fragt nach der Sicht und geht erkennbar darauf ein (greift auf, antwortet, passt an), bleibt aber an der Oberfläche.",
        en: "Asks for the view and visibly engages with it (references, responds, adjusts), but stays on the surface.",
      },
      {
        de: "Stellt offene Fragen, fragt nach, bis der eigentliche Treiber hinter dem Verhalten sichtbar ist, und hält Lösungen zurück, bis die Ursache klar ist.",
        en: "Asks open questions, follows up until the real driver behind the behaviour surfaces, and holds solutions back until the cause is clear.",
      },
    ]
  ),
  f(
    "ruhe",
    "fuehrung",
    { de: "Ruhig bleiben unter Widerstand", en: "Stay steady under pushback" },
    {
      de: "Bleibt bei Widerspruch, Abwehr oder Angriff gelassen und respektvoll, hält die Kernbotschaft und senkt die Temperatur.",
      en: "Stays calm and respectful under contradiction, defensiveness or attack, holds the core message and lowers the temperature.",
    },
    [
      {
        de: "Wird an irgendeiner Stelle scharf, sarkastisch oder persönlich, droht oder verweigert das Gespräch; ein einziger solcher Moment genügt.",
        en: "At any point turns sharp, sarcastic or personal, threatens or refuses to engage; a single such moment is enough.",
      },
      {
        de: "Bleibt nicht feindselig, verliert aber den Halt: wird fahrig oder defensiv, legt Kritik nach oder gibt die Botschaft auf, um die Spannung loszuwerden.",
        en: "Stays non-hostile but loses footing: gets flustered or defensive, piles on criticism, or drops the message just to end the tension.",
      },
      {
        de: "Bleibt bei Abwehr ruhig und respektvoll, erkennt die Emotion an („Ich weiß, das ist nicht leicht zu hören“) und hält die Kernbotschaft, ohne zu eskalieren oder einzuknicken.",
        en: "Stays calm and respectful when the other person pushes back, acknowledges the emotion (“I know this is not easy to hear”) and holds the core message without escalating or caving.",
      },
      {
        de: "Baut aktiv Sicherheit wieder auf: benennt die Schwierigkeit offen, bleibt warm und fest, bekräftigt Respekt, hält die Botschaft und bringt das Gespräch zurück in den produktiven Modus.",
        en: "Actively rebuilds safety: names the difficulty openly, stays warm and firm, reaffirms respect, holds the message and brings the conversation back to productive ground.",
      },
    ]
  ),
  f(
    "vereinbarung",
    "fuehrung",
    { de: "Nächsten Schritt gemeinsam vereinbaren", en: "Agree the next step together" },
    {
      de: "Schließt mit einem konkreten, terminierten Schritt ab, den das Gegenüber mitgestaltet hat, inklusive Unterstützung und Nachfolgetermin.",
      en: "Closes on a concrete, dated step the other person helped shape, including support and a follow-up point.",
    },
    [
      {
        de: "Kein vereinbarter Schritt: nichts Konkretes benannt, zugeordnet oder terminiert.",
        en: "No agreed step: nothing concrete named, assigned or scheduled.",
      },
      {
        de: "Entweder ein vager Appell („Ich erwarte mehr von dir“) ohne Handlung, oder ein fertiger Plan, der ohne Beteiligung des Gegenübers verkündet wird.",
        en: "Either a vague appeal (“I need more from you”) with no action, or a finished plan announced without the other person's input.",
      },
      {
        de: "Ein konkreter Schritt ist vereinbart, und das Gegenüber hatte echten Anteil daran: Es wurde nach Vorschlägen gefragt oder der Plan wurde auf Einwände hin angepasst.",
        en: "A concrete step is agreed and the other person had a real say: they were asked for suggestions or the plan was adjusted to their objections.",
      },
      {
        de: "Gemeinsam ein konkreter, terminierter Plan; realistisch geprüft, nötige Unterstützung vereinbart, Nachfolgetermin gesetzt, und das Gegenüber kann den Schritt in eigenen Worten wiedergeben.",
        en: "A concrete, time-bound plan built together; checked for realism, support agreed, follow-up set, and the other person can restate the step in their own words.",
      },
    ]
  ),

  // ── Mitarbeitergespräch: Anerkennung und Entwicklung ────────────────────────────────────────
  f(
    "anerkennung",
    "entwicklung",
    { de: "Anerkennung mit Beleg", en: "Recognition with evidence" },
    {
      de: "Würdigt Leistung und Einsatz konkret und glaubwürdig, mit Beispiel, nicht als Floskel oder Vorspann zur Kritik.",
      en: "Acknowledges results and effort concretely and credibly, with an example, not as a formula or a warm-up for criticism.",
    },
    [
      {
        de: "Keine Anerkennung, oder nur als Köder vor der Kritik („Du machst das gut, aber …“).",
        en: "No recognition, or only as bait before the criticism (“you do a good job, but …”).",
      },
      {
        de: "Allgemeines Lob ohne Beispiel („Du machst einen tollen Job“), das beim Gegenüber nicht ankommt.",
        en: "Generic praise without an example (“you're doing a great job”) that does not land.",
      },
      {
        de: "Anerkennung mit konkretem Beleg (was genau, welche Wirkung), getrennt von der Kritik ausgesprochen.",
        en: "Recognition with a concrete example (what exactly, with what effect), stated separately from any criticism.",
      },
      {
        de: "Anerkennung so konkret und glaubwürdig, dass das Gegenüber sie erkennbar annimmt; sie trägt das Gespräch als Fundament, nicht als Pflichtteil.",
        en: "Recognition so concrete and credible that the other person visibly accepts it; it carries the conversation as a foundation, not a box ticked.",
      },
    ]
  ),
  f(
    "luecke",
    "entwicklung",
    { de: "Lücke ehrlich benennen", en: "Name the gap honestly" },
    {
      de: "Spricht den Unterschied zwischen heutiger Leistung und dem nächsten Schritt klar an, mit Beispielen, ohne zu beschönigen oder zu verletzen.",
      en: "States the gap between today's performance and the next step clearly, with examples, neither sugar-coating nor wounding.",
    },
    [
      {
        de: "Weicht der Lücke aus oder verschleiert sie in Allgemeinplätzen; das Gegenüber geht ohne klares Bild.",
        en: "Avoids the gap or buries it in generalities; the other person leaves without a clear picture.",
      },
      {
        de: "Nennt die Lücke, aber vage oder einseitig („es fehlt noch was“), ohne Beispiel oder Bezug zur nächsten Rolle.",
        en: "Names the gap but vaguely or one-sidedly (“something is still missing”), without an example or a link to the next role.",
      },
      {
        de: "Benennt die Lücke klar mit mindestens einem Beispiel und erklärt, warum sie für den nächsten Schritt zählt.",
        en: "Names the gap clearly with at least one example and explains why it matters for the next step.",
      },
      {
        de: "Benennt die Lücke präzise mit Beispielen und Bezug zur Zielrolle, prüft, ob das Gegenüber sie genauso sieht, und hält die Klarheit auch bei Enttäuschung.",
        en: "Names the gap precisely with examples and a link to the target role, checks whether the other person sees it the same way, and keeps the clarity even when they are disappointed.",
      },
    ]
  ),
  f(
    "entwicklung",
    "entwicklung",
    { de: "Entwicklungsweg konkret machen", en: "Make the development path concrete" },
    {
      de: "Übersetzt die Lücke in Erfahrungen, Aufgaben und Unterstützung, die sichtbar zum Ziel führen.",
      en: "Turns the gap into experiences, assignments and support that visibly lead to the goal.",
    },
    [
      {
        de: "Kein Weg: Es bleibt beim Appell („mach dich sichtbarer“) ohne Aufgabe, Unterstützung oder Zeitrahmen.",
        en: "No path: it stays an appeal (“be more visible”) with no assignment, support or timeframe.",
      },
      {
        de: "Einzelne Ideen, aber unverbunden oder unrealistisch; keine Unterstützung, kein Zeitrahmen.",
        en: "A few ideas, but disconnected or unrealistic; no support, no timeframe.",
      },
      {
        de: "Zwei bis drei konkrete Erfahrungen oder Aufgaben, die zur Lücke passen, mit Unterstützung und grobem Zeitrahmen.",
        en: "Two or three concrete experiences or assignments that fit the gap, with support and a rough timeframe.",
      },
      {
        de: "Ein zusammenhängender Weg mit Aufgaben, Unterstützung, Meilensteinen und klaren Kriterien, woran beide erkennen, dass der nächste Schritt reif ist.",
        en: "A coherent path with assignments, support, milestones and clear criteria by which both can tell the next step is ready.",
      },
    ]
  ),

  // ── Kollegengespräch ────────────────────────────────────────────────────────────────────────
  f(
    "interessen",
    "kollegen",
    { de: "Interessen hinter Positionen erkunden", en: "Explore interests behind positions" },
    {
      de: "Fragt, was das Gegenüber wirklich braucht, statt Forderungen zu verhandeln oder zu widerlegen.",
      en: "Asks what the other person really needs instead of bargaining over or refuting demands.",
    },
    [
      {
        de: "Verhandelt oder widerlegt nur Positionen; fragt nie, was dahintersteht.",
        en: "Only bargains over or refutes positions; never asks what lies behind them.",
      },
      {
        de: "Fragt einmal nach Gründen, verwertet die Antwort aber nicht und kehrt zum Positionsstreit zurück.",
        en: "Asks once for reasons but does nothing with the answer and returns to the tug-of-war over positions.",
      },
      {
        de: "Fragt nach Beweggründen, greift sie auf und benennt mindestens ein Interesse des Gegenübers zutreffend.",
        en: "Asks about motives, builds on them and correctly names at least one interest of the other person.",
      },
      {
        de: "Deckt die Interessen beider Seiten auf, spiegelt sie so, dass das Gegenüber zustimmt, und baut Lösungen darauf statt auf Positionen.",
        en: "Surfaces the interests of both sides, reflects them so the other person agrees, and builds solutions on them rather than on positions.",
      },
    ]
  ),
  f(
    "standpunkt",
    "kollegen",
    { de: "Eigenen Standpunkt klar vertreten", en: "State your own position clearly" },
    {
      de: "Spricht Vorfälle und eigene Bedürfnisse direkt und vorwurfsfrei an, als Beobachtung mit Wirkung, und hält sie aus.",
      en: "Raises incidents and own needs directly and without blame, as observation plus impact, and holds the point.",
    },
    [
      {
        de: "Spricht den Vorfall nicht an oder nur als Anklage mit Unterstellung („Du hast das absichtlich …“).",
        en: "Does not raise the incident, or raises it only as an accusation with assumed intent (“you did that on purpose”).",
      },
      {
        de: "Spricht ihn an, aber verwaschen, entschuldigend oder in Du-Vorwürfen, und zieht beim ersten Gegenwind zurück.",
        en: "Raises it, but blurred, apologetic or as you-accusations, and backs off at the first pushback.",
      },
      {
        de: "Benennt Beobachtung und Wirkung in Ich-Form („Ich stand Freitagabend allein da“) und hält den Punkt, ohne anzugreifen.",
        en: "Names observation and impact in the first person (“I was on my own on Friday night”) and holds the point without attacking.",
      },
      {
        de: "Benennt Vorfall und Wirkung klar, bleibt bei Gegenwind ruhig beim Punkt, unterscheidet Absicht von Wirkung und öffnet zugleich den Raum für die Sicht des Gegenübers.",
        en: "Names incident and impact clearly, stays calmly on the point under pushback, separates intent from effect, and at the same time opens room for the other person's view.",
      },
    ]
  ),
  f(
    "loesung",
    "kollegen",
    { de: "Gemeinsame Lösung statt fauler Kompromiss", en: "Joint solution, not a lazy compromise" },
    {
      de: "Entwickelt mit dem Gegenüber Optionen, die beide Interessen tragen, und entscheidet über Kriterien statt über Macht.",
      en: "Develops options with the other person that carry both sides' interests, and decides by criteria rather than by power.",
    },
    [
      {
        de: "Setzt die eigene Lösung durch, gibt auf, oder es gibt keine Lösung.",
        en: "Pushes through its own solution, gives up, or there is no solution.",
      },
      {
        de: "Ein schneller Kompromiss, der ein Interesse opfert, ohne Alternativen zu prüfen.",
        en: "A quick compromise that sacrifices one interest without looking at alternatives.",
      },
      {
        de: "Mindestens eine Option, die die Interessen beider Seiten aufnimmt, wird gemeinsam entwickelt und begründet.",
        en: "At least one option that takes up both sides' interests is developed and reasoned together.",
      },
      {
        de: "Mehrere Optionen, Entscheidung über offen benannte Kriterien; das Gegenüber trägt die Lösung erkennbar mit und bringt eigene Bausteine ein.",
        en: "Several options, decided by openly named criteria; the other person visibly owns the solution and adds building blocks of their own.",
      },
    ]
  ),
  f(
    "verbindlich",
    "kollegen",
    { de: "Verbindlichkeit herstellen", en: "Make it binding" },
    {
      de: "Sichert Zusagen konkret: wer, was, bis wann, und prüft, ob die Zusage Substanz hat.",
      en: "Pins commitments down: who, what, by when, and checks whether the commitment has substance.",
    },
    [
      {
        de: "Keine Zusage, oder eine, die beide Seiten unterschiedlich verstehen würden.",
        en: "No commitment, or one the two sides would understand differently.",
      },
      {
        de: "Eine allgemeine Absichtserklärung („wir sprechen uns ab“) ohne Wer, Was, Bis-wann.",
        en: "A general declaration of intent (“we'll coordinate”) without who, what or by when.",
      },
      {
        de: "Mindestens eine Zusage mit Wer, Was und Bis-wann, vom Gegenüber bestätigt.",
        en: "At least one commitment with who, what and by when, confirmed by the other person.",
      },
      {
        de: "Alle offenen Punkte mit Zuständigkeit und Termin, Prüfung auf Substanz („Was genau sagst du zu?“), nächster Kontaktpunkt vereinbart.",
        en: "Every open point with an owner and a date, substance checked (“what exactly are you committing to?”), next touchpoint agreed.",
      },
    ]
  ),

  // ── Vertrieb: Kaltakquise ───────────────────────────────────────────────────────────────────
  f(
    "einstieg",
    "kaltakquise",
    { de: "Einstieg und Erlaubnis", en: "Opening and permission" },
    {
      de: "Verdient in den ersten Sätzen das Recht weiterzusprechen: Name, Grund, Bezug zum Gegenüber und ein Moment, in dem es zustimmt zuzuhören.",
      en: "Earns the right to continue in the first sentences: name, reason, relevance to the other person and a moment where they agree to listen.",
    },
    [
      {
        de: "Kein Grund zu bleiben: keine Vorstellung, kein Bezug, sofort in den Pitch; das Gegenüber hat jeden Grund aufzulegen.",
        en: "No reason to stay: no introduction, no relevance, straight into the pitch; the other person has every reason to hang up.",
      },
      {
        de: "Stellt sich vor und nennt einen Grund, aber allgemein und aus eigener Sicht; keine Erlaubnis gefragt, nichts auf das Gegenüber bezogen.",
        en: "Introduces themselves and gives a reason, but generic and from their own angle; no permission asked, nothing tied to the other person.",
      },
      {
        de: "Klare Vorstellung, ein knapper Grund mit plausiblem Bezug zur Rolle des Gegenübers und eine ausdrückliche Frage nach Zeit oder Zustimmung.",
        en: "Clear introduction, a concise reason plausibly tied to the other person's role, and an explicit ask for time or agreement.",
      },
      {
        de: "Ein konkreter Aufhänger aus der Welt des Gegenübers, Anpassung an dessen Reaktion, echte Neugier statt geduldeter Zuhörzeit.",
        en: "A concrete hook from the other person's world, adapting to their reaction, genuine curiosity rather than tolerated airtime.",
      },
    ]
  ),
  f(
    "abwimmeln",
    "kaltakquise",
    { de: "Abwimmeln auffangen", en: "Handle the brush-off" },
    {
      de: "Bleibt beim ersten „kein Interesse“ oder „schicken Sie Unterlagen“ ruhig, beantwortet den konkreten Einwand und hält die Leitung offen, ohne zu drängen.",
      en: "Stays composed at the first “not interested” or “just send something”, answers the specific objection and keeps the line open without pushing.",
    },
    [
      {
        de: "Gibt beim ersten Abwimmeln auf, oder redet dagegen und über das Gegenüber hinweg.",
        en: "Folds at the first brush-off, or argues and talks over the other person.",
      },
      {
        de: "Nimmt das Abwimmeln zur Kenntnis, antwortet aber generisch oder auswendig; der Grund des Gegenübers steht weiter im Raum.",
        en: "Acknowledges the brush-off but replies generically or by rote; the other person's reason still stands.",
      },
      {
        de: "Bleibt ruhig und antwortet direkt auf den konkreten Einwand (bei „keine Zeit“ mit einem echten Zeitangebot), so dass das Gegenüber bleibt.",
        en: "Stays composed and answers the specific objection directly (meeting “no time” with a genuine time offer), so the other person stays on.",
      },
      {
        de: "Erkennt oder erfragt den wahren Grund hinter dem Abwimmeln (Zeit, Relevanz, Vertrauen), beantwortet den und macht daraus in den Worten des Gegenübers einen Grund weiterzusprechen.",
        en: "Reads or probes the real reason behind the brush-off (time, relevance, trust), addresses that, and turns it in the other person's own words into a reason to keep talking.",
      },
    ]
  ),
  f(
    "relevanz",
    "kaltakquise",
    { de: "Relevanz herstellen", en: "Build relevance" },
    {
      de: "Verbindet das eigene Angebot mit einem konkreten Anliegen des Gegenübers, mit Beleg statt Slogan.",
      en: "Connects the offer to a concrete concern of the other person, with evidence rather than slogans.",
    },
    [
      {
        de: "Spricht nur über das Angebot; kein Bezug zur Lage des Gegenübers.",
        en: "Talks only about the offer; no link to the other person's situation.",
      },
      {
        de: "Behauptet Relevanz allgemein („das hilft Unternehmen wie Ihrem“), ohne Frage und ohne Beleg.",
        en: "Claims relevance in general (“this helps companies like yours”) with no question and no evidence.",
      },
      {
        de: "Stellt mindestens eine gezielte Frage zur Lage des Gegenübers und knüpft das Angebot mit einem konkreten Beleg an die Antwort an.",
        en: "Asks at least one targeted question about the other person's situation and ties the offer to the answer with a concrete piece of evidence.",
      },
      {
        de: "Führt mit wenigen scharfen Fragen von Symptom zu Auswirkung, verbindet das Angebot präzise damit und lässt das Gegenüber den Nutzen selbst benennen.",
        en: "Moves with a few sharp questions from symptom to impact, ties the offer precisely to it, and lets the other person name the value themselves.",
      },
    ]
  ),
  f(
    "qualifizieren",
    "kaltakquise",
    { de: "Qualifizieren", en: "Qualify" },
    {
      de: "Klärt, ob es sich lohnt: Auswirkung, Dringlichkeit, Beteiligte, bisherige Versuche.",
      en: "Finds out whether it is worth pursuing: impact, urgency, who is involved, what has been tried.",
    },
    [
      {
        de: "Erkundet nichts über den unmittelbaren Anlass hinaus; könnte nicht sagen, warum oder für wen das Thema wichtig ist.",
        en: "Explores nothing beyond the immediate topic; could not say why or for whom it matters.",
      },
      {
        de: "Streift ein bis zwei Punkte oberflächlich („Wann wäre das Thema?“), ohne sie zu verbinden oder die Dringlichkeit zu gewichten.",
        en: "Touches one or two points superficially (“what's your timeline?”) without connecting them or weighing urgency.",
      },
      {
        de: "Klärt mindestens zwei Dimensionen (etwa Auswirkung und Dringlichkeit, oder Beteiligte und Zeitpunkt) ausreichend, um die Chance einzuschätzen.",
        en: "Clarifies at least two dimensions (say impact and urgency, or stakeholders and timing) well enough to judge the opportunity.",
      },
      {
        de: "Lässt das Gegenüber die Auswirkung in eigenen Worten benennen (Kosten, Risiko, was passiert, wenn nichts passiert), klärt Entscheidungsweg und bisherige Versuche und baut daraus ein gemeinsames Bild.",
        en: "Gets the other person to state the impact in their own terms (cost, risk, what happens if nothing changes), clarifies the decision path and prior attempts, and builds a shared picture from it.",
      },
    ]
  ),
  f(
    "naechster-schritt",
    "kaltakquise",
    { de: "Nächsten Schritt sichern", en: "Secure the next step" },
    {
      de: "Führt zu einem konkreten Folgeschritt, dem das Gegenüber wirklich zustimmt: Zweck, Zeitpunkt, Beteiligte.",
      en: "Drives to a concrete follow-up the other person genuinely agrees to: purpose, time, people.",
    },
    [
      {
        de: "Fragt nicht nach einem nächsten Schritt oder lässt das Gespräch mit „Ich melde mich“ enden.",
        en: "Never asks for a next step, or lets the call end with “I'll be in touch”.",
      },
      {
        de: "Fragt vage („irgendwann nächste Woche?“) und nimmt ein unverbindliches Vielleicht hin.",
        en: "Asks vaguely (“sometime next week?”) and accepts a non-committal maybe.",
      },
      {
        de: "Macht einen klaren Vorschlag mit Zweck, das Gegenüber stimmt grundsätzlich zu; Termin oder Beteiligte können noch offen sein.",
        en: "Makes a clear proposal with a purpose and the other person agrees in principle; date or attendees may still be open.",
      },
      {
        de: "Fragt zum richtigen Zeitpunkt, sichert Termin, Beteiligte und Zweck, und das Gegenüber will das nächste Gespräch erkennbar.",
        en: "Asks at the right moment, locks date, attendees and purpose, and the other person visibly wants the next conversation.",
      },
    ]
  ),

  // ── Vertrieb: Bedarfsgespräch ───────────────────────────────────────────────────────────────
  f(
    "agenda",
    "bedarf",
    { de: "Agenda abstimmen", en: "Agree the agenda" },
    {
      de: "Klärt zu Beginn Zweck, Ablauf und gewünschtes Ergebnis und holt dafür die Zustimmung des Gegenübers.",
      en: "Clarifies purpose, flow and desired outcome at the start and gets the other person's agreement to it.",
    },
    [
      {
        de: "Beginnt ohne Zweck oder Struktur mit Fragen oder Pitch; das Gegenüber muss fragen, worum es geht.",
        en: "Starts with questions or a pitch and no purpose or structure; the other person has to ask what this is about.",
      },
      {
        de: "Nennt Themen, aber ohne Zweck oder Zustimmung; wirkt wie ein eigener Fahrplan.",
        en: "Lists topics but without purpose or agreement; feels like a one-sided itinerary.",
      },
      {
        de: "Knapper, klarer Ablauf mit Zweck, kurz abgestimmt („Passt das für Sie?“), dann sauberer Übergang.",
        en: "A brief, clear flow with a purpose, quickly confirmed (“does that work for you?”), then a clean transition.",
      },
      {
        de: "Lädt das Gegenüber ein, die Agenda mitzuprägen, knüpft sie an dessen Ziele und erzeugt gemeinsame Erwartungen.",
        en: "Invites the other person to shape the agenda, ties it to their goals and creates shared expectations.",
      },
    ]
  ),
  f(
    "fragen",
    "bedarf",
    { de: "Fragen und nachfassen", en: "Ask and follow up" },
    {
      de: "Stellt offene, gut gereihte Fragen und fasst nach, bis echte Probleme statt Oberflächenantworten sichtbar sind.",
      en: "Asks open, well-sequenced questions and follows up until real problems show instead of surface answers.",
    },
    [
      {
        de: "Fast keine Frage von Substanz, oder Fragen sind nur Vorlagen für den Pitch.",
        en: "Hardly any question of substance, or questions are only set-ups for the pitch.",
      },
      {
        de: "Einige geschlossene oder allgemeine Fragen, kein Nachfassen; bleibt an der Oberfläche.",
        en: "A few closed or generic questions, no follow-up; stays on the surface.",
      },
      {
        de: "Überwiegend offene Fragen, mindestens ein echtes Problem wird sichtbar, mindestens einmal wird nachgefasst.",
        en: "Mostly open questions, at least one genuine problem surfaces, at least one follow-up.",
      },
      {
        de: "Wenige scharfe Fragen führen vom Symptom zur Auswirkung; Probleme werden sichtbar, die das Gegenüber selbst noch nicht ausformuliert hatte; neugierig, nie Verhör.",
        en: "A few sharp questions lead from symptom to impact; problems surface the other person had not yet put into words; curious, never an interrogation.",
      },
    ]
  ),
  f(
    "spiegeln",
    "bedarf",
    { de: "Zuhören und spiegeln", en: "Listen and reflect" },
    {
      de: "Zeigt Verständnis, indem es zutreffend zusammenfasst und die nächste Frage auf der Antwort aufbaut.",
      en: "Shows understanding by summarising accurately and building the next question on the answer.",
    },
    [
      {
        de: "Ignoriert Antworten und arbeitet ein Skript ab.",
        en: "Ignores answers and works through a script.",
      },
      {
        de: "Quittiert nur („verstehe“, „okay“), spiegelt nichts und baut nichts auf dem Gesagten auf.",
        en: "Only acknowledges (“I see”, “okay”), reflects nothing and builds nothing on what was said.",
      },
      {
        de: "Gibt die Hauptpunkte zutreffend wieder, die nächste Frage knüpft daran an, bleibt aber bei der Oberfläche.",
        en: "Restates the main points accurately and the next question connects to them, but stays on the surface.",
      },
      {
        de: "Fasst das dahinterliegende Anliegen so treffend zusammen, dass das Gegenüber bestätigt („genau“), und formt das Gespräch sichtbar danach.",
        en: "Summarises the underlying concern so accurately that the other person confirms it (“exactly”), and visibly shapes the conversation around it.",
      },
    ]
  ),
  f(
    "bedarf-entscheider",
    "bedarf",
    { de: "Bedarf, Entscheider, Budget, Zeitpunkt klären", en: "Clarify need, decision-maker, budget, timing" },
    {
      de: "Klärt im Gespräch, ob ein echtes Problem besteht, wer entscheidet, wie Vorhaben finanziert werden und ob es einen Zeitpunkt gibt.",
      en: "Establishes in conversation whether there is a real problem, who decides, how such initiatives are funded and whether there is a timeline.",
    },
    [
      {
        de: "Geht Richtung Termin, ohne Problem, Entscheider, Budgetlogik oder Zeitpunkt zu kennen.",
        en: "Heads for a meeting without knowing the problem, the decision-maker, the budget logic or the timing.",
      },
      {
        de: "Einzelne, vage Ansätze; Problem nicht bestätigt, Budget nicht berührt.",
        en: "Isolated, vague attempts; problem not confirmed, budget not touched.",
      },
      {
        de: "Bestätigt ein plausibles Problem, fragt nach Zuständigkeit und klärt Zeitpunkt oder Budgetlogik; einzelne Signale fehlen.",
        en: "Confirms a plausible problem, asks about ownership and clarifies timing or budget logic; some signals are still missing.",
      },
      {
        de: "Alle vier Punkte natürlich im Gespräch geklärt und als Grundlage für den nächsten Schritt genutzt, statt vorzeitig zum Termin zu drängen.",
        en: "All four points clarified naturally in conversation and used as the basis for the next step, rather than pushing for a meeting prematurely.",
      },
    ]
  ),

  // ── Kundenbeschwerde ────────────────────────────────────────────────────────────────────────
  f(
    "bedarf-finden",
    "beschwerde",
    { de: "Zuhören und Bedarf finden", en: "Listen and find the real need" },
    {
      de: "Erkundet die Lage des Gegenübers, bevor es löst, und findet den eigentlichen Bedarf hinter der Forderung.",
      en: "Explores the other person's situation before solving, and finds the real need behind the demand.",
    },
    [
      {
        de: "Drängt von Beginn an auf die eigene Lösung oder Regel; keine echte Frage.",
        en: "Pushes its own solution or policy from the start; no genuine question.",
      },
      {
        de: "Eine Frage, aber oberflächlich; geht weiter, bevor das eigentliche Anliegen auf dem Tisch ist.",
        en: "One question, but superficial; moves on before the real concern is on the table.",
      },
      {
        de: "Stellt offene Fragen und benennt das Hauptanliegen zutreffend; die Antwort passt dazu, nicht zu einer Standardversion.",
        en: "Asks open questions and names the main concern accurately; the response fits that, not a generic version.",
      },
      {
        de: "Fragt über die Forderung hinaus zum eigentlichen Bedarf (etwa: die Ware rechtzeitig, nicht die Gutschrift), lässt bestätigen und baut die Lösung darauf.",
        en: "Probes past the demand to the real need (say: the goods on time, not the credit note), gets it confirmed and builds the solution on it.",
      },
    ]
  ),
  f(
    "empathie",
    "beschwerde",
    { de: "Empathie konkret", en: "Concrete empathy" },
    {
      de: "Benennt das Gefühl oder den Einsatz des Gegenübers konkret und glaubwürdig, bevor es löst.",
      en: "Names the other person's feeling or effort concretely and credibly before solving anything.",
    },
    [
      {
        de: "Übergeht die Emotion, spielt sie herunter oder behandelt das Gegenüber wie einen Vorgang.",
        en: "Ignores the emotion, plays it down or treats the other person like a case number.",
      },
      {
        de: "Formelhaft („Entschuldigung für die Unannehmlichkeiten“), nennt weder Gefühl noch Grund.",
        en: "Formulaic (“sorry for the inconvenience”), names neither the feeling nor why it matters.",
      },
      {
        de: "Benennt das konkrete Gefühl oder den Einsatz („zum zweiten Mal anrufen zu müssen, ist zermürbend“); der Ton passt zum Moment.",
        en: "Names the actual feeling or effort (“having to call a second time is wearing”); the tone fits the moment.",
      },
      {
        de: "Benennt auch, was das Gegenüber noch nicht ausgesprochen hat, nimmt Sorgen vorweg, hält den Ton, und das Gegenüber beruhigt sich erkennbar.",
        en: "Also names what the other person has not yet voiced, pre-empts worries, sustains the tone, and the other person visibly settles.",
      },
    ]
  ),
  f(
    "verantwortung",
    "beschwerde",
    { de: "Verantwortung übernehmen", en: "Take ownership" },
    {
      de: "Übernimmt persönlich die Lösung des konkreten Problems, ohne auf andere, das System oder Regeln zu zeigen.",
      en: "Personally owns the resolution of this specific problem, without pointing to others, the system or policy.",
    },
    [
      {
        de: "Schiebt ab: andere Abteilung, System, Regel oder das Gegenüber; wird defensiv oder distanziert sich („da kann ich nichts machen“).",
        en: "Deflects: another team, the system, policy or the other person; gets defensive or distances itself (“nothing I can do”).",
      },
      {
        de: "Vermeidet Schuldzuweisung, bleibt aber bei Routinezusagen („ich leite das weiter“) oder versteckt sich hinter dem Ablauf.",
        en: "Avoids blame but stops at routine promises (“I'll pass that on”) or hides behind process.",
      },
      {
        de: "Übernimmt in Ich-Form die Verantwortung für die Lösung dieses Falls, auch ohne ihn verursacht zu haben.",
        en: "Takes first-person responsibility for resolving this case, even without having caused it.",
      },
      {
        de: "Benennt den Fehler offen, wo einer war, und verbindet die Verantwortung mit einer Zusage, die sichtbar Vertrauen zurückbringt.",
        en: "Names the failure plainly where there was one, and pairs ownership with a commitment that visibly restores trust.",
      },
    ]
  ),
  f(
    "klar-relevant",
    "beschwerde",
    { de: "Klar und relevant erklären", en: "Explain clearly and relevantly" },
    {
      de: "Erklärt verständlich und verknüpft Informationen mit dem, was diesem Gegenüber wichtig ist.",
      en: "Explains plainly and ties information to what matters to this particular person.",
    },
    [
      {
        de: "Liste von Regeln, Fachbegriffen oder Fakten ohne Bezug; das Gegenüber fragt sich, was das für es heißt.",
        en: "A list of rules, jargon or facts with no link; the other person is left wondering what it means for them.",
      },
      {
        de: "Klar, aber allgemein; nicht auf die Situation bezogen, keine Prüfung, ob es angekommen ist.",
        en: "Clear but generic; not tied to the situation, no check that it landed.",
      },
      {
        de: "Einfache Sprache, der Kernpunkt ist an etwas geknüpft, das dem Gegenüber wichtig ist.",
        en: "Plain language, the key point is tied to something the other person said they care about.",
      },
      {
        de: "Übersetzt durchgehend in Nutzen für diese Situation, lässt Unwichtiges weg und prüft Verständnis.",
        en: "Consistently translates into value for this situation, drops what is irrelevant and checks understanding.",
      },
    ]
  ),
  f(
    "verbindlich-kunde",
    "beschwerde",
    { de: "Verbindlicher nächster Schritt", en: "A binding next step" },
    {
      de: "Führt zu einer konkreten, glaubwürdigen Handlung, die das Gegenüber ausdrücklich annimmt, mit Zuständigkeit und Zeitpunkt.",
      en: "Leads to a concrete, credible action the other person explicitly accepts, with an owner and a time.",
    },
    [
      {
        de: "Kein konkreter Schritt, oder ein Versprechen, das nicht einzuhalten ist.",
        en: "No concrete step, or a promise that cannot be kept.",
      },
      {
        de: "Ein Schritt wird angedeutet, aber vage oder einseitig: ohne Zuständigkeit, Zeitpunkt oder Zustimmung („wir melden uns“).",
        en: "A step is gestured at but vague or one-sided: no owner, no time, no agreement (“we'll get back to you”).",
      },
      {
        de: "Eine konkrete Handlung wird vorgeschlagen und das Gegenüber stimmt ihr ausdrücklich zu.",
        en: "A concrete action is proposed and the other person explicitly agrees to it.",
      },
      {
        de: "Handlung mit Zuständigkeit, Zeitpunkt und realistischen Erwartungen; beide könnten unabhängig sagen, was als Nächstes passiert.",
        en: "An action with an owner, a time and realistic expectations; both could independently say what happens next.",
      },
    ]
  ),

  // ── Medieninterview ─────────────────────────────────────────────────────────────────────────
  f(
    "kernbotschaft",
    "medien",
    { de: "Kernbotschaft halten", en: "Hold the core message" },
    {
      de: "Hat eine klare Botschaft und bringt sie trotz Ablenkung, Druck und Nachfragen immer wieder an.",
      en: "Has a clear message and keeps bringing it back despite distraction, pressure and follow-ups.",
    },
    [
      {
        de: "Keine erkennbare Botschaft; folgt jeder Frage dorthin, wo sie hinführt.",
        en: "No recognisable message; follows every question wherever it leads.",
      },
      {
        de: "Eine Botschaft ist erkennbar, geht aber unter oder wird nur einmal genannt.",
        en: "A message is recognisable but gets lost or is stated only once.",
      },
      {
        de: "Botschaft klar formuliert und mindestens zweimal eingebracht, auch nach Druck.",
        en: "Message clearly phrased and brought in at least twice, including after pressure.",
      },
      {
        de: "Botschaft prägnant, mehrfach und variiert gesetzt, mit Belegen gestützt; das Gespräch endet erkennbar auf ihr.",
        en: "Message crisp, placed several times with variation and backed by evidence; the conversation visibly ends on it.",
      },
    ]
  ),
  f(
    "bruecke",
    "medien",
    { de: "Brücke zur Botschaft", en: "Bridge to the message" },
    {
      de: "Beantwortet die Frage kurz und ehrlich und führt dann zur eigenen Botschaft, ohne auszuweichen.",
      en: "Answers the question briefly and honestly, then leads to the own message without dodging.",
    },
    [
      {
        de: "Weicht aus oder antwortet gar nicht; oder antwortet und verliert sich im Thema des Fragenden.",
        en: "Dodges or does not answer at all; or answers and gets lost in the interviewer's topic.",
      },
      {
        de: "Brückt mechanisch („wichtig ist doch …“), ohne die Frage zu würdigen; wirkt ausweichend.",
        en: "Bridges mechanically (“what matters is …”) without honouring the question; comes across as evasive.",
      },
      {
        de: "Beantwortet die Frage knapp und ehrlich und führt dann nachvollziehbar zur Botschaft.",
        en: "Answers the question briefly and honestly, then leads plausibly to the message.",
      },
      {
        de: "Würdigt die Frage, antwortet ehrlich, setzt die Brücke so natürlich, dass sie nicht als Technik auffällt, und bleibt bei Nachfragen konsistent.",
        en: "Honours the question, answers honestly, bridges so naturally it does not read as a technique, and stays consistent under follow-ups.",
      },
    ]
  ),
  f(
    "keine-spekulation",
    "medien",
    { de: "Keine Spekulation", en: "No speculation" },
    {
      de: "Sagt nur, was belegt ist, trennt Wissen von Vermutung und benennt offen, was noch nicht bekannt ist.",
      en: "Says only what is established, separates knowledge from assumption, and states openly what is not yet known.",
    },
    [
      {
        de: "Spekuliert über Ursachen, Zahlen oder Schuld, oder erfindet Details.",
        en: "Speculates about causes, figures or blame, or invents details.",
      },
      {
        de: "Weicht pauschal aus („dazu kann ich nichts sagen“), ohne zu erklären, warum, oder vermischt Wissen und Vermutung.",
        en: "Deflects wholesale (“I can't comment on that”) without saying why, or mixes knowledge and assumption.",
      },
      {
        de: "Trennt sauber: nennt Belegtes, benennt Unbekanntes als unbekannt und sagt, wann es Klarheit gibt.",
        en: "Separates cleanly: states what is established, names the unknown as unknown and says when there will be clarity.",
      },
      {
        de: "Bleibt unter wiederholtem Druck bei dieser Linie, ohne unsicher zu wirken, und macht aus dem Unbekannten einen klaren nächsten Schritt.",
        en: "Holds that line under repeated pressure without seeming unsure, and turns the unknown into a clear next step.",
      },
    ]
  ),
  f(
    "druck",
    "medien",
    { de: "Ruhig unter Druck", en: "Calm under pressure" },
    {
      de: "Bleibt bei scharfen, unterbrechenden oder suggestiven Fragen ruhig, höflich und bei der Sache.",
      en: "Stays calm, courteous and on point under sharp, interrupting or leading questions.",
    },
    [
      {
        de: "Wird gereizt, abwehrend oder greift den Fragenden an.",
        en: "Gets irritated or defensive, or attacks the interviewer.",
      },
      {
        de: "Bleibt höflich, verliert aber den Faden, stammelt oder gibt der Suggestion nach.",
        en: "Stays polite but loses the thread, stumbles, or gives in to the leading premise.",
      },
      {
        de: "Bleibt ruhig und höflich, korrigiert falsche Prämissen sachlich und kehrt zum Punkt zurück.",
        en: "Stays calm and courteous, corrects false premises factually and returns to the point.",
      },
      {
        de: "Nutzt Druck souverän: nimmt die Frage ernst, korrigiert gelassen, behält Tempo und Ton und wirkt dadurch glaubwürdiger als vorher.",
        en: "Uses pressure with poise: takes the question seriously, corrects calmly, keeps pace and tone, and comes across more credible than before.",
      },
    ]
  ),
  f(
    "verantwortung-zeigen",
    "medien",
    { de: "Verantwortung zeigen, Betroffene zuerst", en: "Show responsibility, affected people first" },
    {
      de: "Stellt Betroffene und Lösung vor Rechtfertigung und zeigt, dass das Unternehmen handelt.",
      en: "Puts affected people and the remedy before justification and shows the company is acting.",
    },
    [
      {
        de: "Rechtfertigt, relativiert oder verweist auf andere; Betroffene kommen nicht vor.",
        en: "Justifies, minimises or points to others; affected people do not come up.",
      },
      {
        de: "Erwähnt Betroffene formelhaft, ohne konkrete Handlung.",
        en: "Mentions affected people formulaically, without any concrete action.",
      },
      {
        de: "Nennt Betroffene zuerst, benennt konkrete Maßnahmen und wer sie verantwortet.",
        en: "Puts affected people first, names concrete measures and who is responsible for them.",
      },
      {
        de: "Zeigt glaubwürdig Haltung: Betroffene zuerst, konkrete Schritte mit Zeitpunkten, Erreichbarkeit, und bleibt dabei ohne Pathos.",
        en: "Shows credible stance: affected people first, concrete steps with dates, ways to reach the company, and no pathos.",
      },
    ]
  ),
];

export const FAEHIGKEIT_BY_ID: ReadonlyMap<string, Faehigkeit> = new Map(FAEHIGKEITEN.map((x) => [x.id, x]));

export function faehigkeit(id: string): Faehigkeit | undefined {
  return FAEHIGKEIT_BY_ID.get(id);
}

export type FaehigkeitLocale = "de" | "en";

/** Bewertungs-Rubrik für den Richter: Definition plus vier Stufen (unsere Skala 1–4). */
export function faehigkeitRubrik(x: Faehigkeit, locale: FaehigkeitLocale): string {
  const stufen = x.stufen.map((s, i) => `${i + 1} = ${STUFEN_NAMEN[i][locale]}: ${s[locale]}`).join("\n");
  return locale === "en" ? `Definition: ${x.definition.en}\nLevels:\n${stufen}` : `Definition: ${x.definition.de}\nStufen:\n${stufen}`;
}

/**
 * Anker eines Szenarios aus der Bibliothek: Key = Fähigkeits-Id, Label = Titel, Rubrik = vier Stufen.
 * Gewichte sind relativ (Summe frei; die Rechnung normalisiert über die beobachteten Anker).
 */
export function anker(locale: FaehigkeitLocale, liste: ReadonlyArray<readonly [id: string, weight: number]>): SimRubricCompetency[] {
  return liste.map(([id, weight]) => {
    const x = faehigkeit(id);
    if (!x) throw new Error(`Unbekannte Fähigkeit: ${id}`);
    return { key: id, label: x.titel[locale], weight, rubric: faehigkeitRubrik(x, locale) };
  });
}

/**
 * Ergänzt Anker aus dem Builder: trägt ein Szenario einen Key aus der Bibliothek, bekommt der Anker
 * Titel und Rubrik der Bibliothek (gleiche Fähigkeit = gleiche Messlatte über Szenarien hinweg).
 * Eigene Keys bleiben unverändert.
 */
export function ergaenzeAnker(competencies: SimRubricCompetency[], locale: FaehigkeitLocale): SimRubricCompetency[] {
  return competencies.map((c) => {
    const x = faehigkeit(c.key);
    if (!x) return c;
    return { ...c, label: x.titel[locale], rubric: faehigkeitRubrik(x, locale) };
  });
}

/** Kompakte Liste für den Generator-Prompt (Id und Titel je Gruppe). */
export function faehigkeitenKatalog(locale: FaehigkeitLocale): string {
  const gruppen: Record<FaehigkeitGruppe, Zweisprachig> = {
    fuehrung: { de: "Mitarbeitergespräch (Kritik, Leistung)", en: "Employee conversation (criticism, performance)" },
    entwicklung: { de: "Mitarbeitergespräch (Anerkennung, Entwicklung)", en: "Employee conversation (recognition, development)" },
    kollegen: { de: "Kollegengespräch, Verhandlung", en: "Peer conversation, negotiation" },
    kaltakquise: { de: "Vertrieb: Kaltakquise", en: "Sales: cold call" },
    bedarf: { de: "Vertrieb: Bedarfsgespräch", en: "Sales: discovery call" },
    beschwerde: { de: "Kundenbeschwerde", en: "Customer complaint" },
    medien: { de: "Medieninterview", en: "Media interview" },
  };
  const out: string[] = [];
  for (const g of Object.keys(gruppen) as FaehigkeitGruppe[]) {
    const items = FAEHIGKEITEN.filter((x) => x.gruppe === g).map((x) => `${x.id} (${x.titel[locale]})`);
    out.push(`- ${gruppen[g][locale]}: ${items.join(", ")}`);
  }
  return out.join("\n");
}
