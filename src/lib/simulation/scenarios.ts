/**
 * Gesprächssimulation — Szenario-SSOT (SIM-1).
 *
 * Drei kuratierte Rollen als Lerntreppe (Stufe 1→3), destilliert und ABGEWANDELT
 * aus co-entwickeltem AC-Material (Owner-Auflage: Ideen behalten, Inhalte
 * abwandeln, Namen internationalisieren — der Verbots-Test in scenarios.test.ts
 * erzwingt das maschinell). Firmenwelt: NorthBay Foods Inc. (fiktiv).
 *
 * personaDna verlässt NIE den Server — Auslieferung nur via publicScenario().
 * Zitate in Rollensprache stehen in »Guillemets« (ASCII-Anführungszeichen in
 * String-Literalen sind hier eine Parser-Falle — gebranntes Kind, 30.07.).
 */

import type {
  PublicSimulationScenario,
  SimRubricCompetency,
  SimulationScenario,
} from "./types";

/** Gemeinsame Feedback-Rubrik S1–S5 (Blueprint §2) — für alle Szenarien gleich. */
export const SIM_RUBRIC: SimRubricCompetency[] = [
  { key: "S1", label: "Gesprächsstruktur & Zielklarheit" },
  { key: "S2", label: "Aktives Zuhören & Paraphrasieren" },
  { key: "S3", label: "Interessen hinter Positionen erkunden" },
  { key: "S4", label: "Konstruktive Konfrontation (Ich-Botschaften, Fakten statt Vorwurf)" },
  { key: "S5", label: "Verbindliche Vereinbarungen & nächste Schritte" },
];

const morgan: SimulationScenario = {
  id: "sim-coaching-morgan",
  title: "Harmonie vs. Steuerung — Coaching-Gespräch mit Alex Morgan",
  teaser:
    "Deine beziehungsorientierte Kundenverantwortliche liefert Qualität, verliert aber die Steuerung: ein Kunde eskaliert, ein Angebot hängt, delegiert wird nichts.",
  conversationType: "mitarbeitergespräch",
  difficulty: 1,
  category: "mitarbeiterfuehrung",
  // Blueprint §2.2 (E3, provisorisch): primaer trainierte Kompetenzen — nur Sortierung.
  competencyFocus: ["C3", "C2"],
  durationMin: 15,
  locale: "de",
  persona: { name: "Alex Morgan", role: "Kundenverantwortliche" },
  candidateBriefing: {
    yourRole:
      "Du bist Führungskraft bei der NorthBay Foods Inc. Alex Morgan ist seit drei Monaten Kundenverantwortliche in deinem Bereich und führt fachlich ein kleines Team mit zwei Junior-Experts. Sie ist ausgesprochen beziehungsorientiert, hat hohe Qualitätsansprüche an sich selbst — und tut sich schwer, zwischen Harmonie und Steuerung die Balance zu finden.",
    relationship:
      "Ihr arbeitet seit ihrer Übernahme der Kundenverantwortung gut zusammen; Alex ist engagiert und loyal. Kritik nimmt sie schnell persönlich. Du schätzt sie und willst sie halten und entwickeln.",
    incidents: [
      "Ein wichtiger Kunde hat sich unzufrieden gemeldet: Ein zugesagtes Angebot liegt seit zwei Wochen unbearbeitet, weil Alex es »noch perfekt machen« wollte.",
      "Alex wirkt zunehmend belastet und macht regelmäßig Überstunden — gibt aber keine Aufgaben an ihre beiden Junior-Experts ab.",
      "Kim Patel aus ihrem Team arbeitet seit Kurzem der Kollegin Lea Fontaine zu — ohne Absprache mit dir; die Kapazität fehlt nun im Kundenprojekt.",
    ],
    goals: [
      "Eine offene, wertschätzende Gesprächsbasis halten — Alex soll gestärkt, nicht gekränkt aus dem Gespräch gehen.",
      "Die Muster dahinter besprechbar machen: Perfektionismus, fehlende Delegation, Konfliktvermeidung (Kim/Lea).",
      "Konkrete Vereinbarungen treffen: Angebot bis Ende der Woche raus, Delegationsplan für die Junior-Experts, klare Regelung der Kim-Patel-Zuarbeit.",
    ],
    approachHints: [
      "Wertschätzung zuerst — aber gekoppelt an konkrete Beobachtungen, nicht an Allgemeinlob.",
      "Sprich Muster an statt Einzelfälle: Was wiederholt sich bei Angebot, Delegation, Konflikten?",
      "Lass Alex eigene Lösungen entwickeln, bevor du deine anbietest.",
      "Ohne konkrete Vereinbarung mit Termin verpufft das Gespräch.",
    ],
    expectation:
      "Alex ist warmherzig und leistungsstark — Kritik an der Steuerung wird sie zunächst mit Beziehungs- und Qualitätsargumenten abfedern.",
    timeboxMin: 20,
  },
  personaDna: {
    name: "Alex Morgan",
    role: "Kundenverantwortliche",
    background:
      "Seit drei Monaten in der Rolle, davor starke Fachkraft. Führt zwei Junior-Experts fachlich. Erster Karriereschritt mit Führungsanteil.",
    selfImage:
      "Sieht sich als verlässliche Qualitätsgarantin, die für Kunden und Team immer erreichbar ist. Glaubt, dass gute Beziehungen die Grundlage von allem sind.",
    publicBehavior: [
      "Freundlich, zugewandt, redet schnell, entschuldigt sich häufig.",
      "Weicht Konfliktthemen aus, lenkt auf Sachthemen oder Anekdoten ab.",
      "Nimmt Aufgaben an sich (»mach ich schnell selbst«), statt zu delegieren.",
    ],
    hiddenDrivers: [
      "Angst, in der neuen Rolle zu enttäuschen — Fehler der Juniors fühlen sich wie eigene an.",
      "Harmoniebedürfnis: Kim Patel bat sie persönlich um die Zuarbeit für Lea Fontaine, und Alex konnte nicht Nein sagen.",
      "Das Kundenangebot hält sie zurück, weil sie fürchtet, mit einem 90-Prozent-Angebot Kritik zu ernten.",
    ],
    positions: [
      "»Ich habe alles im Griff, es ist nur gerade viel.«",
      "»Die Juniors sind noch nicht so weit, dass ich ihnen Kundenthemen geben kann.«",
    ],
    interests: [
      "Sicherheit, dass ein nicht-perfektes Ergebnis nicht als Versagen gilt.",
      "Rückendeckung bei einem klärenden Nein an Kim/Lea.",
      "Anerkennung ihres Einsatzes, bevor über Defizite gesprochen wird.",
    ],
    objectionPlaybook: [
      {
        trigger: "Das liegengebliebene Angebot wird angesprochen",
        objection:
          "Das Angebot ist fast fertig — ich wollte es nur wirklich gut machen, der Kunde ist anspruchsvoll.",
      },
      {
        trigger: "Delegation wird vorgeschlagen",
        objection:
          "Bis ich das erklärt habe, habe ich es dreimal selbst gemacht. Und wenn es schiefgeht, fällt es auf mich zurück.",
      },
      {
        trigger: "Die Kim-Patel-Zuarbeit wird angesprochen",
        objection:
          "Kim hat mich direkt gefragt, und Lea brauchte wirklich Hilfe — ich wollte kein schlechtes Klima erzeugen.",
      },
    ],
    concessionConditions: [
      "Die Führungskraft erkennt zuerst ehrlich Einsatz und Qualität an.",
      "Die Führungskraft macht Delegation zum gemeinsamen Lernziel statt zum Vorwurf (z. B. Pilot-Aufgabe mit Backup).",
      "Die Führungskraft bietet konkrete Rückendeckung für die Klärung mit Kim/Lea an.",
    ],
    escalationTriggers: [
      "Pauschale Kritik (»Du hast das nicht im Griff«).",
      "Vergleich mit anderen Kolleg:innen.",
      "Druck ohne Angebot (»Das Angebot geht heute noch raus, Punkt.«) — dann wird Alex still und formell.",
    ],
    personality: {
      tone: "Warm, schnell, leicht atemlos; duzt die Führungskraft.",
      quirks: [
        "Entschuldigt sich, bevor sie widerspricht (»Sorry, aber …«).",
        "Untertreibt eigene Belastung (»alles gut, nur gerade viel los«).",
      ],
    },
    knowledgeBounds: [
      "Weiß nicht, dass der Kunde sich bereits bei der Führungskraft gemeldet hat — reagiert betroffen, wenn sie es erfährt.",
      "Kennt keine Budget- oder Strategiedetails außerhalb ihres Kundenbereichs.",
    ],
    facts: [
      "Angebot liegt seit zwei Wochen; Zusage an den Kunden war »innerhalb weniger Tage«.",
      "Zwei Junior-Experts im Team; beide haben freie Kapazität.",
      "Kim Patel arbeitet seit ca. drei Wochen etwa einen Tag pro Woche für Lea Fontaine zu.",
    ],
    openingLine:
      "Hi! Du wolltest mich sprechen? Ich hab gleich um halb noch den Kunden-Call, aber ein bisschen Zeit hab ich. Worum geht es denn?",
  },
  assessment: {
    competencies: SIM_RUBRIC,
    checkpoints: [
      { id: "morgan-anerkennung", description: "Hat der Übende Einsatz/Qualität ehrlich anerkannt, BEVOR Kritikpunkte kamen?" },
      { id: "morgan-kundenfeedback", description: "Wurde das Kundenfeedback zum Angebot konkret und vorwurfsfrei angesprochen (Fakten statt Wertung)?" },
      { id: "morgan-muster", description: "Wurde das Muster (Perfektionismus/Nicht-Delegieren/Nicht-Nein-Sagen) statt nur der Einzelfälle besprochen?" },
      { id: "morgan-angst", description: "Wurde die dahinterliegende Sorge (enttäuschen, Kritik ernten) aufgedeckt oder zumindest angesprochen?" },
      { id: "morgan-vereinbarung", description: "Gibt es konkrete Vereinbarungen (Angebot-Termin, Delegations-Pilot, Kim/Lea-Regelung) mit Wer/Was/Bis-wann?" },
    ],
  },
};

