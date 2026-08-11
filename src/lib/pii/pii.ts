/**
 * PII-Engine des Browser-Netzes (N1+, PRESIDIO-ANONYMISIERUNG-BLUEPRINT).
 *
 * Von Presidio übernommen (MIT, Muster portiert und für DACH geschärft):
 * Prüfsummen-Validierung (IBAN mod-97, Karte/Luhn), Kontextwort-Erkennung
 * für interne Nummern, Pseudonymisierung mit KONSISTENTEN Platzhaltern
 * (gleicher Wert → gleiche Nummer; »K. Ahrweiler«/»Ahrweiler«/»Frau
 * Ahrweiler« → DIESELBE Person — genau die Presidio-Schwäche aus dem
 * Owner-Video, hier deterministisch gelöst).
 *
 * Bewusst OHNE statistisches Modell: läuft komplett im Browser (USP
 * »Anonymisierung verlässt den Browser nie«), 0 € laufende Kosten. Der
 * Long Tail (Firmen ohne Rechtsform/Trigger, exotische Namen ohne Anrede)
 * bleibt dem späteren zweiten Netz (Presidio/NER, EU-Service) — dafür ist
 * `sanitizeWithFindings` die Steckdose: gleiche Vertragstypen, zweites
 * Netz kann serverseitig einfach weitere Findings anhängen.
 *
 * PURE: kein I/O, kein server-only — von Client UND Tests nutzbar.
 */

import { FIRST_NAMES, AMBIGUOUS_FIRSTNAMES } from "./vornamen";
import { CITY_NAMES, CITY_PREPOSITIONS } from "./orte";

/* ------------------------------------------------------------------ */
/*  Verträge (Steckdose fürs zweite Netz)                              */
/* ------------------------------------------------------------------ */

export type PiiKind =
  | "email" | "url" | "tel" | "iban" | "karte" | "nummer" | "geburtsdatum"
  | "kfz" | "adresse" | "plz_ort" | "firma" | "person" | "ort";

export interface PiiFinding {
  kind: PiiKind;
  /** Klartext — bleibt im Browser (das »Mapping« aus dem Video). */
  original: string;
  /** Eingesetzter Platzhalter (konsistent je Wert). */
  replacement: string;
}

export interface PiiResult {
  text: string;
  findings: PiiFinding[];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wort-Ersetzung mit Unicode-Grenzen (identisch zur transcript-utils-Logik). */
function replaceWord(text: string, token: string, replacement: string): string {
  const t = token.trim();
  if (!t) return text;
  try {
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(t)}(?![\\p{L}\\p{N}_])`, "gu");
    return text.replace(re, replacement);
  } catch {
    return text.split(t).join(replacement);
  }
}

/* ------------------------------------------------------------------ */
/*  Häufige großgeschriebene Nicht-Namen (deutsche Substantive)         */
/*  — das Herzstück der Heuristik: Deutsch großschreibt ALLE Nomen,     */
/*  deshalb braucht jeder »großgeschrieben ⇒ Name«-Schluss eine Sperre. */
/* ------------------------------------------------------------------ */

const COMMON_CAPITALIZED: ReadonlySet<string> = new Set([
  // Wochentage / Monate / Zeit
  "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag",
  "Sonntag", "Januar", "Februar", "März", "April", "Juni", "Juli",
  "September", "Oktober", "November", "Dezember", "Morgen", "Abend",
  "Mittag", "Woche", "Monat", "Jahr", "Quartal", "Uhr", "Anfang", "Ende",
  // Business-Vokabular, das typisch hinter Namen/Triggern steht
  "Feedback", "Projekt", "Projekte", "Termin", "Termine", "Gespräch",
  "Meeting", "Angebot", "Vertrag", "Team", "Teams", "Bereich", "Abteilung",
  "Anfrage", "Beschwerde", "Daten", "Liste", "Nummer", "Name", "Namen",
  "Seite", "Thema", "Themen", "Frage", "Fragen", "Antwort", "Aufgabe",
  "Aufgaben", "Ziel", "Ziele", "Plan", "Budget", "Kosten", "Umsatz",
  "Bericht", "Analyse", "Präsentation", "Unterlagen", "Prozess", "System",
  "Software", "Kunde", "Kunden", "Kundin", "Firma", "Person", "Ort",
  "Führungskraft", "Mitarbeiter", "Mitarbeiterin", "Kollege", "Kollegin",
  "Chef", "Chefin", "Leitung", "Herr", "Herrn", "Frau", "Problem",
  "Lösung", "Idee", "Ideen", "Punkt", "Punkte", "Mail", "Telefon",
]);

const FIRST_NAME_SET: ReadonlySet<string> = new Set(FIRST_NAMES);

/**
 * Einheiten/Währungen hinter einer 5-stelligen Zahl — dann ist es KEINE
 * Postleitzahl, sondern eine Geschäftszahl (»45000 Euro«, »12000 Stück«).
 */
const UNIT_WORDS: ReadonlySet<string> = new Set([
  "Euro", "EUR", "Franken", "CHF", "Dollar", "USD", "Cent",
  "Stück", "Stk", "Teile", "Paletten", "Tonnen", "Kilo", "Kilogramm",
  "Liter", "Meter", "Kilometer", "Quadratmeter", "Einheiten", "Exemplare",
  "Kunden", "Mitarbeiter", "Mitarbeitende", "Nutzer", "Besucher", "Aufträge",
  "Bestellungen", "Positionen", "Datensätze", "Zeilen", "Punkte", "Prozent",
]);

/* ------------------------------------------------------------------ */
/*  Prüfsummen (von Presidio gelernt: validieren statt nur mustern)     */
/* ------------------------------------------------------------------ */

/** IBAN-Prüfung nach ISO 13616 (mod-97 über umgestellte Ziffernfolge). */
export function isValidIban(candidate: string): boolean {
  const iban = candidate.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const part = ch >= "A" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of part) remainder = (remainder * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return remainder === 1;
}

/** Luhn-Prüfsumme (Kreditkarten) — filtert zufällige lange Ziffernfolgen. */
export function isValidLuhn(candidate: string): boolean {
  const digits = candidate.replace(/[\s-]/g, "");
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/* ------------------------------------------------------------------ */
/*  Strukturierte PII (Regex + Prüfsumme + Kontext)                     */
/* ------------------------------------------------------------------ */

/** Kontextwörter für interne Nummern (Video-Lektion: Presidio kennt sie
 *  nicht — wir definieren sie als eigene »Recognizer«). */
const NUMBER_CONTEXT =
  "Steuer-?ID|Steuer-?Nr\\.?|Steuernummer|Steueridentifikationsnummer|" +
  "SV-?Nummer|Sozialversicherungsnummer|Versichertennummer|Rentenversicherungsnummer|" +
  "Personalnummer|Personal-?Nr\\.?|Mitarbeiternummer|Mitarbeiter-?Nr\\.?|" +
  "Kundennummer|Kunden-?Nr\\.?|Vertragsnummer|Vertrags-?Nr\\.?|" +
  "Rechnungsnummer|Rechnungs-?Nr\\.?|Aktenzeichen|Fallnummer|Angebots-?Nr\\.?|" +
  "Bestellnummer|Auftragsnummer|Auftrags-?Nr\\.?|Police|Policennummer|" +
  "Mandantennummer|Depotnummer|Kontonummer|Konto-?Nr\\.?";

export function applyStructuredPii(input: string): PiiResult {
  let text = input;
  const findings: PiiFinding[] = [];
  const record = (kind: PiiKind, original: string, replacement: string) => {
    findings.push({ kind, original, replacement });
    return replacement;
  };

  // E-Mail / URL (wie bisher, hier zentralisiert)
  text = text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) =>
    record("email", m, "[EMAIL]")
  );
  text = text.replace(/\bhttps?:\/\/\S+/gi, (m) => record("url", m, "[URL]"));
  text = text.replace(/\bwww\.\S+/gi, (m) => record("url", m, "[URL]"));

  // IBAN (nur mit gültiger Prüfsumme — sonst bleiben z. B. Artikelnummern stehen)
  text = text.replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{2,4}){3,8}\b/g, (m) =>
    isValidIban(m) ? record("iban", m, "[IBAN]") : m
  );

  // Kreditkarte (13–19 Ziffern, Luhn-valide)
  text = text.replace(/\b(?:\d[ -]?){13,19}\b/g, (m) =>
    isValidLuhn(m) ? record("karte", m, "[KARTE]") : m
  );

  // Interne Nummern über Kontextwort (Label bleibt stehen, Wert wird maskiert).
  // Zwischen Label und Wert darf ein »Nr.«-Zusatz stehen (»Police Nr. AB-99«).
  // Der Wert läuft über bis zu 6 Tokens: Ziffern-Tokens immer, einzelne
  // Buchstaben-Kürzel (»65 170839 J 003«) nur INNERHALB eines Laufs — sonst
  // frisst der Wert Folgewörter (»… und das Aktenzeichen«).
  // Manuelles Vorwärts-Scannen statt einer verschlingenden Regex: sonst
  // frisst der erste Treffer den nächsten Kontext (»… und das Aktenzeichen«)
  // mit auf und der zweite Wert bliebe unmaskiert.
  {
    const ctxRe = new RegExp(`\\b(${NUMBER_CONTEXT})((?:\\s*(?:Nr\\.?|Nummer|No\\.?))?\\s*[:#]?\\s*)`, "gi");
    const tokenRe = /^([A-Za-z0-9][A-Za-z0-9\/.\-]*)(\s*)/;
    let out = "";
    let cursor = 0;
    for (const m of [...text.matchAll(ctxRe)]) {
      const start = m.index ?? 0;
      if (start < cursor) continue; // Überlappung: bereits verarbeitet
      const headEnd = start + m[0].length;
      let scan = headEnd;
      const kept: string[] = [];
      // Tokens einsammeln, solange sie Ziffern enthalten oder ein Kürzel
      // sind, dem noch ein Ziffern-Token folgt (»65 170839 J 003«).
      for (let guard = 0; guard < 6; guard++) {
        const rest = text.slice(scan);
        const tm = rest.match(tokenRe);
        if (!tm) break;
        const tok = tm[1];
        const hasDigit = /\d/.test(tok);
        const isCode = /^[A-Za-z]{1,4}$/.test(tok);
        if (!hasDigit && !isCode) break;
        if (!hasDigit) {
          // Kürzel nur behalten, wenn danach wirklich noch eine Zahl kommt.
          const ahead = rest.slice(tm[0].length).match(tokenRe);
          if (!ahead || !/\d/.test(ahead[1])) break;
        }
        kept.push(tok);
        scan += tm[0].length;
      }
      while (kept.length && !/\d/.test(kept[kept.length - 1])) {
        const dropped = kept.pop()!;
        scan -= dropped.length;
      }
      if (!kept.some((t) => /\d/.test(t))) continue;
      // Satzzeichen am Ende gehören zum Satz, nicht zur Nummer.
      const value = text.slice(headEnd, scan).trimEnd().replace(/[.,;:]+$/, "");
      if (!value) continue;
      record("nummer", value, "[NUMMER]");
      out += text.slice(cursor, headEnd) + "[NUMMER]";
      cursor = headEnd + value.length;
    }
    text = out + text.slice(cursor);
  }

  // Geburtsdaten NUR im Geburts-Kontext — Termindaten bleiben lesbar
  // (die Analyse braucht »am 05.08. besprochen«; sie braucht kein Geburtsdatum).
  const dateShape = "\\d{1,2}\\.\\s?\\d{1,2}\\.\\s?\\d{2,4}";
  text = text.replace(
    new RegExp(`\\b(geb\\.|geboren(?:\\s+am)?|Geburtsdatum|Geburtstag(?:\\s+am)?)(\\s*[:]?\\s*)(${dateShape})`, "gi"),
    (_m, label: string, sep: string, value: string) => {
      record("geburtsdatum", value, "[GEBURTSDATUM]");
      return `${label}${sep}[GEBURTSDATUM]`;
    }
  );
  text = text.replace(
    new RegExp(`\\b(${dateShape})(\\s+geboren)`, "gi"),
    (_m, value: string, tail: string) => {
      record("geburtsdatum", value, "[GEBURTSDATUM]");
      return `[GEBURTSDATUM]${tail}`;
    }
  );

  // Kfz-Kennzeichen (DACH-Form: 1–3 Buchstaben, 1–2 Buchstaben, 1–4 Ziffern).
  // Kein Satzpunkt-Veto (»… F-AB 1234.«), aber Versionsnummern (1.2) bleiben.
  text = text.replace(/\b([A-ZÄÖÜ]{1,3})-([A-Z]{1,2})[ -]?(\d{1,4})(?!\d)(?!\.\d)/g, (m) =>
    record("kfz", m, "[KFZ]")
  );

  // Straße + Hausnummer
  text = text.replace(
    /\b\p{Lu}[\p{L}.-]*(?:straße|strasse|str\.|weg|allee|platz|gasse|ring|damm|ufer)\s+\d+\s?[a-z]?\b/giu,
    (m) => record("adresse", m, "[ADRESSE]")
  );
  // PLZ + Ort (5 Ziffern + großgeschriebenes Wort). Einheiten/Währungen
  // hinter der Zahl sind KEINE Orte — »45000 Euro« ist eine Geschäftszahl
  // und muss lesbar bleiben (sonst zerstört die Maskierung die Analyse).
  text = text.replace(/\b\d{5}\s+(\p{Lu}[\p{L}-]+)\b/gu, (m, word: string) =>
    UNIT_WORDS.has(word) ? m : record("plz_ort", m, "[PLZ_ORT]")
  );

  // Telefon: strenger als bisher — muss mit 0/+ beginnen und ≥8 Ziffern
  // haben; reine Datumsangaben (8 Ziffern, dd.mm.yyyy) fallen nicht mehr
  // fälschlich unter [TEL].
  text = text.replace(/(\+?\d[\d\s()\/.\-]{6,18}\d)/g, (m) => {
    const digits = m.replace(/\D/g, "");
    const startsLikePhone = /^[+0]/.test(m.trim());
    const looksLikeDate = /^\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4}$/.test(m.trim());
    if (!startsLikePhone || looksLikeDate || digits.length < 8 || digits.length > 15) return m;
    return record("tel", m, "[TEL]");
  });

  return { text, findings };
}

/* ------------------------------------------------------------------ */
/*  Firmen (Rechtsform + Trigger)                                       */
/* ------------------------------------------------------------------ */

const LEGAL_FORMS =
  "GmbH\\s?&\\s?Co\\.\\s?KGaA|GmbH\\s?&\\s?Co\\.\\s?KG|gGmbH|GmbH|KGaA|AG|KG|OHG|GbR|" +
  "e\\.\\s?V\\.|SE|UG(?:\\s?\\(haftungsbeschränkt\\))?|mbH|Inc\\.|Ltd\\.|LLC|S\\.A\\.|B\\.V\\.";

const ORG_TRIGGERS =
  "Firma|Kunde|Kundin|Lieferant|Lieferanten|Partnerfirma|Wettbewerber|Konkurrent|Auftraggeber|Hersteller";

/** Generische Firmennamens-Bestandteile — als Einzelwort nie maskieren. */
const ORG_GENERIC: ReadonlySet<string> = new Set([
  "Logistik", "Consulting", "Solutions", "Services", "Service", "Systems",
  "System", "Group", "Holding", "Partner", "Partners", "Technik", "Handel",
  "Bau", "Deutsche", "Deutschland", "International", "Digital", "Media",
]);

export function applyOrgPii(
  input: string,
  numberFor: (kind: "firma", value: string) => string
): PiiResult {
  let text = input;
  const findings: PiiFinding[] = [];

  // Rechtsform: »Bergmann Logistik GmbH« → Firma 1 (max. 4 Namenswörter)
  const legalRe = new RegExp(
    `\\b(\\p{Lu}[\\p{L}\\d&.\\-]*(?:\\s+\\p{Lu}[\\p{L}\\d&.\\-]*){0,3})\\s+(${LEGAL_FORMS})(?![\\p{L}])`,
    "gu"
  );
  text = text.replace(legalRe, (m, name: string) => {
    const ph = numberFor("firma", m.trim());
    findings.push({ kind: "firma", original: m.trim(), replacement: ph });
    // Distinktive Namenswörter zusätzlich merken (spätere Nennung ohne
    // Rechtsform: »Bergmann hat zugesagt«) — nie Allerweltswörter.
    for (const word of name.trim().split(/\s+/)) {
      if (word.length >= 3 && !COMMON_CAPITALIZED.has(word) && !ORG_GENERIC.has(word)) {
        findings.push({ kind: "firma", original: word, replacement: ph });
      }
    }
    return ph;
  });

  // Trigger: »Firma Storch«, »Kunde Meier« — Trigger bleibt, Name wird maskiert.
  const trigRe = new RegExp(
    `\\b(${ORG_TRIGGERS})\\s+(\\p{Lu}[\\p{L}\\d&.\\-]{2,})`,
    "gu"
  );
  text = text.replace(trigRe, (m, trigger: string, name: string) => {
    if (COMMON_CAPITALIZED.has(name) || /^\[/.test(name) || /^(Person|Firma|Ort)$/.test(name)) return m;
    const ph = numberFor("firma", name);
    findings.push({ kind: "firma", original: name, replacement: ph });
    return `${trigger} ${ph}`;
  });

  // Gemerkte Einzelwort-Firmennamen global nachziehen.
  for (const f of findings) {
    if (!f.original.includes(" ")) text = replaceWord(text, f.original, f.replacement);
  }

  return { text, findings };
}

/* ------------------------------------------------------------------ */
/*  Dritte Personen (Anrede/Titel + Vornamen-Wörterbuch + Konsolidierung) */
/* ------------------------------------------------------------------ */

interface PersonEntity {
  placeholder: string;
  tokens: Set<string>;
  first?: string;
  last?: string;
}

const TITLE_RE = "(?:Dr\\.|Prof\\.|Professorin?|Doktorin?)";
// Deutsch UND Englisch: der Transkript-Weg unterstützt de/en, englische
// Anreden (»Mr Wagner«) müssen genauso greifen.
const SALUT_RE = "(?:Herrn?|Frau|Hr\\.|Fr\\.|Mr\\.?|Mrs\\.?|Ms\\.?|Miss)";

/**
 * Erkennung Dritter im Fließtext. Läuft NACH der Sprecher-Ersetzung —
 * bekannte Sprecher sind dann schon Platzhalter und kollidieren nicht.
 * `startIndex`: nächste freie »Person N«-Nummer (führt die Sprecher-
 * Nummerierung nahtlos fort).
 */
export function applyPersonPii(input: string, startIndex: number): PiiResult {
  let text = input;
  const findings: PiiFinding[] = [];
  const entities: PersonEntity[] = [];
  let nextIdx = startIndex;

  const isBlockedToken = (w: string) =>
    COMMON_CAPITALIZED.has(w) ||
    /^(Person|Firma|Ort|Führungskraft)$/i.test(w) ||
    /^\[/.test(w) ||
    w.length < 3;

  const entityFor = (first: string | undefined, last: string | undefined): PersonEntity => {
    // Konsolidierung (Video-Schwäche gelöst): gleicher Nachname ⇒ dieselbe
    // Person; Vorname allein dockt an eine eindeutige bestehende Person an.
    if (last) {
      const byLast = entities.find((e) => e.last === last);
      if (byLast) {
        if (first) {
          byLast.first = byLast.first ?? first;
          byLast.tokens.add(first);
          byLast.tokens.add(`${first} ${last}`);
        }
        return byLast;
      }
    }
    if (first && !last) {
      const byFirst = entities.filter((e) => e.first === first);
      if (byFirst.length === 1) return byFirst[0];
    }
    const e: PersonEntity = {
      placeholder: `Person ${nextIdx++}`,
      tokens: new Set(),
      first,
      last,
    };
    if (first) e.tokens.add(first);
    if (last) e.tokens.add(last);
    if (first && last) e.tokens.add(`${first} ${last}`);
    entities.push(e);
    return e;
  };

  // Pass B zuerst: volle Namen »<Vorname aus Wörterbuch> <Nachname>«.
  // Zweites Wort als Lookahead (zero-width) — sonst verschluckt ein Treffer
  // »Frau Kerstin« den Start von »Kerstin Ahrweiler« (Overlap-Falle).
  const fullRe = /\b(\p{Lu}[\p{L}]+)\s+(?=(\p{Lu}[\p{L}'\-]{2,}))/gu;
  for (const m of [...text.matchAll(fullRe)]) {
    const [, first, last] = m;
    if (!FIRST_NAME_SET.has(first) && !AMBIGUOUS_FIRSTNAMES.has(first)) continue;
    const lastBlocked = isBlockedToken(last);
    // Blockierter »Nachname« (z. B. Wochentag hinter dem Vornamen): die
    // Person wird trotzdem registriert — nur das Einzelwort bleibt frei
    // (»Anna Montag« fällt, »Am Montag« bleibt Kalender).
    const e = entityFor(first, lastBlocked ? undefined : last);
    e.tokens.add(`${first} ${last}`);
    if (!lastBlocked) e.tokens.add(last);
    e.tokens.add(first);
  }

  // Pass A: Anrede/Titel + EIN Namenswort (»Herr Wagner«, »Frau Dr. Kim«).
  // Bewusst nur ein Wort: Deutsch großschreibt alle Nomen — ein zweites
  // Wort wäre zu oft ein Substantiv (»Frau Schmidt Feedback geben«).
  const salutRe = new RegExp(
    `\\b(?:${SALUT_RE}|${TITLE_RE})\\s+(?:${TITLE_RE}\\s+)?(\\p{Lu}[\\p{L}'\\-]{2,})`,
    "gu"
  );
  for (const m of [...text.matchAll(salutRe)]) {
    const name = m[1];
    if (isBlockedToken(name)) continue;
    // Nach Anrede ist auch ein »ambiger« Vorname eindeutig (»Herr Ernst«).
    const asFirst = FIRST_NAME_SET.has(name) || AMBIGUOUS_FIRSTNAMES.has(name);
    entityFor(asFirst ? name : undefined, asFirst ? undefined : name);
  }

  // Pass C: alleinstehende Wörterbuch-Vornamen (»dann hat Katrin gesagt«,
  // »Sebastian hat das übernommen«). Ambige Namen (Ernst, Mai, Deniz …)
  // zählen hier NIE — sie brauchen die Anrede aus Pass A. Alle anderen
  // Wörterbuch-Namen sind eindeutig genug, auch am Satzanfang: das
  // Wörterbuch enthält bewusst keine deutschen Substantive.
  const nameAlt = [...FIRST_NAME_SET].map(escapeRe).join("|");
  const soloRe = new RegExp(`\\b(${nameAlt})\\b`, "gu");
  for (const m of [...text.matchAll(soloRe)]) {
    const name = m[1];
    if (AMBIGUOUS_FIRSTNAMES.has(name)) continue;
    entityFor(name, undefined);
  }

  // Ersetzen: längste Tokens zuerst (»Kerstin Ahrweiler« vor »Ahrweiler«).
  const jobs = entities
    .flatMap((e) => [...e.tokens].map((tok) => ({ tok, ph: e.placeholder })))
    .sort((a, b) => b.tok.length - a.tok.length);
  for (const { tok, ph } of jobs) {
    const before = text;
    text = replaceWord(text, tok, ph);
    if (before !== text) findings.push({ kind: "person", original: tok, replacement: ph });
  }

  return { text, findings };
}

/* ------------------------------------------------------------------ */
/*  Orte (Städteliste, nur hinter lokativen Präpositionen)              */
/* ------------------------------------------------------------------ */

export function applyCityPii(
  input: string,
  numberFor: (kind: "ort", value: string) => string
): PiiResult {
  let text = input;
  const findings: PiiFinding[] = [];
  const cityAlt = [...CITY_NAMES]
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join("|");
  const prepAlt = CITY_PREPOSITIONS.map(escapeRe).join("|");
  const re = new RegExp(`\\b(${prepAlt})\\s+(${cityAlt})(?![\\p{L}])`, "gu");
  const found = new Set<string>();
  text = text.replace(re, (_m, prep: string, city: string) => {
    const ph = numberFor("ort", city);
    if (!found.has(city)) {
      findings.push({ kind: "ort", original: city, replacement: ph });
      found.add(city);
    }
    return `${prep} ${ph}`;
  });
  // Einmal erkannte Städte auch ohne Präposition nachziehen (»… und
  // Bochum bleibt eng«) — konsistente Pseudonyme.
  for (const f of findings) {
    text = replaceWord(text, f.original, f.replacement);
  }
  return { text, findings };
}

/* ------------------------------------------------------------------ */
/*  Nummern-Vergabe (gleicher Wert → gleicher Platzhalter)              */
/* ------------------------------------------------------------------ */

export function createNumberer(): (kind: "firma" | "ort", value: string) => string {
  const maps: Record<string, Map<string, string>> = { firma: new Map(), ort: new Map() };
  const counters: Record<string, number> = { firma: 0, ort: 0 };
  const label: Record<string, string> = { firma: "Firma", ort: "Ort" };
  return (kind, value) => {
    const key = value.toLowerCase();
    const m = maps[kind];
    const existing = m.get(key);
    if (existing) return existing;
    const ph = `${label[kind]} ${++counters[kind]}`;
    m.set(key, ph);
    return ph;
  };
}