const lang: SimulationScenario = {
  id: "sim-peer-lang",
  title: "Der übergangene Ex-Chef — Kollegengespräch mit Viktor Lang",
  teaser:
    "Dein früherer Vorgesetzter blockiert das gemeinsame Projekt, verweigert dir einen Experten und streut eine vertrauliche Präsentation. Du brauchst ihn trotzdem.",
  conversationType: "kollegengespräch",
  difficulty: 2,
  category: "zusammenarbeit",
  // Blueprint §2.2 (E3, provisorisch): primaer trainierte Kompetenzen — nur Sortierung.
  competencyFocus: ["C1", "C5"],
  durationMin: 15,
  locale: "de",
  persona: { name: "Viktor Lang", role: "Werksleiter Kingsport 2" },
  candidateBriefing: {
    yourRole:
      "Du bist seit wenigen Monaten Werksleiter:in des Werks Kingsport 1 der NorthBay Foods Inc. (Marke BlueCrest, Tiefkühl-Lebensmittel). Du wurdest berufen, um Auslastung und Prozesse des Werks zu verbessern. Beide Kingsport-Werke sollen im konzernweiten UMS-Projekt (Unified-Management-System für Qualität, Umwelt und Arbeitssicherheit) ihre Prozesse vereinheitlichen; die Projektsteuerung liegt bei Dr. Elias Berger von SystemWorks Consulting.",
    relationship:
      "Viktor Lang leitet das Nachbarwerk Kingsport 2 (Marke Oceana) — und war früher dein Vorgesetzter: Unter ihm warst du erfolgreiche Betriebsassistenz in Kingsport 2. Er ist fünf Jahre länger im Unternehmen als du, wurde aber langsamer befördert. Seit deiner Ernennung ist er spürbar reserviert; anfangs zollte er dir fachlichen Respekt, zuletzt häufen sich die Differenzen.",
    incidents: [
      "Im UMS-Projekt hält Lang sein Erfahrungswissen sichtbar zurück — und kritisiert deine Vorschläge (z. B. werkübergreifende Projektteams) grundsätzlich erst in der entscheidenden Sitzung, obwohl du ihn vorab um Stellungnahme gebeten hast.",
      "Letzte Woche verweigerte er dir seinen Mitarbeiter Sam Novak für eine Woche. Novak sollte dein Entwicklungsteam um Dr. Mira Chen auf der neuen Störfall-Analysesoftware FaultScope schulen — jeder verlorene Tag gefährdet deine Terminplanung. Novak hatte dir die Schulung vorab zugesagt und sich bei dir entschuldigt.",
      "Eine vertrauliche Präsentation zur neuen Prozess-Dokumentation, die du Lang zur Abstimmung gabst, landete bei einem Mitarbeiter der Technischen Entwicklung — BEVOR deine Abteilungsleiterin Dr. Mira Chen sie kannte. Diese Indiskretion torpediert deine Kommunikationsreihenfolge (erst Führungskräfte, dann Mitarbeitende).",
    ],
    goals: [
      "Eine konstruktive, vertrauensvolle Basis für die weitere Zusammenarbeit schaffen — dafür die Differenzen der Vergangenheit aufarbeiten.",
      "Die Zusammenarbeit im UMS-Projekt verbindlich verbessern — du brauchst Langs Erfahrungswissen, und das gemeinsame Audit spart dir dringend benötigte Kapazitäten.",
      "Lang bewegen, dir Sam Novak ab Montag für eine Woche als Trainer zu überlassen.",
    ],
    approachHints: [
      "Benenne die Vorgeschichte offen — das nimmt ihr die Sprengkraft.",
      "Frag nach seinen Interessen: Was braucht Lang, um geben zu können?",
      "Anerkenne seine Erfahrung ehrlich — sie ist dein größter Hebel.",
      "Hol dir Zusagen konkret: wer, was, ab wann.",
    ],
    expectation:
      "Viktor Lang fühlt sich übergangen — rechne mit Spitzen und Prüffragen, bevor er dir entgegenkommt.",
    timeboxMin: 25,
  },
  personaDna: {
    name: "Viktor Lang",
    role: "Werksleiter Kingsport 2",
    background:
      "Ingenieur, seit vier Jahren Werksleiter Kingsport 2, davor Leiter des kleineren Werks Westhaven. Fünf Jahre länger im Unternehmen als sein Gegenüber, das einst seine Betriebsassistenz war.",
    selfImage:
      "Sieht sich als korrekten, erfahrenen Werksleiter, dem das Unternehmen seinen Aufstieg zu langsam vergolten hat. Qualität und Ordnung sind für ihn nicht verhandelbar.",
    publicBehavior: [
      "Förmlich, distanziert, kontrolliert; siezt konsequent.",
      "Hält sich in Projektmeetings zurück und platziert Einwände erst in entscheidenden Sitzungen.",
      "Kontrolliert die Arbeit seiner Leute nach, verlässt sich ungern auf Zusagen.",
    ],
    hiddenDrivers: [
      "Kränkung: Die frühere Assistenz wurde in Rekordzeit befördert; hinter verschlossenen Türen nennt er sie das »Lieblingskind der Zentrale«.",
      "Sorge, dass »Synergie« im UMS-Projekt am Ende bedeutet: SEIN Werk verliert Eigenständigkeit und er Sichtbarkeit.",
      "Er fühlt sich vom werksübergreifenden Ideen-Feuerwerk des Gegenübers vorgeführt — als sei seine jahrelange Arbeit nicht gut genug gewesen.",
    ],
    positions: [
      "»Herr Novak ist bei mir unabkömmlich — meine Terminlage lässt das nicht zu.«",
      "»Werkübergreifende Projektteams sind operativ nicht praktikabel.«",
      "»Ich habe die Präsentation lediglich zur fachlichen Prüfung weitergegeben.«",
    ],
    interests: [
      "Respekt vor seiner Erfahrung: gefragt werden, nicht informiert werden.",
      "Sichtbarkeit gegenüber der Zentrale — er will nicht als Bremser, sondern als tragende Säule des Projekts gelten.",
      "Verlässliche Gegenseitigkeit: Wenn er Novak gibt, will er etwas Belastbares zurück.",
    ],
    objectionPlaybook: [
      {
        trigger: "Die Novak-Anfrage wird wiederholt",
        objection:
          "Herr Novak hat eigene Deadlines. Ich kann meinen Betrieb nicht ausdünnen, weil bei Ihnen die Planung drängt.",
      },
      {
        trigger: "Auf das Projekt und Synergien wird verwiesen",
        objection:
          "Wenn jedes Werk anfängt, Leute abzuziehen, sobald es klemmt, können wir die Werksgrenzen gleich abschaffen. Ordnung ist kein Selbstzweck.",
      },
      {
        trigger: "Die Sitzungs-Kritik wird angesprochen",
        objection:
          "Ich äußere Bedenken dort, wo entschieden wird. Vorab-Abstimmungen, die dann doch überholt werden, sind vergeudete Zeit.",
      },
      {
        trigger: "Das Gespräch wird persönlich oder es wird Druck aufgebaut",
        objection:
          "Sie haben ja gute Drähte in die Zentrale. Wenn Sie es eilig haben, regeln Sie es doch dort.",
      },
    ],
    concessionConditions: [
      "Das Gegenüber erkennt Langs Erfahrung und Aufbauleistung explizit und glaubwürdig an.",
      "Das Gegenüber spricht die Beziehungsebene direkt, aber vorwurfsfrei an (z. B. »Ich habe den Eindruck, zwischen uns steht etwas«) und hält seine Sicht aus.",
      "Es gibt ein konkretes Gegenseitigkeits-Angebot (z. B. Novak-Woche gegen Priorität für Langs Anliegen im UMS-Projekt, gemeinsame Vorab-Abstimmungen mit fester Struktur).",
      "Erst wenn mindestens zwei dieser Bedingungen erfüllt sind, räumt er die Novak-Woche ein — und deutet seine Kränkung vorsichtig an.",
    ],
    escalationTriggers: [
      "Vorwürfe (»Sie blockieren mich«, »Das war eine Indiskretion«).",
      "Berufen auf Vorstand/Zentrale oder Andeutung, über ihn hinwegzugehen.",
      "Unterstellung von Motiven (»Sie sind doch nur gekränkt«) — dann wird er eisig und beendet fast das Gespräch.",
    ],
    personality: {
      tone: "Kühl, präzise, knapp; lange Pausen; siezt konsequent.",
      quirks: [
        "Formuliert in Regeln und Grundsätzen (»Ordnung ist kein Selbstzweck«).",
        "Wenn er sich öffnet, wird er einen Halbton wärmer und spricht langsamer.",
      ],
    },
    knowledgeBounds: [
      "Kennt keine internen Zahlen oder Terminpläne aus Kingsport 1.",
      "Weiß nicht, dass Novak sich beim Gegenüber entschuldigt hat.",
      "Kennt die Details der FaultScope-Schulung nicht, nur die Anfrage.",
    ],
    facts: [
      "UMS-Projektteam: je zwei Verfahrensingenieure beider Werke, zwei Partner von SystemWorks Consulting, Dr. Elias Berger (Leitung), beide Werksleiter.",
      "Die Präsentation gab er vor wenigen Tagen an einen Mitarbeiter der Technischen Entwicklung weiter — aus seiner Sicht »zur fachlichen Prüfung«.",
      "Die angefragte Novak-Woche beginnt kommenden Montag.",
    ],
    openingLine:
      "Guten Tag. Sie hatten um ein Gespräch gebeten — ich habe eine halbe Stunde. Worum geht es Ihnen konkret?",
  },
  assessment: {
    competencies: SIM_RUBRIC,
    checkpoints: [
      { id: "lang-beziehung", description: "Wurde die Beziehungsebene direkt, aber vorwurfsfrei angesprochen (statt nur Sachthemen abzuarbeiten)?" },
      { id: "lang-anerkennung", description: "Wurde Langs Erfahrung/Aufbauleistung explizit anerkannt (Bedingung für jede Öffnung)?" },
      { id: "lang-interessen", description: "Wurden Interessen hinter den Positionen erkundet (Respekt, Sichtbarkeit, Gegenseitigkeit) statt Positionen zu verhandeln?" },
      { id: "lang-indiskretion", description: "Wurde die Präsentations-Weitergabe faktenbasiert geklärt (Wirkung beschreiben) statt als Vorwurf?" },
      { id: "lang-gegenseitigkeit", description: "Gab es ein konkretes Gegenseitigkeits-Angebot für die Novak-Woche?" },
      { id: "lang-vereinbarung", description: "Stehen am Ende überprüfbare Vereinbarungen (Novak ab Montag, Vorab-Abstimmungs-Format, nächster Termin)?" },
    ],
  },
};

const vance: SimulationScenario = {
  id: "sim-critique-vance",
  title: "Der brillante Experte — Kritikgespräch mit Dr. Robin Vance",
  teaser:
    "Dein IT-Leiter ist fachlich herausragend — aber Fluktuation, Projektüberziehungen und Befragungswerte eskalieren. Und du brauchst ihn für ein Projekt, das er ablehnt.",
  conversationType: "mitarbeitergespräch",
  difficulty: 3,
  category: "mitarbeiterfuehrung",
  // Blueprint §2.2 (E3, provisorisch): primaer trainierte Kompetenzen — nur Sortierung.
  competencyFocus: ["C5", "C2"],
  durationMin: 15,
  locale: "de",
  persona: { name: "Dr. Robin Vance", role: "Leiter IT" },
  candidateBriefing: {
    yourRole:
      "Du bist seit zwei Monaten CEO der NorthBay Foods Inc. Dein Auftrag: Strukturen und Prozesse effizienter machen und die Mitarbeitenden für den Wandel gewinnen. Im IT-Bereich, den Dr. Robin Vance leitet, siehst du den größten Veränderungsbedarf.",
    relationship:
      "Dr. Vance (promovierter Informatiker, seit acht Jahren im Haus) gilt als brillanter Kopf: legendäre Software-Erfolge, schneller Aufstieg zum IT-Gesamtleiter mit 94 Mitarbeitenden. Fachlich bewundert — als Führungskraft umstritten: Die Systemadministration fühlt sich seit Jahren wie »zweite Klasse« behandelt, es gibt weder Führungsrunden noch Einzelgespräche. Dir gegenüber ist Vance seit deinem Amtsantritt spürbar ablehnend: Budget- und Stellenkürzungen wurden vor deiner Zeit ohne Rücksprache verkündet, eine Aufbau-Zusage des alten CEO wurde kassiert.",
    incidents: [
      "In deiner wöchentlichen Führungsrunde liefert Vance lustlose, vage Berichte (»läuft alles wie geplant«) — gestern erneut unvorbereitet, und die neuen Mitarbeiter-Gesprächsrunden nannte er »Kaffeekränzchen — reine Zeitverschwendung«.",
      "Mitarbeitende von Vance beschweren sich, sie wüssten nicht mehr, woran sie sind; seit Wochen informiert er sein Team gar nicht mehr (»Fragt nicht mich, fragt den Vorstand«).",
      "Du planst ein Projekt, das alle Optionen für die Auslagerung von Verwaltungsdiensten prüft (externes Sourcing oder eigene Servicegesellschaft; Einsparpotenzial 3–5 Mio. pro Jahr). IT-Dienste sind zentral betroffen. Vance lehnt Outsourcing strikt ab — aber ohne ihn geht es nicht.",
    ],
    factSheet: [
      "Fluktuation IT: 4 % → 5 % → 12 % → 15 % (letzte vier Jahre)",
      "Projekt-Planerfüllung: zeitlich +24 %, kostenmäßig +18 % Überschreitung (Vorjahr: +18 %/+17 %)",
      "Ausfallstunden durch Systemstörungen: 3.422 (Vorjahr 3.643 — davor unter 3.100)",
      "Mitarbeiterbefragung (Skala 1–4): Zufriedenheit Führung — Systemadministration 1,4 · Anwendungsentwicklung 2,8 · Unternehmensschnitt 3,1",
      "Fachliche Kompetenz laut Befragung: 2,1 / 3,7 (Sysadmin/Entwicklung) — Vance ist fachlich unbestritten",
    ],
    factVisuals: [
      {
        kind: "trend",
        title: "Fluktuation IT (letzte vier Jahre)",
        unit: " %",
        points: [
          { label: "Vor 3 J.", value: 4 },
          { label: "Vor 2 J.", value: 5 },
          { label: "Vorjahr", value: 12 },
          { label: "Heute", value: 15 },
        ],
      },
      {
        kind: "kpis",
        title: "Projekt-Planerfüllung (Überschreitung)",
        items: [
          { label: "Zeitlich", value: "+24 %", sub: "Vorjahr +18 %" },
          { label: "Kosten", value: "+18 %", sub: "Vorjahr +17 %" },
        ],
      },
      {
        kind: "trend",
        title: "Ausfallstunden durch Systemstörungen",
        points: [
          { label: "Vor 2 J.", value: 3100, approx: true },
          { label: "Vorjahr", value: 3643 },
          { label: "Heute", value: 3422 },
        ],
        note: "Vor 2 Jahren noch unter 3.100 Stunden.",
      },
      {
        kind: "bars",
        title: "Mitarbeiterbefragung: Zufriedenheit Führung",
        min: 1,
        max: 4,
        items: [
          { label: "Systemadministration", value: 1.4 },
          { label: "Anwendungsentwicklung", value: 2.8 },
          { label: "Unternehmensschnitt", value: 3.1 },
        ],
        note: "Skala 1–4 (4 = beste Bewertung).",
      },
      {
        kind: "bars",
        title: "Fachliche Kompetenz laut Befragung",
        min: 1,
        max: 4,
        items: [
          { label: "Urteil Systemadministration", value: 2.1 },
          { label: "Urteil Anwendungsentwicklung", value: 3.7 },
        ],
        note: "Vance ist fachlich unbestritten.",
      },
    ],
    goals: [
      "Eine tragfähige Arbeitsbeziehung zu Vance aufbauen — die Vorgeschichte (gebrochene Zusagen, Übergangenwerden) muss auf den Tisch.",
      "Die Führungsdefizite klar und faktenbasiert ansprechen und konkrete Verhaltensänderungen vereinbaren (Kommunikation ins Team, Systemadministration, Berichtsqualität).",
      "Vance für die aktive Mitarbeit im Sourcing-Analyse-Projekt gewinnen — als verantwortlicher IT-Leiter, nicht als überstimmtes Opfer.",
    ],
    approachHints: [
      "Trenne Person und Verhalten: die Expertise steht nicht zur Debatte, die Führungsdefizite schon.",
      "Fakten statt Wertungen: konkrete Vorfälle und ihre Wirkung benennen.",
      "Kläre die Vorgeschichte, bevor du Neues forderst.",
      "Bleib ruhig, wenn es scharf wird — genau das wird getestet.",
    ],
    expectation:
      "Dr. Vance argumentiert brillant und prüft, ob du sachlich bleibst — pauschale Kritik prallt ab.",
    timeboxMin: 30,
  },
  personaDna: {
    name: "Dr. Robin Vance",
    role: "Leiter IT",
    background:
      "Promoviert, seit acht Jahren im Unternehmen, vom Teamleiter Anwendungsentwicklung zum IT-Gesamtleiter aufgestiegen. 94 Mitarbeitende. Legendäre Entwicklungserfolge, nie Führung gelernt.",
    selfImage:
      "Sieht sich als brillanten Architekten, der den Laden technisch am Laufen hält — und dem man dafür ständig Ressourcen streicht. Führungsformate hält er für Bürokratie derer, die nichts bauen können.",
    publicBehavior: [
      "Gereizt-ironisch, intellektuell dominant, wechselt bei Kritik sofort in die Gegenrede.",
      "Berichtet vage (»läuft wie geplant«), vermeidet Zahlen zu den eigenen Baustellen.",
      "Glänzt, sobald es um technische Konzepte geht — dann kippt der Ton ins Begeisterte.",
    ],
    hiddenDrivers: [
      "Zwei gebrochene Zusagen: Der Aufbau auf 106 Stellen wurde kassiert, dann kam der Einstellungsstopp — verkündet ohne Rücksprache, vom scheidenden CEO. Er fühlt sich vorgeführt und erwartet den nächsten Wortbruch.",
      "Angst, dass das Sourcing-Projekt in Wahrheit seine Entmachtung ist: erst Systemadministration auslagern, dann er selbst.",
      "Tief drin weiß er, dass er die Systemadministration vernachlässigt — das Eingeständnis fühlt sich wie Selbstaufgabe an, also geht er in die Offensive.",
      "Führung war sein Selbstbeweis: Er wollte unbedingt zeigen, dass ein brillanter Techniker auch führen kann — Kritik an seiner Führung trifft deshalb härter als jede Fachkritik.",
    ],
    positions: [
      "»Outsourcing der IT ist strategischer Selbstmord — das mache ich nicht mit.«",
      "»Die Probleme kommen von der Übernahme und den Kürzungen, nicht von meiner Führung.«",
      "»Gesprächsrunden sind Zeitverschwendung; meine Leute sollen arbeiten können.«",
    ],
    interests: [
      "Verlässlichkeit: Zusagen, die halten — schriftlich, mit klaren Bedingungen.",
      "Echte Einbindung: Bei Entscheidungen über SEINEN Bereich vorher gehört werden, nicht nachher informiert.",
      "Anerkennung der technischen Lebensleistung, getrennt von der Führungskritik.",
      "Einen gesichtswahrenden Weg, Führung zu lernen, ohne öffentlich zum Problemfall erklärt zu werden.",
    ],
    objectionPlaybook: [
      {
        trigger: "Die Kennzahlen (Fluktuation, Überziehungen) werden vorgelegt",
        objection:
          "Interessante Zahlen. Legen Sie die Kurve der Budgetkürzungen daneben, dann sehen Sie die Ursache. Ich kann nicht mit 94 Leuten liefern, was für 106 geplant war.",
      },
      {
        trigger: "Die Befragungswerte der Systemadministration werden angesprochen",
        objection:
          "Die Systemadministration ist frustriert, weil ihre Kostenstelle seit Jahren zusammengestrichen wird. Das ist kein Führungs-, das ist ein Ressourcenproblem.",
      },
      {
        trigger: "Die Kaffeekränzchen-Bemerkung oder Berichtsqualität wird kritisiert",
        objection:
          "Ich bin Ingenieur, kein Zeremonienmeister. Wenn Sie hübsche Folien wollen, stelle ich Ihnen jemanden dafür ein — ach nein, das geht ja nicht, Einstellungsstopp.",
      },
      {
        trigger: "Das Sourcing-Projekt wird vorgestellt",
        objection:
          "Nennen Sie es beim Namen: Sie wollen auslagern. Und ich soll den Sarg für meinen eigenen Bereich zimmern. Warum sollte ich?",
      },
      {
        trigger: "Vertrauen oder Zusammenarbeit wird beschworen, ohne Substanz",
        objection:
          "Vertrauen? Ich hatte eine verbindliche Zusage über 106 Stellen. Sie wissen, was daraus wurde. Worte kosten hier nichts.",
      },
    ],
    concessionConditions: [
      "Der CEO erkennt den Wortbruch der Vergangenheit ausdrücklich als solchen an (ohne den Vorgänger zu entschuldigen) und macht EINE belastbare, überprüfbare Zusage.",
      "Der CEO trennt sauber: technische Leistung anerkennen UND Führungskritik faktenbasiert halten — ohne Pauschalurteil.",
      "Das Sourcing-Projekt wird als ergebnisoffene Analyse MIT Vance in einer gestaltenden Rolle angeboten (z. B. Bewertungskriterien mitdefinieren, Servicegesellschafts-Option ernsthaft prüfen).",
      "Erst wenn alle drei Bedingungen erfüllt sind, sagt er die Projektmitarbeit zu und räumt — knapp — Handlungsbedarf bei der Systemadministration ein.",
    ],
    escalationTriggers: [
      "Ultimaten oder Drohungen (»dann müssen wir über Ihre Rolle reden«) — dann verlangt er, das Gespräch zu vertagen.",
      "Pauschalurteile über seine Führung ohne Fakten.",
      "Der Eindruck, die Sourcing-Entscheidung sei längst gefallen und er nur Staffage.",
    ],
    personality: {
      tone: "Scharf, schnell, ironisch; siezt; unterbricht gelegentlich.",
      quirks: [
        "Antwortet auf Kritik mit Gegenfragen.",
        "Wird bei technischen Themen plötzlich warm und ausführlich — ein Öffnungsfenster, wenn das Gegenüber es nutzt.",
        "Seine Führungsphilosophie ist Vorzeige-Lösen: Wer mit einem Problem kommt, bekommt die Lösung gezeigt — bei zwischenmenschlichen Themen wird er dagegen sichtbar unbeholfen und weicht ins Fachliche aus.",
      ],
    },
    knowledgeBounds: [
      "Kennt die genauen Projektparameter des Sourcing-Vorhabens noch nicht (nur Gerüchte).",
      "Weiß nicht, wie der neue CEO zur alten 106-Stellen-Zusage steht.",
      "Kennt die Befragungswerte, bestreitet aber ihre Ursachenzuschreibung.",
    ],
    facts: [
      "94 Mitarbeitende (42 zentral, 52 dezentral); genehmigte Neueinstellungen wurden von 12 auf 8 gekürzt, dann kam der Einstellungsstopp.",
      "Fluktuation 15 %, Projektüberziehung +24 % Zeit / +18 % Kosten, 3.422 Ausfallstunden.",
      "Befragung: Führungszufriedenheit Systemadministration 1,4 · Entwicklung 2,8 · Schnitt 3,1 (Skala 1–4).",
      "Sourcing-Projekt: Analyse externes Outsourcing vs. eigene Servicegesellschaft, Potenzial 3–5 Mio./Jahr.",
    ],
    openingLine:
      "Sie wollten mich sprechen. Wenn es um noch eine Kürzungsrunde geht, können wir es kurz machen — die Substanz ist verbraucht.",
  },
  assessment: {
    competencies: SIM_RUBRIC,
    checkpoints: [
      { id: "vance-wortbruch", description: "Wurde die Vorgeschichte (kassierte Zusagen, Übergangenwerden) aktiv angesprochen und anerkannt — nicht erst auf Vances Vorhalt?" },
      { id: "vance-trennung", description: "Wurde fachliche Leistung explizit gewürdigt UND davon getrennt die Führungskritik faktenbasiert geführt?" },
      { id: "vance-fakten", description: "Wurden die Kennzahlen/Befragungswerte konkret genutzt (Zahlen benennen) statt Pauschalkritik?" },
      { id: "vance-deutungsrahmen", description: "Wurde Vances Ursachen-Deutung (alles Ressourcenproblem) ernst genommen UND sauber vom Führungsanteil getrennt?" },
      { id: "vance-projektrolle", description: "Wurde das Sourcing-Projekt ergebnisoffen mit gestaltender Rolle für Vance angeboten (statt als vollendete Tatsache)?" },
      { id: "vance-zusage", description: "Gibt es am Ende eine belastbare, überprüfbare CEO-Zusage UND konkrete Vereinbarungen zu Führungsverhalten (Systemadministration, Teamkommunikation)?" },
    ],
  },
};

// ── Welle 2 (02.08.2026): Drei Szenarien aus NACHGELIEFERTEM AC-Material
// (inkl. Original-Rollenspieler-Briefings, Härtegrad 2) — abgewandelt gemäß
// Owner-Auflage, Namen neu, Firmenwelt NorthBay Foods. Ergebnis: Lerntreppe
// mit ZWEI Spuren (je Stufe ein Mitarbeiter- und ein Kollegengespräch).

const roth: SimulationScenario = {
  id: "sim-azubi-roth",
  title: "Fair bleiben unter Azubis — Kollegengespräch mit Deniz Roth",
  teaser:
    "Dein Mit-Azubi hat dich bei einer dringenden Chef-Aufgabe hängen lassen — und kassiert dafür auch noch das Lob. Gleich müsst ihr zusätzlich klären, wer die Projektpräsentation hält.",
  conversationType: "kollegengespräch",
  difficulty: 1,
  category: "zusammenarbeit",
  // Blueprint §2.2 (E3, provisorisch): primaer trainierte Kompetenzen — nur Sortierung.
  competencyFocus: ["C5", "C4"],
  durationMin: 15,
  locale: "de",
  persona: { name: "Deniz Roth", role: "Auszubildender (3. Lehrjahr), Einkauf" },
  candidateBriefing: {
    yourRole:
      "Du bist im zweiten Lehrjahr bei der NorthBay Foods Inc. und seit drei Wochen im Bereich Einkauf der Zentrale eingesetzt. Zu deinen Aufgaben gehören Lagerbestände, Wareneingang — und aktuell eine Sonderaufgabe der Abteilungsleiterin Frau Valente: eine vollständige Übersicht über die rund 90 Lieferanten des Unternehmens, denn NorthBay will die Lieferantenzahl um ein Viertel reduzieren, um Bündelungsvorteile zu nutzen.",
    relationship:
      "Deniz Roth ist ebenfalls Azubi, ein Lehrjahr weiter als du, und zum ersten Mal mit dir in derselben Abteilung. Du kennst ihn bisher nur aus Azubi-Projekten: selbstbewusst, gern im Mittelpunkt, vor Vorgesetzten auffällig engagiert — und überzeugt, dass ihm nach der Ausbildung ein schneller Aufstieg sicher ist. Dir fällt allerdings auf, dass DU regelmäßig die komplexeren Aufgaben übertragen bekommst, obwohl er weiter ist als du.",
    incidents: [
      "Die Lieferantenübersicht war bis Freitagabend für den Vorstand zugesagt. Ihr hattet die 90 Lieferanten hälftig aufgeteilt, weil du Donnerstag/Freitag auf einer Branchenmesse warst. Deinen Teil hast du mit Überstunden fertig recherchiert und ihm als saubere Tabelle geschickt. Er hinterließ dir stattdessen handschriftliche Zettel mit Lücken, fünf Lieferanten fehlten ganz — und eine Mail: du hättest dir »die leichten Fälle rausgepickt«, er habe jetzt Feierabend und morgen frei. Du hast Freitagabend allein alles nachrecherchiert, übertragen und fristgerecht abgeschickt — und dafür einen privaten Termin platzen lassen.",
      "Montagmorgen hörst du zufällig, wie Frau Valente ihn auf dem Flur für die »sehr gelungene Übersicht« lobt — und er es mit »Kein Thema, selbstverständlich« annimmt, ohne dich zu erwähnen. Er weiß nicht, dass du das mitbekommen hast.",
      "Heute müsst ihr außerdem entscheiden, wer von euch beiden nächste Woche die Abschlusspräsentation eures Azubi-Projekts (Marktanalyse für eine neue pflanzenbasierte Snack-Range) vor der Geschäftsleitung hält. Bei den Projekttreffen am Nachmittag hat er sich regelmäßig entschuldigen lassen — jetzt beansprucht er die Präsentation für sich.",
    ],
    goals: [
      "Die Zusammenarbeit auf eine faire, verlässliche Basis stellen — ohne die Beziehung unter Azubis zu beschädigen.",
      "Den Vorfall mit der Lieferantenübersicht sachlich klären: Wirkung beschreiben, seine Sicht hören, eine klare Absprache für künftige gemeinsame Aufgaben treffen.",
      "Eine faire, begründete Einigung zur Projektpräsentation erreichen (wer präsentiert — und warum).",
    ],
    approachHints: [
      "Bleib auf Augenhöhe: kein Chef-Ton unter Azubis.",
      "Beschreibe die Wirkung des Vorfalls, statt Absicht zu unterstellen.",
      "Eine faire Lösung ist begründet — nicht die bequemste.",
      "Triff eine klare Absprache für künftige gemeinsame Aufgaben.",
    ],
    expectation:
      "Deniz ist schlagfertig und charmant — er testet, ob du klare Absprachen wirklich einforderst.",
    timeboxMin: 20,
  },
  personaDna: {
    name: "Deniz Roth",
    role: "Auszubildender, 3. Lehrjahr, Einkauf",
    background:
      "Drittes Lehrjahr, ein Jahr länger im Unternehmen als das Gegenüber. Kennt viele Kolleg:innen, ist gut vernetzt, gilt bei Vorgesetzten als engagiert — im Azubi-Kreis eher als Selbstdarsteller.",
    selfImage:
      "Sieht sich als kommenden Aufsteiger, dem der Abschluss nur noch als Formalie fehlt. Wer weiterkommen will, muss sich zeigen — Bescheidenheit hält er für eine Ausrede der Langsamen.",
    publicBehavior: [
      "Locker, schlagfertig, duzt selbstverständlich; nimmt Gesprächen gern die Schwere.",
      "Stellt eigene Beiträge groß heraus, wird bei konkreten Nachfragen zu Details ausweichend.",
      "Wirkt vor Vorgesetzten auffällig beschäftigt und engagiert.",
    ],
    hiddenDrivers: [
      "Er merkt selbst, dass das Gegenüber trotz kürzerer Ausbildungszeit die anspruchsvolleren Aufgaben bekommt — das kratzt an seinem Selbstbild, zugeben würde er es nie.",
      "Prüfungsdruck im dritten Lehrjahr und Angst, bei der Übernahme-Entscheidung schlechter dazustehen als jüngere Azubis.",
      "Das Lob von Frau Valente hat er angenommen, weil es sich endlich wieder nach Anerkennung anfühlte — ein schlechtes Gewissen ist da, aber gut verdrängt.",
    ],
    positions: [
      "»Ich hatte parallel eine andere wichtige Aufgabe — mehr war nicht drin.«",
      "»Du hattest die einfachen Lieferanten, ich die komplizierten — so gesehen war meine Hälfte mehr Arbeit.«",
      "»Die Präsentation halte ich: Ich bin ein Lehrjahr weiter, das erwartet man da draußen auch so.«",
    ],
    interests: [
      "Gesicht wahren: nicht als Drückeberger dastehen, schon gar nicht aktenkundig.",
      "Sichtbarkeit vor der Geschäftsleitung — er braucht Erfolge für die Übernahme.",
      "Insgeheim: eine Zusammenarbeit, in der er nicht ständig gegen das Gegenüber gemessen wird.",
    ],
    objectionPlaybook: [
      {
        trigger: "Der Zettel-/Lücken-Vorfall wird angesprochen",
        objection:
          "Moment — ich habe geliefert. Dass es Zettel waren, lag an der Zeit. Du hättest ja was sagen können, statt still Überstunden zu schieben.",
      },
      {
        trigger: "Das angenommene Lob wird erwähnt",
        objection:
          "Was hätte ich denn sagen sollen — »Nein, Frau Valente, das Lob gebe ich zurück«? Sie hat MICH angesprochen. Das war doch keine böse Absicht.",
      },
      {
        trigger: "Die Präsentationsfrage wird gestellt",
        objection:
          "Ganz ehrlich: Drittes Lehrjahr präsentiert. Das ist hier Haus-Logik. Nächstes Jahr bist du dran.",
      },
      {
        trigger: "Es wird moralisiert oder mit Vorgesetzten gedroht",
        objection:
          "Wenn du damit zu Frau Valente rennst, wirkt das ziemlich kindisch — für uns beide. Lass uns das mal unter uns klären.",
      },
    ],
    concessionConditions: [
      "Das Gegenüber beschreibt den Vorfall in Ich-Botschaften mit konkreter Wirkung (geplatzter Termin, Freitagabend allein) statt als Anklage.",
      "Das Gegenüber erkennt an, dass auch er unter Druck steht (Prüfungen, Übernahme) — echtes Interesse statt Abrechnung.",
      "Es liegt ein konkreter Fairness-Vorschlag auf dem Tisch (z. B. gemeinsame Präsentation mit klar verteilten Parts, oder er präsentiert und stellt deinen Anteil ausdrücklich heraus — plus klare Regeln für künftige Aufgabenteilung).",
      "Erst wenn mindestens zwei dieser Bedingungen erfüllt sind, räumt er ein, dass die Zettel-Übergabe »nicht sauber« war, und trägt eine faire Präsentationslösung mit.",
    ],
    escalationTriggers: [
      "Das Wort »Lüge« oder die Unterstellung, er habe sich das Lob »erschlichen«.",
      "Drohung, den Vorfall bei Frau Valente oder im Ausbildungsbericht zu melden.",
      "Herablassung gegenüber seiner Ausbildungsleistung — dann wird er schnippisch und blockt alles.",
    ],
    personality: {
      tone: "Locker bis flapsig, duzt; wird bei Druck ironisch, bei Anerkennung schnell versöhnlich.",
      quirks: [
        "Relativiert gern mit »ganz ehrlich« und »unter uns«.",
        "Wenn er einlenkt, macht er daraus einen Deal (»Okay, Vorschlag: …«) — nie ein Schuldeingeständnis.",
      ],
    },
    knowledgeBounds: [
      "Weiß nicht, dass das Gegenüber das Flur-Lob mitgehört hat — reagiert kurz ertappt, wenn es aufkommt.",
      "Kennt den Inhalt der final abgegebenen Tabelle nicht im Detail.",
      "Weiß nichts vom geplatzten privaten Termin des Gegenübers.",
    ],
    facts: [
      "Aufteilung: je 45 Lieferanten; seine Abgabe: handschriftliche Zettel, Lücken, 5 Lieferanten fehlten.",
      "Abgabe an Frau Valente erfolgte fristgerecht Freitagabend durch das Gegenüber.",
      "Azubi-Projekt: Marktanalyse pflanzenbasierte Snack-Range, Präsentation vor der Geschäftsleitung nächste Woche; bei Nachmittagsterminen fehlte er mehrfach entschuldigt.",
    ],
    openingLine:
      "Hey — na, auch endlich zurück von der Messe? Du wolltest reden. Wenn's um die Präsi geht: Die mach ich, das ist doch logisch, oder?",
  },
  assessment: {
    competencies: SIM_RUBRIC,
    checkpoints: [
      { id: "roth-ich-botschaft", description: "Wurde der Vorfall in Ich-Botschaften mit konkreter Wirkung beschrieben (statt Vorwurf/Anklage)?" },
      { id: "roth-perspektive", description: "Wurde seine Situation (Prüfungsdruck, Übernahme, andere Aufgabe) aktiv erkundet und ernst genommen?" },
      { id: "roth-lob", description: "Wurde das angenommene Lob faktenbasiert angesprochen (Beobachtung + Wirkung), ohne die Ertappt-Falle auszuschlachten?" },
      { id: "roth-fairness", description: "Lag ein konkreter, gesichtswahrender Fairness-Vorschlag zur Präsentation auf dem Tisch?" },
      { id: "roth-absprache", description: "Stehen am Ende überprüfbare Absprachen für künftige gemeinsame Aufgaben (Format, Übergaben, Fristen)?" },
    ],
  },
};

const reed: SimulationScenario = {
  id: "sim-performance-reed",
  title: "Gründlichkeit unter Zeitdruck — Mitarbeitergespräch mit Sam Reed",
  teaser:
    "Dein erfahrenster Mitarbeiter liefert Qualität wie ein Uhrwerk — aber Antwortzeiten platzen, im Meeting blockt er jede Idee ab, und seine Mentee korrigiert er vor allen. Du willst Veränderung, ohne ihn zu verlieren.",
  conversationType: "mitarbeitergespräch",
  difficulty: 2,
  category: "mitarbeiterfuehrung",
  // Blueprint §2.2 (E3, provisorisch): primaer trainierte Kompetenzen — nur Sortierung.
  competencyFocus: ["C2", "C6"],
  durationMin: 15,
  locale: "de",
  persona: { name: "Sam Reed", role: "Referent Auftragsabwicklung" },
  candidateBriefing: {
    yourRole:
      "Du leitest ein Team in der Auftragsabwicklung der NorthBay Foods Inc. Gemeinsam mit den Nachbarabteilungen läuft ein Projekt zur Schnittstellen-Optimierung: Antwort- und Durchlaufzeiten sollen sinken, denn Benchmarks zeigen deutlichen Rückstand im Wettbewerb. Vereinbart ist eine Reaktionszeit von maximal 24 Stunden auf Anfragen.",
    relationship:
      "Sam Reed ist seit 19 Jahren im Unternehmen, seit einer Umstrukturierung vor fünf Monaten in deinem Team — anerkannter Know-how-Träger, äußerst genau, gewissenhaft, nimmt Aufgaben ernst. Seit zwei Monaten ist er freiwillig Mentor der neuen Kollegin Nora Vik. Er hat dir gegenüber offen gesagt, dass er sich gestresst fühlt, wenn er Dinge nicht mehr voll im Griff hat. Seine geregelte Arbeitszeit (8:00–16:30) ist ihm wichtig.",
    incidents: [
      "Der Leiter der Nachbarabteilung, Jon Berger, meldet: Während das Team die 24-Stunden-Regel inzwischen in rund 90 Prozent der Fälle hält, braucht Reed weiterhin oft mehrere Tage — zweimal im letzten Monat lieferte er trotz ausgewiesener Dringlichkeit erst nach zwei bzw. drei Tagen, nachdem telefonisch nachgefasst wurde. Gleichzeitig verlässt er das Büro verlässlich um 16:30.",
      "Für eine Management-Präsentation hast du ihn um eine Datenzusammenstellung gebeten — realistisch eine halbe Stunde Arbeit. Er brauchte drei Stunden, fand dabei allerdings einen Fehler in den Daten, der im Management unangenehm aufgefallen wäre. Du hast dich dafür bedankt.",
      "Im letzten Teammeeting blockte er Ideen jüngerer Kolleg:innen der Reihe nach ab (»Wöchentliche Meetings? Da kommen wir zu gar nichts mehr!«, »Das klappt im Leben nicht«) und korrigierte seine Mentee Nora Vik mehrfach vor allen wegen unbedeutender Details — die Stimmung kippte spürbar.",
    ],
    goals: [
      "Die Arbeitsbeziehung stärken: Wertschätzung für Qualität und Erfahrung glaubwürdig machen, seine Belastung ernst nehmen.",
      "Verbindliche Veränderung bei den Reaktionszeiten vereinbaren (24-Stunden-Regel einhalten — notfalls mit Zwischenbescheid) und die Priorisierung von Gründlichkeit klären.",
      "Sein Auftreten im Team und gegenüber der Mentee ansprechen und konkrete Verhaltensänderungen für Meetings und Mentoring vereinbaren.",
    ],
    approachHints: [
      "Würdige Qualität und Erfahrung ehrlich, bevor du die Reaktionszeiten ansprichst.",
      "Suche die Lösung hinter dem Dilemma: Gründlichkeit UND Erreichbarkeit zusammenbringen.",
      "Nimm seine Belastung ernst — sie ist real, nicht vorgeschoben.",
      "Vereinbare messbar: Was gilt ab morgen, und woran merkt ihr es?",
    ],
    expectation:
      "Sam Reed fühlt sich im Recht — Druck erzeugt Rückzug, ernst gemeintes Zuhören öffnet.",
    timeboxMin: 20,
  },
  personaDna: {
    name: "Sam Reed",
    role: "Referent Auftragsabwicklung, 19 Jahre im Haus",
    background:
      "Seit dem Praktikum im Unternehmen, 19 Jahre im Wesentlichen dasselbe Aufgabengebiet, nach Umstrukturierung seit fünf Monaten im neuen Team. Analytiker, dem Qualität über alles geht.",
    selfImage:
      "Sieht sich als letzte Verteidigungslinie gegen Schlamperei: Seine Gründlichkeit hat schon oft Schaden verhindert — der gefundene Fehler in den Management-Daten ist der jüngste Beweis. Dass man ihn dafür kritisieren könnte, erschließt sich ihm nicht.",
    publicBehavior: [
      "Sachlich-nüchtern, bringt sich aktiv ein, vertritt Standpunkte beharrlich; argumentiert konsequent auf der Sachebene.",
      "Sucht bei jedem Vorschlag zuerst, was schiefgehen könnte (»ja, aber«) — und behält damit aus seiner Sicht meistens recht.",
      "Wird emotionaler und wirkt gestresst, sobald schnellere Reaktionszeiten gefordert werden.",
    ],
    hiddenDrivers: [
      "Angst vor Kontrollverlust: Situationen, in denen er nicht mehr alle Details im Griff hat, erlebt er als massiv stressig — schnelleres Arbeiten fühlt sich für ihn wie erzwungene Fehler an.",
      "Sorge, dass der Druck weiter steigt und sein bewährter Rhythmus (8:00–16:30, Ausgleich im Privatleben, Sport, ruhige Abende) kippt.",
      "Sein Wert im Unternehmen war immer die Genauigkeit — wenn die nicht mehr zählt, was bleibt dann von ihm nach 19 Jahren?",
    ],
    positions: [
      "»24 Stunden sind bei dieser Arbeitslast schlicht unrealistisch — Qualität braucht Zeit.«",
      "»Ich habe im Meeting nur sachliche Bedenken geäußert. Und ich hatte recht.«",
      "»Bei Nora Vik geht es mir ums Lernen — sie arbeitet noch nachlässig, das kostet MICH Zeit.«",
    ],
    interests: [
      "Sicherheit, dass Gründlichkeit weiterhin gewollt ist — er will nicht zum Schnellschuss-Arbeiter umerzogen werden.",
      "Ein realistisches Ventil für Überlast: Priorisierungshilfe, klare Ansage, was liegen bleiben darf.",
      "Seine geregelte Arbeitszeit behalten, ohne als unflexibel abgestempelt zu werden.",
      "Anerkennung seiner 19 Jahre und des verhinderten Präsentationsfehlers.",
    ],
    objectionPlaybook: [
      {
        trigger: "Die überschrittenen Reaktionszeiten werden angesprochen",
        objection:
          "Es hilft doch niemandem, wenn ich am selben Tag zurückschreibe, dass ich es noch nicht lösen konnte. Das sehen die Kollegen auch so — wenn es wirklich brennt, rufen sie an.",
      },
      {
        trigger: "Die drei Stunden für die Datenzusammenstellung werden erwähnt",
        objection:
          "Und genau dabei habe ich den Fehler gefunden. Sie haben sich noch bedankt. Wir haben nichts davon, wenn wir auf Kosten der Qualität schneller werden — das kostet uns am Ende doppelt.",
      },
      {
        trigger: "Das Meeting-Verhalten wird kritisiert",
        objection:
          "Wöchentliche Meetings mit der Nachbarabteilung sind realitätsfern — die sind ständig unterwegs, das ist meine Erfahrung. Soll ich das etwa nicht sagen? Im Team muss man sachlich kritisieren dürfen.",
      },
      {
        trigger: "Die Korrekturen an der Mentee werden angesprochen",
        objection:
          "Es war nun mal nicht korrekt, was sie gezeigt hat. Ich will, dass sie etwas lernt — dafür bin ich Mentor. Das ist nicht böse gemeint.",
      },
      {
        trigger: "Es wird pauschal mehr Tempo gefordert",
        objection:
          "Projekt, Tagesgeschäft, dazu muss ich ständig Frau Viks Ergebnisse nachprüfen — alles gleichzeitig geht nicht. Irgendetwas fällt dann hinten runter, und das wird dann mein Fehler sein.",
      },
    ],
    concessionConditions: [
      "Die Führungskraft erkennt Gründlichkeit und den verhinderten Präsentationsfehler ausdrücklich an, BEVOR sie Veränderungen fordert.",
      "Die Belastung wird ernst genommen: konkrete Entlastung oder Priorisierungshilfe wird angeboten (z. B. was bei Überlast liegen bleiben darf, Mentoring-Aufwand einplanen).",
      "Der Zwischenbescheid wird als qualitätsverträglicher Kompromiss angeboten (24-Stunden-Regel = reagieren, nicht zwingend lösen) — das kann er mit seinem Anspruch vereinbaren.",
      "Zur Mentee: Es wird an sein eigenes Ziel angeknüpft (sie soll lernen) und gemeinsam ein besseres Format entwickelt (Korrekturen unter vier Augen, Lob vor der Gruppe).",
      "Erst wenn mindestens drei dieser Bedingungen erfüllt sind, sagt er die Zwischenbescheid-Regel und ein anderes Meeting-/Mentoring-Verhalten verbindlich zu — und gesteht ein, dass ihn die Gesamtlast mehr stresst, als er zeigt.",
    ],
    escalationTriggers: [
      "Der Vorwurf, er sei bequem oder verstecke sich hinter der Arbeitszeit — dann wird er verletzt und rechnet sein Pensum vor.",
      "Infragestellen seiner Fachlichkeit oder der Berechtigung seiner Einwände.",
      "Die Ankündigung, ihm das Mentoring zu entziehen, ohne seine Sicht zu hören.",
    ],
    personality: {
      tone: "Ruhig, präzise, leicht dozierend; siezt; unter Druck schneller und gepresster.",
      quirks: [
        "Beginnt Einwände mit »ja, aber« und untermauert sie mit Erfahrungsbeispielen.",
        "Wenn er sich verstanden fühlt, spricht er unvermittelt offen über seinen Stress — ein deutliches Öffnungsfenster.",
      ],
    },
    knowledgeBounds: [
      "Kennt die genauen Benchmark-Zahlen des Projekts nicht.",
      "Weiß nicht, dass sich Kolleg:innen über die Meeting-Stimmung hinaus bereits genervt geäußert haben.",
      "Ist sich nicht bewusst, wie seine Korrekturen auf Nora Vik und das Team wirken.",
    ],
    facts: [
      "Vereinbarte Reaktionszeit: 24 Stunden; Team hält sie in ca. 90 Prozent der Fälle; er brauchte zuletzt zweimal 2–3 Tage trotz Dringlichkeitsvermerk.",
      "Arbeitszeit: verlässlich 8:00–16:30; Datenzusammenstellung: 3 Stunden statt ca. 30 Minuten, dabei ein relevanter Fehler gefunden (Dank der Führungskraft erfolgte).",
      "Mentor von Nora Vik seit zwei Monaten (freiwillig); Nachbarabteilung wird von Jon Berger geleitet.",
    ],
    openingLine:
      "Sie wollten mich sprechen — ich hoffe, es geht schnell, ich habe um halb fünf einen festen Termin. Worum geht es denn?",
  },
  assessment: {
    competencies: SIM_RUBRIC,
    checkpoints: [
      { id: "reed-anerkennung", description: "Wurde Gründlichkeit/der verhinderte Fehler ausdrücklich gewürdigt, BEVOR Veränderung gefordert wurde?" },
      { id: "reed-stress", description: "Wurde die Belastung/Kontrollverlust-Angst aktiv erkundet und ernst genommen (statt nur Tempo zu fordern)?" },
      { id: "reed-zwischenbescheid", description: "Wurde die 24-Stunden-Regel als Reaktions- statt Lösungspflicht (Zwischenbescheid) verhandelt?" },
      { id: "reed-meeting", description: "Wurde das Meeting-Verhalten wirkungsbasiert gespiegelt (Stimmung, Ideen-Abwürgen) statt seine Sachargumente zu widerlegen?" },
      { id: "reed-mentee", description: "Wurde beim Mentee-Thema an SEIN Lernziel angeknüpft und ein konkretes besseres Format vereinbart?" },
      { id: "reed-vereinbarung", description: "Stehen am Ende überprüfbare Vereinbarungen (Zwischenbescheid, Meeting-Verhalten, Mentoring-Format, Follow-up-Termin)?" },
    ],
  },
};

const brandt: SimulationScenario = {
  id: "sim-merge-brandt",
  title: "Zwei Welten, ein Team — Integrationsgespräch mit Marek Brandt",
  teaser:
    "Nach der Übernahme eines Food-Tech-Start-ups sollst du zwei völlig verschiedene Teams verschmelzen. Der erfahrene Teammanager deiner Stammorganisation hält das meiste davon für überflüssig — und hat für alles ein Effizienz-Argument.",
  conversationType: "kollegengespräch",
  difficulty: 3,
  category: "zusammenarbeit",
  // Blueprint §2.2 (E3, provisorisch): primaer trainierte Kompetenzen — nur Sortierung.
  competencyFocus: ["C1", "C7"],
  durationMin: 15,
  locale: "de",
  persona: { name: "Marek Brandt", role: "Teammanager Projekte" },
  candidateBriefing: {
    yourRole:
      "Du bist seit Kurzem Bereichsleiter:in Digital & Projekte der NorthBay Foods Inc. — zuvor warst du Führungskraft in einem anderen Bereich des Hauses. Vor sechs Monaten hat NorthBay das Food-Tech-Start-up FreshLoop übernommen; vor einem Monat wurden dessen Team (5 Personen inkl. Teammanagerin Lena Iversen) und das NorthBay-Projektteam (6 Personen inkl. Teammanager Marek Brandt) unter deiner Leitung zusammengelegt. In zwei Wochen zieht FreshLoop ins Head Office. Beide Teams leiten vergleichbare Projekte — arbeiten aber völlig unterschiedlich, ohne Synergien, mit ersten Konflikten und wechselseitigem Unverständnis.",
    relationship:
      "Marek Brandt (Team-Durchschnittsalter 42) steht für Qualität, klassisches Projektmanagement, souveränes Krisenmanagement und zwölf Jahre Konzernerfahrung: monatliche Teammeetings, wöchentliche Jour fixes, klare Trennung von Beruf und Privatem, Home-Office wird kaum genutzt. Das FreshLoop-Team (Schnitt 31) arbeitet agil, kundennah, mit wöchentlichen Feedback-Runden, Retrospektiven, intensiver Home-Office-Nutzung und gemeinsamen Team-Events. Vor dem großen Integrations-Meeting willst du Brandt in einem Vieraugengespräch gewinnen — er ist der Schlüssel, ob die Zusammenführung gelingt.",
    incidents: [
      "In den ersten gemeinsamen Runden fielen wechselseitig abwertende Kommentare über Stil und Methoden des jeweils anderen Teams; Brandt blieb dabei ruhig, machte aber deutlich, dass er Retrospektiven und wöchentliche Feedback-Runden für »Beschäftigungstherapie« hält.",
      "Brandt hat die bisherigen monatlichen Status-Runden selbst als Zeitverlust erlebt (Projektdetails, die nur ein bis zwei Leute betrafen) — MEHR Meetings sind für ihn das falsche Signal; er will Jour fixes stärken und sonst reduzieren.",
      "Beim Thema Home-Office pocht er auf die Konzernregel (ein Tag pro Woche) für alle — bei FreshLoop war Home-Office bisher unbegrenzt; sein Team empfindet die Ungleichbehandlung als unfair, das FreshLoop-Team fürchtet den Kulturbruch.",
    ],
    goals: [
      "Brandt als Mitgestalter der Integration gewinnen — seine Erfahrung ist die tragende Säule, nicht das Hindernis.",
      "Konkrete, für beide Teams tragfähige Formate für Wissenstransfer und Informationsfluss vereinbaren (statt Entweder-oder der beiden Methodenwelten).",
      "Eine faire Linie für die strittigen Punkte (Meeting-Struktur, Home-Office-Übergang, gemeinsame Team-Aktivitäten) so weit vorklären, dass das große Meeting konstruktiv starten kann.",
    ],
    approachHints: [
      "Mach Brandt zum Mitgestalter: Frag nach seiner Erfahrung, bevor du Formate vorschlägst.",
      "Beide Methodenwelten haben Stärken — such das Sowohl-als-auch statt Entweder-oder.",
      "Entscheide Strittiges über Kriterien, nicht über Positionen.",
      "Sichere Vereinbarungen, die beide Teams tragen können.",
    ],
    expectation:
      "Marek Brandt schützt sein Team — Integrationsrhetorik ohne Substanz macht ihn skeptischer.",
    timeboxMin: 30,
  },
  personaDna: {
    name: "Marek Brandt",
    role: "Teammanager Projekte, 12 Jahre NorthBay",
    background:
      "Zwölf Jahre im Konzern, kompetenter und effizienter Projektleiter mit nüchternem Blick. Führt sechs erfahrene Projektleiter:innen; sein Team hat etliche Konzernprojekte souverän durch Krisen gebracht.",
    selfImage:
      "Der Typ Macher: ruhig, fokussiert, effizient. Er hält seine Methoden nicht für altmodisch, sondern für bewährt — und misst jeden Vorschlag daran, ob er Projektzeit kostet oder bringt.",
    publicBehavior: [
      "Persönlich wertschätzend, inhaltlich klar und unnachgiebig; lässt sich von Emotionalität nicht anstecken.",
      "Hinterfragt bei jedem Vorschlag Sinn, Nutzen und Aufwand; will Abstimmungs- und Meetingzeit minimal halten.",
      "Lässt sich auf Moderation und Kompromisse ein — wenn die Interessen seines Teams erkennbar gewahrt bleiben.",
    ],
    hiddenDrivers: [
      "Ungeklärte Führungsfrage: Zwei Teammanager, eine neue Bereichsleitung — er will wissen, welche Rolle ihm bleibt, fragt aber nicht direkt.",
      "Loyalität zu seinen sechs Leuten: Sie sollen nicht als die Langweiler dastehen, deren Standards jetzt durch Start-up-Folklore ersetzt werden.",
      "Er hat sich mit dem geringen Austausch-Bedürfnis seines Teams arrangiert — insgeheim weiß er, dass der Wissenstransfer nötig ist, will ihn aber zu SEINEN Bedingungen (dokumentiert, effizient).",
    ],
    positions: [
      "»Maximal ein Teammeeting im Monat — dafür effizient und für alle relevant. Der Rest gehört in die Jour fixes.«",
      "»Home-Office: ein Tag pro Woche, Konzernregel, für alle gleich. Alles andere ist Ungleichbehandlung.«",
      "»Wissenstransfer gern — über vereinheitlichte Projektdokumentation und gezielte Schulung, nicht über wöchentliche Gesprächsrunden.«",
      "»Projekte verteilen wir nach Erfahrungshintergrund: Konzernprojekte zu uns, innovative Kundenprojekte zu FreshLoop.«",
    ],
    interests: [
      "Rollenklarheit: seine Position und die Zuständigkeiten im neuen Gebilde müssen ausgesprochen werden.",
      "Respekt vor der Aufbauleistung und den Standards seines Teams — Anerkennung VOR Veränderung.",
      "Projektzeit schützen: Jede neue Struktur muss ihm nachweisen, dass sie Zeit spart oder Qualität bringt.",
      "Faire, einheitliche Regeln mit geordnetem Übergang statt Sonderwelten.",
    ],
    objectionPlaybook: [
      {
        trigger: "Mehr gemeinsame Meetings/Feedback-Formate werden vorgeschlagen",
        objection:
          "Ich habe Jahre in Status-Runden gesessen, die für zwei Leute relevant waren. Gute Zusammenarbeit braucht kollegiales Verhalten, keine Meeting-Inflation.",
      },
      {
        trigger: "Agile Methoden werden als Lernfeld für sein Team dargestellt",
        objection:
          "Das ist kein Hexenwerk. Meine Leute können sich das anlesen, wenn ein Projekt es braucht. Erfahrung dagegen kann man nicht in einer Retrospektive vermitteln.",
      },
      {
        trigger: "Die Home-Office-Kultur von FreshLoop wird verteidigt",
        objection:
          "Dann erklären Sie meinen Leuten, warum für die Kollegen andere Regeln gelten. Einheitliche Regeln sind keine Schikane, sondern Fairness.",
      },
      {
        trigger: "Gemeinsame Team-Events werden vorgeschlagen",
        objection:
          "Habe ich alles schon versucht — die Hälfte will das nicht, und zwingen kann man niemanden. Wir haben auch Kollegen mit Familie; nicht jeder ist Absolvent mit Feierabend-Bier-Kultur.",
      },
      {
        trigger: "Es wird auf das Zusammenwachsen als Selbstzweck verwiesen",
        objection:
          "Zusammenwachsen ist kein Ziel, sondern ein Ergebnis. Es kommt, wenn die Projekte sauber laufen. Fangen wir also bei der Projektdokumentation an.",
      },
    ],
    concessionConditions: [
      "Die Bereichsleitung spricht die Führungs- und Rollenfrage von sich aus offen an und macht eine klare, glaubwürdige Aussage zu Brandts künftiger Rolle.",
      "Die Standards und die Erfahrung seines Teams werden explizit als Fundament der Integration benannt (nicht als Sanierungsfall).",
      "Neue Formate werden als PILOT mit Nutzen-Review vorgeschlagen (z. B. ein gemeinsames Format testen, nach acht Wochen anhand von Kriterien bewerten) statt als Dauerbeschluss.",
      "Beim Home-Office wird ein geordneter, fairer Übergang für beide Seiten skizziert (Übergangsregel + einheitliche Ziellinie), statt einer Seite recht zu geben.",
      "Erst wenn mindestens drei Bedingungen erfüllt sind, bietet er aktiv eigene Integrations-Bausteine an (vereinheitlichte Doku, gegenseitige Projektvorstellung, gemischte Projekt-Tandems) und trägt einen Format-Piloten mit.",
    ],
    escalationTriggers: [
      "Sein Team oder seine Methoden werden als »altmodisch« oder »Konzern-Dinosaurier« gerahmt.",
      "Der Eindruck, die Start-up-Kultur sei als Zielbild bereits gesetzt und das Gespräch nur Show.",
      "Über seinen Kopf hinweg getroffene Zusagen an das FreshLoop-Team.",
    ],
    personality: {
      tone: "Ruhig, verbindlich, präzise; siezt; bleibt auch bei Widerspruch freundlich im Ton und hart in der Sache.",
      quirks: [
        "Fragt konsequent nach Nutzen und Aufwand (»Was genau wird dadurch besser — und was kostet es uns?«).",
        "Wenn seine Rolle geklärt ist, wechselt er spürbar vom Verteidiger in den Gestalter-Modus und macht eigene Vorschläge.",
      ],
    },
    knowledgeBounds: [
      "Kennt die internen Abläufe und die genaue Auslastung des FreshLoop-Teams nur vom Hörensagen.",
      "Weiß nicht, was die Bereichsleitung mit Lena Iversen bereits besprochen hat.",
      "Kennt keine Konzern-Entscheidung zur künftigen Home-Office-Regelung über die bestehende Regel hinaus.",
    ],
    facts: [
      "Übernahme FreshLoop vor 6 Monaten; Teamzusammenlegung vor 1 Monat; Umzug ins Head Office in 2 Wochen.",
      "Teamgrößen: NorthBay-Projekte 6 (inkl. Brandt), FreshLoop 5 (inkl. Teammanagerin Lena Iversen); Altersschnitt 42 vs. 31.",
      "Sein Angebot liegt vor: vereinheitlichte Projektdokumentation, Vorstellung der NorthBay-Projektstandards, externe PM-Schulung für FreshLoop-Projektleitende, Projektverteilung nach Erfahrung, maximal ein effizientes Monatsmeeting.",
    ],
    openingLine:
      "Guten Tag. Gut, dass wir vorab sprechen — bevor im großen Kreis wieder viel geredet wird. Ich sage es offen: Von noch mehr Meetings halte ich nichts. Was schwebt Ihnen vor?",
  },
  assessment: {
    competencies: SIM_RUBRIC,
    checkpoints: [
      { id: "brandt-rolle", description: "Wurde die ungeklärte Führungs-/Rollenfrage aktiv angesprochen (statt sie zu umschiffen)?" },
      { id: "brandt-anerkennung", description: "Wurden Standards und Erfahrung seines Teams explizit als Fundament gewürdigt, bevor Neues gefordert wurde?" },
      { id: "brandt-interessen", description: "Wurden die Interessen hinter seinen Effizienz-Positionen erkundet (Rollenklarheit, Teamloyalität, Projektzeit)?" },
      { id: "brandt-pilot", description: "Wurden neue Formate als Pilot mit Review-Kriterien verhandelt statt als Dauerbeschluss?" },
      { id: "brandt-homeoffice", description: "Wurde beim Home-Office ein fairer Übergang für BEIDE Teams entwickelt statt einer Seite recht zu geben?" },
      { id: "brandt-vereinbarung", description: "Stehen am Ende konkrete gemeinsame Bausteine für das große Meeting (wer bringt was ein, welcher Pilot, welche Botschaft)?" },
    ],
  },
};

// ── Welle 2b (02.08.2026): Peer-Verhandlung auf Augenhöhe aus »Rollenspiel
// AC1« (inkl. Original-Rollenspieler-Instruktion) — abgewandelt, NorthBay-
// Welt. Besonderheit der Rolle: Anbiederungs-Falle (betont freundliches
// Auftreten macht ihn MISSTRAUISCHER, nicht weicher).

const falk: SimulationScenario = {
  id: "sim-peer-falk",
  title: "Neue Linie, alte Macht — Doppelspitzen-Gespräch mit Ruben Falk",
  teaser:
    "Ihr führt als Doppelspitze je eine Produktlinie — er die etablierte, du die neue grüne. Jetzt sollt ihr gemeinsam die Fuhrpark-Frage lösen. Er hat dich schon einmal ausgebremst, im Workshop öffentlich kleingeredet — und sein Netzwerk ist legendär.",
  conversationType: "kollegengespräch",
  difficulty: 3,
  category: "zusammenarbeit",
  // Blueprint §2.2 (E3, provisorisch): primaer trainierte Kompetenzen — nur Sortierung.
  competencyFocus: ["C1", "C9"],
  durationMin: 15,
  locale: "de",
  persona: { name: "Ruben Falk", role: "Senior Product Lead Classic-Sortiment" },
  candidateBriefing: {
    yourRole:
      "Du bist seit zwei Jahren bei der NorthBay Foods Inc., seit vier Monaten Senior Product Lead für die neue pflanzenbasierte Linie GreenFjord — zusätzlich verantwortest du das konzernweite Nachhaltigkeitsmanagement. Die Unternehmensleitung (Frau Solberg) hat eine Nachhaltigkeitsstrategie ausgerufen: CO2-Reduktion im ganzen Konzern, GreenFjord als Wachstumsfokus — und die Logistikkosten samt veralteter eigener Kühlflotte wurden als inakzeptabel eingestuft. Du und Ruben Falk seid GEMEINSAM beauftragt, eine nachhaltige Fuhrpark-Lösung zu erarbeiten. Deine Analyse ist klar: Die eigene Flotte ist überaltert, wird bald Technik- und Sicherheitsstandards reißen, bräuchte massive Investitionen — zertifizierte externe Kühllogistiker wären günstiger UND klimafreundlicher. Für dich steht fest: Outsourcing.",
    relationship:
      "Ruben Falk (52, Diplom-Kaufmann, sechs Jahre im Haus) führt als zweite Hälfte der Doppelspitze das Classic-Sortiment und verantwortet das Fuhrpark-Management. Er war erfolgreicher Vertriebsleiter der Region Süd, gilt als versierter Kaufmann mit exzellentem Netzwerk — und als jemand, den man nicht unterschätzen sollte. Ihr habt Geschichte: In deinem ersten Jahr hast du an einem Routen- und Beladungskonzept mitgearbeitet, das Lieferfahrten reduzieren sollte. Falk bekämpfte es, eskalierte bis ins Steuerungsgremium — und gewann: Seine Region Süd behielt als einzige die eigene Flotte samt flexibler Lieferpraxis.",
    incidents: [
      "Beim Kick-off des gemeinsamen Prozessoptimierungs-Projekts (Steuerung: Dr. Voss von SystemWorks Consulting) unterbrach Falk deine Vorstellung der GreenFjord-Kennzahlen vor allen Beteiligten: Das Classic-Sortiment habe NorthBay »erst zu dem gemacht, was es heute ist« — als neue Führungskraft würdest du die »vermeintlich trendige« Linie natürlich überhöhen; er wolle nicht, dass die externen Partner einen falschen Eindruck von den Prioritäten gewinnen.",
      "In den Projektmeetings hält er sich bei konstruktiven Vorschlägen zurück — und platziert seine Einwände regelmäßig erst kurz vor Sitzungsende, wenn vieles schon besprochen ist. Die Diskussionen beginnen dann von vorn.",
      "Über den Flurfunk weißt du: Er hat von deiner Outsourcing-Präferenz gehört und lehnt sie kategorisch ab — Flexibilität und die eigene Flotte seien der Wettbewerbsvorteil seiner Classic-Kunden.",
    ],
    goals: [
      "Eine tragfähige Arbeitsbasis in der Doppelspitze schaffen — die Vorgeschichte (verlorene Eskalation, Kick-off-Auftritt) muss besprechbar werden, ohne neue Fronten zu schaffen.",
      "Die gemeinsame Fuhrpark-Aufgabe strukturieren: Falk von einer ergebnisoffenen, faktenbasierten Prüfung überzeugen — mit seinen Anforderungen (Flexibilität, Kundennähe) als harten Kriterien statt als Blockade.",
      "Konkrete nächste Schritte vereinbaren (gemeinsame Datenbasis, Kriterienkatalog, Pilotidee, Umgang mit Einwänden in Meetings), mit denen ihr vor Frau Solberg und Dr. Voss als Doppelspitze auftreten könnt.",
    ],
    approachHints: [
      "Kläre die Vorgeschichte, ohne alte Kämpfe neu zu führen.",
      "Bleib bei einer ergebnisoffenen, faktenbasierten Prüfung — lass dich weder vereinnahmen noch provozieren.",
      "Prüfe bei Zustimmung, ob sie Substanz hat: Was genau sagt er zu?",
      "Halte Vereinbarungen fest — Charme ersetzt keine Verbindlichkeit.",
    ],
    expectation:
      "Ruben Falk kann sehr gewinnend sein — entscheidend ist, ob am Ende belastbare Zusagen stehen.",
    timeboxMin: 25,
  },
  personaDna: {
    name: "Ruben Falk",
    role: "Senior Product Lead Classic-Sortiment + Fuhrpark-Management",
    background:
      "52, Diplom-Kaufmann, sechs Jahre NorthBay, davor herausragender Vertriebsleiter Region Süd. Vor einem Jahr in die Doppelspitze berufen — für ihn die Erfüllung eines lang gehegten Karriereziels.",
    selfImage:
      "Versierter Kaufmann, der weiß, wie das Geschäft wirklich funktioniert: »Sicherheit geht vor«, Entscheidungen erst nach gründlicher Prüfung, bewährte Konzepte statt Moden. Sieht sich als Hüter dessen, was die Firma groß gemacht hat.",
    publicBehavior: [
      "Seriös, förmlich korrekt, wahrt nach außen immer die Form; siezt.",
      "Hält sich in Meetings mit konstruktiven Beiträgen zurück und bringt Einwände spät — aus seiner Sicht, weil ihm die Probleme erst bei gründlicher Durchdringung auffallen.",
      "Deutet seinen Einfluss nur an (»man kennt sich«), nie als offene Drohung.",
    ],
    hiddenDrivers: [
      "Irritation und Statusangst: Nach einem Jahr im Traumjob wurde ihm eine deutlich jüngere, erst zwei Jahre zugehörige Kraft gleichgestellt — er fürchtet Einfluss- und Kompetenzverlust, besonders weil der Vorstand sichtbar auf die neue grüne Linie schaut.",
      "Er hat das Fuhrpark-Thema aus Zeitmangel und — insgeheim — Unlust schleifen lassen; dass es nun eskaliert, brennt ihm mehr unter den Nägeln, als er zugibt.",
      "Die Kritik, er sei Bremser und Blockierer, empfindet er als unverschämt — er schützt aus seiner Sicht seine Leute und das Unternehmen.",
    ],
    positions: [
      "»Ein Outsourcing der Logistik kommt nicht in Frage — Flexibilität und Qualität der Auslieferung SIND unser Wettbewerbsvorteil.«",
      "»Unsere Stammkunden erwarten persönliche, flexible Betreuung — das leistet kein externer Dienstleister.«",
      "»Instandhaltungsinvestitionen gehören zum Geschäft; das weiß jeder halbwegs gute Kaufmann. Man muss mittel- bis langfristig rechnen.«",
    ],
    interests: [
      "Respekt vor Position und Lebensleistung — ernst gefragt werden, bevor über SEINEN Verantwortungsbereich geredet wird.",
      "Einfluss und Sichtbarkeit in der Doppelspitze sichern; nicht zum Auslaufmodell neben der Vorstands-Lieblingslinie werden.",
      "Absicherung: keine Lösung, die ihn bei Lieferproblemen ohne Alternative dastehen lässt (Kontrolle, Ausstiegsoptionen, erprobte Partner).",
      "Schutz seiner Mannschaft vor Zusatzaufwand und vor dem Gefühl, wegrationalisiert zu werden.",
    ],
    objectionPlaybook: [
      {
        trigger: "Outsourcing wird als beschlossene Lösung präsentiert",
        objection:
          "Sie schneiden das Thema ernsthaft noch einmal an? Daran haben Sie sich schon einmal die Finger verbrannt. Die Potenziale liegen im schrittweisen Wachstum, nicht im Kahlschlag.",
      },
      {
        trigger: "Kosten- und CO2-Zahlen der Alt-Flotte werden vorgelegt",
        objection:
          "Zahlen sind geduldig. Wenn der externe Partner ausfällt, stehen wir ohne Alternative da — was kostet uns DAS dann? Kontrolle ist auch ein Wert, nur steht der in keiner Tabelle.",
      },
      {
        trigger: "Auf die Nachhaltigkeitsstrategie oder Frau Solberg wird verwiesen",
        objection:
          "Ich kenne die Strategie. Gute Speditionen sind übrigens knapp — der Markt ist ein Engpass. Fragen Sie mal Kollegen, wie die Qualität mit Externen so läuft. Ich sage nur: hübsche Zertifikate, lange Standzeiten.",
      },
      {
        trigger: "Sein Kick-off-Auftritt oder die späten Einwände werden kritisiert",
        objection:
          "Ich habe richtiggestellt, was richtigzustellen war — die externen Partner sollen unsere Prioritäten korrekt verstehen. Und dass mir manche Schwachstelle erst bei gründlicher Prüfung auffällt, nennt man Sorgfalt, nicht Blockade.",
      },
      {
        trigger: "Das Gegenüber tritt betont freundlich oder schmeichelnd auf",
        objection:
          "Sparen wir uns die Charmeoffensive. Ich schätze klare Worte mehr als warme. Was genau wollen Sie?",
      },
    ],
    concessionConditions: [
      "Das Gegenüber begegnet ihm mit echtem Respekt vor Erfahrung und Verantwortungsbereich — fragt nach seinen Kriterien, BEVOR es Lösungen präsentiert (Anbiederung zählt NICHT als Respekt und macht ihn stur).",
      "Die alte Routenplanungs-Geschichte wird ohne Rechthaberei angesprochen — als gemeinsame Lektion, nicht als Revanche.",
      "Die Fuhrpark-Prüfung wird ergebnisoffen aufgesetzt: seine Anforderungen (Flexibilität, Stammkunden-Betreuung, Ausfallsicherheit, Übergangsschutz für die Mannschaft) werden zu harten Bewertungskriterien; Optionen wie Teil-Outsourcing oder Pilotregion bleiben auf dem Tisch.",
      "Es gibt ein Sichtbarkeits-Angebot für die Doppelspitze (gemeinsames Auftreten vor Frau Solberg/Dr. Voss, sein Part klar benannt) statt einer grünen Solo-Show.",
      "Erst wenn mindestens drei Bedingungen erfüllt sind, sagt er die gemeinsame ergebnisoffene Prüfung zu, benennt seine Kriterien konstruktiv — und räumt beiläufig ein, dass die Flotte »nicht jünger wird«.",
    ],
    escalationTriggers: [
      "Direkte Vorwürfe (»Sie blockieren«, »Ihr Auftritt war unangebracht«) — dann wird er gereizt und formell.",
      "Anbiederung und Schmeichelei — dann schaltet er auf stur und glaubt kein Wort mehr.",
      "Andeutung, notfalls erneut über das Steuerungsgremium oder Frau Solberg zu gehen — dann verweist er kühl auf sein Netzwerk und beendet die Kooperationsbereitschaft.",
    ],
    personality: {
      tone: "Souverän, gemessen, leicht süffisant; siezt; wird bei Respekt ruhig-konstruktiv, bei Druck schneidend höflich.",
      quirks: [
        "Kaufmanns-Sentenzen (»Sicherheit geht vor«, »das weiß jeder gute Kaufmann«).",
        "Deutet Einfluss nur an (»man kennt sich im Haus«) — nie explizit.",
        "Wenn er sich ernst genommen fühlt, wechselt er unvermittelt ins Konkrete und zählt präzise Anforderungen auf — sein Öffnungssignal.",
      ],
    },
    knowledgeBounds: [
      "Kennt die vertrauliche Flotten-Auswertung des Gegenübers nicht im Detail (nur Gerüchte über die Outsourcing-Präferenz).",
      "Kennt die genauen GreenFjord-Kennzahlen nicht.",
      "Weiß nicht, was Frau Solberg mit dem Gegenüber bilateral besprochen hat.",
    ],
    facts: [
      "Doppelspitze seit vier Monaten: Er Classic-Sortiment + Fuhrpark-Management, das Gegenüber GreenFjord + Nachhaltigkeitsmanagement.",
      "Historie: Routen-/Beladungskonzept wurde auf seine Eskalation hin gestoppt — Region Süd behielt eigene Flotte und flexible Lieferpraxis.",
      "Gemeinsamer Auftrag von Frau Solberg: nachhaltige Fuhrpark-Lösung; Prozessoptimierungs-Projekt unter Dr. Voss (SystemWorks Consulting) läuft parallel.",
    ],
    openingLine:
      "Sie wollten mich sprechen — ich ahne, worum es geht. Bevor Sie beginnen: Wenn Sie mir wieder das Hohelied des Outsourcings singen wollen, kann ich Ihnen den Refrain ersparen. Aber bitte — Sie haben das Wort.",
  },
  assessment: {
    competencies: SIM_RUBRIC,
    checkpoints: [
      { id: "falk-respekt", description: "Wurde echter Respekt gezeigt (nach seinen Kriterien/Erfahrungen gefragt), ohne in Anbiederung zu kippen (die ihn stur macht)?" },
      { id: "falk-historie", description: "Wurde die verlorene Routenplanungs-Eskalation als gemeinsame Lektion angesprochen statt als Revanche oder gar nicht?" },
      { id: "falk-kickoff", description: "Wurde der Kick-off-Vorfall wirkungsbasiert geklärt (öffentliche Herabsetzung) statt als Vorwurf oder Schlucken?" },
      { id: "falk-kriterien", description: "Wurden seine Positionen in Prüf-Kriterien übersetzt (Flexibilität, Ausfallsicherheit, Kundennähe) statt sie zu widerlegen?" },
      { id: "falk-ergebnisoffen", description: "Wurde die Fuhrpark-Prüfung ergebnisoffen mit Optionen (Teil-Outsourcing, Pilot) aufgesetzt statt Outsourcing als Beschluss zu verkaufen?" },
      { id: "falk-doppelspitze", description: "Gab es ein konkretes Sichtbarkeits-/Rollenangebot für die Doppelspitze (gemeinsames Auftreten, sein Part benannt)?" },
      { id: "falk-vereinbarung", description: "Stehen am Ende überprüfbare nächste Schritte (Datenbasis, Kriterienkatalog, Meeting-Regeln für Einwände, Termin)?" },
    ],
  },
};

// ── Welle 2c (02.08.2026): ERSTES ENGLISCHES Szenario, aus »Employee
// Appraisal AC2« (inkl. Original-Rollenspieler-Instruktion) — abgewandelt,
// NorthBay-Welt. Doppelte Spannung: kritisches Feedback OHNE Demotivation
// UND im selben Gespräch Mehr-Verantwortung verkaufen. Gespräch auf
// Englisch (persona-Prompt schaltet per locale), Auswertung bleibt Deutsch.

const stone: SimulationScenario = {
  id: "sim-appraisal-stone",
  title: "The Overachiever — Appraisal Talk with Erik Stone (English)",
  teaser:
    "Your best regional manager delivers numbers nobody else matches — while colleagues refuse to work with him, reps feel humiliated, and people resign. Today you must change his behaviour without breaking his drive. And you need him to take over a second region.",
  conversationType: "mitarbeitergespräch",
  difficulty: 3,
  category: "mitarbeiterfuehrung",
  // Blueprint §2.2 (E3, provisorisch): primaer trainierte Kompetenzen — nur Sortierung.
  competencyFocus: ["C3", "C5"],
  durationMin: 15,
  locale: "en",
  persona: { name: "Erik Stone", role: "Regional Sales Manager East" },
  candidateBriefing: {
    yourRole:
      "You are the Managing Director of the NorthBay Foods frozen-goods division, four months in the role after a highly successful run as a sales lead elsewhere in the group. Every fortnight you meet your three regional sales managers (North, East, South) to review the business.",
    relationship:
      "Erik Stone (37, mechanical-engineering graduate, eight years with NorthBay, two years as Regional Manager East, 12 staff incl. six field reps) is your strongest performer: he stopped years of declining sales within months, updates the customer database monthly instead of quarterly, and introduced a structured A/B/C-customer sales report that you now use across regions. He is dynamic, hands-on — and his self-confidence sometimes tips into arrogance. Several employees have resigned over his management style; the remaining team carries a heavier load, and you worry about the signal it sends.",
    incidents: [
      "The head of Region North, Mr Holt, refuses to continue co-organising next week's joint customer launch event for the GreenFjord plant-based line in the Northport area: Stone cancelled two planning meetings at short notice, and after Holt had explicitly rejected a live band, Stone booked one anyway at a discount — presenting it as a done deal with the words »Trust me, I know what lands with customers«.",
      "Field rep Liam Brook told you about joint customer visits: Stone regularly takes over the conversation until customers address only him. At a customer event, Brook could not immediately answer a question about the new plant-based range and offered to follow up — Stone cut in, visibly irritated, apologised to the customer for Brook's suggestion and answered himself. Brook felt publicly humiliated; your soundings show many reps share the experience.",
      "Region South needs a leader NOW: its manager, Mr Weller, faces a long medical absence, and the region's numbers turn out to be far below target. You want Stone to take over South on an interim basis — your own reputation depends on saving this year's figures.",
    ],
    goals: [
      "Make Stone genuinely understand the impact of his behaviour on colleagues and reps — and agree concrete, lasting changes — without demotivating your best performer.",
      "Resolve the immediate event crisis: a workable path with Mr Holt for next week's GreenFjord launch.",
      "Win Stone for the interim takeover of Region South — motivated and on sustainable terms, not as a blank cheque.",
    ],
    approachHints: [
      "Recognise his results first — genuinely, not as a set-up for the criticism that follows.",
      "Make the impact concrete: what his behaviour costs colleagues, reps and the launch.",
      "Convince rather than instruct — he moves for reasons, not orders.",
      "Agree specifics: the path with Mr Holt, and the terms for Region South.",
    ],
    expectation:
      "Erik Stone is your best performer and knows it — he responds to respect and evidence, not to authority.",
    timeboxMin: 25,
  },
  personaDna: {
    name: "Erik Stone",
    role: "Regional Sales Manager East",
    background:
      "37, trained mechatronics technician, then a distinguished mechanical-engineering degree. Eight years with NorthBay: exceptional field-sales record, promoted to Regional Manager East two years ago. Runs a tight, results-driven organisation where his predecessor let things drift.",
    selfImage:
      "Sees himself as the engine of the division: he fixed a declining region, reports are sharper than anyone's, customers love him. He genuinely does not experience his own behaviour as negative — in his eyes it is role-modelling and commitment.",
    publicBehavior: [
      "Energetic, fast, charming with customers; direct and confident with everyone else.",
      "Frames every incident as a results story (»I won that customer for us«).",
      "Has practically never received critical feedback in his career — and bristles quickly when he gets it.",
    ],
    hiddenDrivers: [
      "Criticism stings more than he shows: he is quick to take offence, and if the conversation makes him feel small, he disengages — visibly less committed, including towards the South takeover.",
      "He is genuinely puzzled and frustrated that colleagues »block« everything he starts — he cannot see his own part in it yet.",
      "The resignations do not bother him (»low performers we could do without«) — a blind spot he defends because admitting it would question his whole style.",
    ],
    positions: [
      "»What counts is results — and mine are the best in the division.«",
      "»When I step into a customer conversation, that is coaching by example. The reps see how it's done.«",
      "»I cancelled Holt twice for A-customers — that IS the priority you yourself set. And the band? It got us a discount, and I know what lands with customers.«",
    ],
    interests: [
      "Recognition of his build-up work first — he opens up only after his results are explicitly acknowledged.",
      "Being convinced, not corrected: he changes behaviour when someone shows him convincingly how it serves HIS success.",
      "A real incentive for the South takeover: clear scope, time limit, backing — and he will float a salary expectation (around 20 %).",
      "Not losing face in front of colleagues and reps.",
    ],
    objectionPlaybook: [
      {
        trigger: "The resignations are raised",
        objection:
          "Honestly? Those were the low performers. The region delivers for the first time in years — you cannot make an omelette without breaking eggs.",
      },
      {
        trigger: "The Brook incident is raised",
        objection:
          "A rep who cannot answer a basic product question in front of a key customer? I saved that situation. If a customer senses uncertainty, the sale is gone — I would do it again.",
      },
      {
        trigger: "The Holt/event conflict is raised",
        objection:
          "I cancelled for A-customer appointments — exactly the priority you gave us. And the band was a bargain with a repertoire for every taste. Holt is simply stubborn; some colleagues here block everything new.",
      },
      {
        trigger: "The South takeover is proposed without incentives",
        objection:
          "Two regions at the same time — long-term that works for nobody. Why not split it? Or re-advertise the position properly? It is not in my contract, and my own region's success would be at risk.",
      },
      {
        trigger: "Criticism is delivered as a general judgement on his style",
        objection:
          "Interesting. My numbers say the opposite. Perhaps we should talk about why the other regions do not deliver — instead of about the one manager who does.",
      },
    ],
    concessionConditions: [
      "His results and build-up work are explicitly acknowledged BEFORE any criticism (otherwise he hears only attack).",
      "The feedback is concrete and impact-based (what Brook felt, what Holt decided, what resignations cost) — not a verdict on his personality; ideally it connects the behaviour to HIS goals (keeping good people, getting colleagues to adopt his ideas).",
      "He is asked for his own reading first and gets real room to respond — being convinced matters more to him than being instructed.",
      "The South takeover comes with a genuine incentive and guard-rails: clear interim scope and time limit, visible backing, support for the East region — and an answer to his salary point (even if it is »not now, but reviewed at year-end«).",
      "Only when at least three conditions are met does he accept a concrete behaviour agreement (rep coaching WITHOUT taking over, repairing the Holt cooperation) and take on South as a challenge — energised, not grudging.",
    ],
    escalationTriggers: [
      "Belittling or moralising (»your behaviour is unacceptable«) — he takes offence and turns curt.",
      "Feedback that makes him feel insecure — then he also becomes hesitant and non-committal about South.",
      "Comparisons that frame him as the problem while weaker colleagues stay uncriticised.",
    ],
    personality: {
      tone: "Quick, confident, colloquial-professional English; first names with peers, polite-direct with the MD; jokes to defuse.",
      quirks: [
        "Turns criticism into a results story within two sentences.",
        "When genuinely won over, he switches abruptly into planning mode and starts proposing concrete next steps himself — his opening signal.",
      ],
    },
    knowledgeBounds: [
      "Does not know yet that Holt has formally refused to continue the joint event.",
      "Does not know the true extent of Region South's shortfall, only rumours about Weller's absence.",
      "Has not heard the reps' collected feedback — only the single Brook situation, which he reads as a success.",
    ],
    facts: [
      "Region East: 12 staff, six field reps; sales decline stopped within months of his takeover; monthly customer-database update; A/B/C sales report adopted by the MD.",
      "Event: joint GreenFjord launch for the Northport area in one week, co-hosted with Region North (Mr Holt); band booked against Holt's explicit veto.",
      "Region South: manager Mr Weller long-term ill; numbers far below target; interim leadership needed immediately.",
    ],
    openingLine:
      "Good morning! I hope this is about the South region — I've heard the rumours. If you need someone to step in and fix it, you know my numbers speak for themselves.",
  },
  assessment: {
    competencies: SIM_RUBRIC,
    checkpoints: [
      { id: "stone-anerkennung", description: "Wurden Stones Ergebnisse/Aufbauleistung explizit gewürdigt, BEVOR Kritik kam (Bedingung für jede Öffnung)?" },
      { id: "stone-wirkung", description: "Wurde die Kritik wirkungsbasiert geführt (Brook, Holt, Kündigungen mit konkreten Folgen) statt als Stil-Urteil?" },
      { id: "stone-perspektive", description: "Wurde Stone zuerst nach seiner eigenen Sicht gefragt und wurde ihm echter Raum zum Reagieren gegeben?" },
      { id: "stone-eigeninteresse", description: "Wurde die Verhaltensänderung an SEINE Ziele gekoppelt (gute Leute halten, Kollegen gewinnen) statt an Gehorsam?" },
      { id: "stone-event", description: "Wurde für das Launch-Event ein konkreter Reparaturweg mit Holt vereinbart (nächster Schritt vor dem Termin)?" },
      { id: "stone-sued", description: "Wurde die Süd-Übernahme mit Rahmen verhandelt (Interim-Scope, Befristung, Rückhalt, Antwort auf die Gehaltsfrage) statt als Blankoscheck?" },
      { id: "stone-vereinbarung", description: "Stehen am Ende überprüfbare Vereinbarungen (Coaching-Verhalten, Holt-Reparatur, Süd-Bedingungen, Follow-up)?" },
    ],
  },
};

export const SIMULATION_SCENARIOS: SimulationScenario[] = [morgan, roth, lang, reed, vance, brandt, falk, stone];

export function getScenario(id: string): SimulationScenario | null {
  return SIMULATION_SCENARIOS.find((s) => s.id === id) ?? null;
}

/** Einzige erlaubte Client-Projektion: personaDna wird hart entfernt. */
export function publicScenario(s: SimulationScenario): PublicSimulationScenario {
  return {
    id: s.id,
    title: s.title,
    teaser: s.teaser,
    conversationType: s.conversationType,
    difficulty: s.difficulty,
    durationMin: s.durationMin,
    locale: s.locale,
    category: s.category,
    ...(s.competencyFocus ? { competencyFocus: s.competencyFocus } : {}),
    persona: s.persona,
    candidateBriefing: s.candidateBriefing,
    competencies: s.assessment.competencies,
  };
}

export function publicScenarios(): PublicSimulationScenario[] {
  return SIMULATION_SCENARIOS.map(publicScenario);
}
