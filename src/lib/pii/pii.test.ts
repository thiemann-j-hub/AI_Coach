import { describe, expect, it } from "vitest";
import {
  applyCityPii,
  applyOrgPii,
  applyPersonPii,
  applyStructuredPii,
  createNumberer,
  isValidIban,
  isValidLuhn,
} from "./pii";
import { sanitizeTranscript, sanitizeTranscriptWithFindings } from "../transcript-utils";

/* ------------------------------------------------------------------ */
/*  Prüfsummen                                                          */
/* ------------------------------------------------------------------ */

describe("Prüfsummen (Presidio-Lektion: validieren statt nur mustern)", () => {
  it("IBAN: gültige DE-IBAN erkannt, Zahlendreher fällt durch", () => {
    expect(isValidIban("DE89 3704 0044 0532 0130 00")).toBe(true);
    expect(isValidIban("DE89370400440532013000")).toBe(true);
    expect(isValidIban("DE89370400440532013001")).toBe(false);
    expect(isValidIban("XX00123")).toBe(false);
  });

  it("Luhn: Visa-Testnummer valide, verfälschte nicht", () => {
    expect(isValidLuhn("4111 1111 1111 1111")).toBe(true);
    expect(isValidLuhn("4111 1111 1111 1112")).toBe(false);
    expect(isValidLuhn("1234")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  Strukturierte PII                                                   */
/* ------------------------------------------------------------------ */

describe("applyStructuredPii", () => {
  it("maskiert IBAN nur bei gültiger Prüfsumme", () => {
    const r = applyStructuredPii(
      "Überweise auf DE89 3704 0044 0532 0130 00, nicht auf DE00 1111 2222 3333 4444 55."
    );
    expect(r.text).toContain("[IBAN]");
    expect(r.text).toContain("DE00 1111 2222 3333 4444 55");
    expect(r.findings.filter((f) => f.kind === "iban")).toHaveLength(1);
  });

  it("interne Nummern über Kontextwort — Label bleibt, Wert fällt", () => {
    const r = applyStructuredPii("Ihre Personalnummer: 88-1234/56 und das Aktenzeichen AZ 12-333.");
    expect(r.text).toContain("Personalnummer: [NUMMER]");
    expect(r.text).toContain("Aktenzeichen [NUMMER]");
  });

  it("Geburtsdatum nur im Geburts-Kontext — Termindatum bleibt lesbar", () => {
    const r = applyStructuredPii(
      "Sie ist geboren am 12.03.1985. Der Termin am 05.08.2026 bleibt bestehen."
    );
    expect(r.text).toContain("geboren am [GEBURTSDATUM]");
    expect(r.text).toContain("05.08.2026");
  });

  it("Telefon: 0/+-Anlaut nötig — Datumsangaben fallen nicht mehr unter [TEL]", () => {
    const r = applyStructuredPii("Ruf an unter 0171 234 56 78. Am 05.08.2026 war das Meeting.");
    expect(r.text).toContain("[TEL]");
    expect(r.text).toContain("05.08.2026");
  });

  it("Adresse + PLZ/Ort + Kfz", () => {
    const r = applyStructuredPii("Sie wohnt in der Feldbergstraße 12a, 60486 Frankfurt. Kennzeichen F-AB 1234.");
    expect(r.text).toContain("[ADRESSE]");
    expect(r.text).toContain("[PLZ_ORT]");
    expect(r.text).toContain("[KFZ]");
  });
});

/* ------------------------------------------------------------------ */
/*  Firmen                                                              */
/* ------------------------------------------------------------------ */

describe("Regressionen aus dem Härtefall-Korpus (Test-Runde 11.08.)", () => {
  it("BUG-1: »45000 Euro« ist eine Geschäftszahl, keine PLZ", () => {
    const r = applyStructuredPii("Das Budget von 45000 Euro steht, 12000 Stück sind bestellt.");
    expect(r.text).toContain("45000 Euro");
    expect(r.text).toContain("12000 Stück");
    // Echte PLZ+Ort wird weiterhin maskiert.
    expect(applyStructuredPii("Sitz ist 40213 Düsseldorf.").text).toContain("[PLZ_ORT]");
  });

  it("BUG-2: mehrgliedrige IDs vollständig (Steuer-ID, SV-Nummer mit Buchstabe)", () => {
    const r = applyStructuredPii("Steuer-ID 12 345 678 901, SV-Nummer 65 170839 J 003.");
    expect(r.text).toBe("Steuer-ID [NUMMER], SV-Nummer [NUMMER].");
  });

  it("BUG-3: »Police Nr. AB-9912/22« — Nr.-Zusatz zwischen Label und Wert", () => {
    expect(applyStructuredPii("Police Nr. AB-9912/22 läuft aus.").text).toBe(
      "Police Nr. [NUMMER] läuft aus."
    );
  });

  it("BUG-3b: zwei Kontext-Nummern im selben Satz — die zweite wird nicht verschluckt", () => {
    expect(
      applyStructuredPii("Ihre Personalnummer: 88-1234/56 und das Aktenzeichen AZ 12-333.").text
    ).toBe("Ihre Personalnummer: [NUMMER] und das Aktenzeichen [NUMMER].");
  });

  it("BUG-4: Vorname am SATZANFANG wird erkannt (»Sebastian hat …«)", () => {
    const r = applyPersonPii("Sebastian hat das übernommen. Melanie unterstützt ihn.", 1);
    expect(r.text).not.toContain("Sebastian");
    expect(r.text).not.toContain("Melanie");
    // Ambige Namen bleiben ohne Anrede unangetastet.
    expect(applyPersonPii("Ernst gemeint war das nicht.", 1).text).toContain("Ernst gemeint");
  });

  it("BUG-5: englische Anrede + Ortspräposition (Coach kann de/en)", () => {
    const p = applyPersonPii("I spoke to Mr Wagner yesterday.", 1);
    expect(p.text).toContain("Mr Person 1");
    const c = applyCityPii("Erik will call from Bochum today.", createNumberer());
    expect(c.text).toContain("from Ort 1");
  });
});

describe("applyOrgPii", () => {
  it("Rechtsform-Firmen werden pseudonymisiert, spätere Nennung folgt", () => {
    const r = applyOrgPii(
      "Die Bergmann Logistik GmbH liefert zu spät. Bergmann hat das zugesagt.",
      createNumberer()
    );
    expect(r.text).not.toContain("Bergmann");
    expect(r.text).toContain("Firma 1");
  });

  it("Trigger »Kunde X« maskiert den Namen, nicht das Triggerwort — Allerweltswörter nie", () => {
    const num = createNumberer();
    const r = applyOrgPii("Der Kunde Storch will kündigen. Wir sollten dem Kunden Feedback geben.", num);
    expect(r.text).toContain("Kunde Firma 1");
    expect(r.text).toContain("Kunden Feedback");
  });
});

/* ------------------------------------------------------------------ */
/*  Dritte Personen                                                     */
/* ------------------------------------------------------------------ */

describe("applyPersonPii", () => {
  it("Anrede-Heuristik: »Herr Wagner« + spätere Nennung »Wagner«", () => {
    const r = applyPersonPii("Dann hat Herr Wagner abgesagt. Wagner war sauer.", 3);
    expect(r.text).toBe("Dann hat Herr Person 3 abgesagt. Person 3 war sauer.");
  });

  it("Konsolidierung (Video-Fall Ahrweiler): volle/kurze/Anrede-Form = DIESELBE Person", () => {
    const r = applyPersonPii(
      "Kerstin Ahrweiler meldete den Fall. Frau Ahrweiler bestätigte. Ahrweiler bleibt dran.",
      1
    );
    expect(r.text).not.toContain("Ahrweiler");
    expect(r.text).not.toContain("Kerstin");
    // Alle drei Formen → eine Nummer.
    expect(r.text.match(/Person 1/g)?.length).toBe(3);
    expect(r.text).not.toContain("Person 2");
  });

  it("Wörterbuch-Vorname allein (»Katrin«) mitten im Satz wird erkannt", () => {
    const r = applyPersonPii("Dann hat Katrin gesagt, dass sie das übernimmt.", 1);
    expect(r.text).toContain("Person 1");
    expect(r.text).not.toContain("Katrin");
  });

  it("ambige Namen NUR mit starkem Kontext: »ernst gemeint« bleibt, »Herr Ernst« fällt", () => {
    const r1 = applyPersonPii("Das war Ernst gemeint und ist kein Spiel.", 1);
    expect(r1.text).toContain("Ernst gemeint");
    const r2 = applyPersonPii("Herr Ernst hat zugesagt.", 1);
    expect(r2.text).toContain("Herr Person 1");
  });

  it("Titel: »Frau Dr. Kim« wird erkannt", () => {
    const r = applyPersonPii("Frau Dr. Kim leitet das Audit.", 1);
    expect(r.text).toContain("Frau Dr. Person 1");
  });

  it("kein Namens-Fund → Text unverändert (keine Platzhalter-Halluzination)", () => {
    const input = "Das Team bespricht am Montag das Budget für das Projekt.";
    const r = applyPersonPii(input, 1);
    expect(r.text).toBe(input);
    expect(r.findings).toHaveLength(0);
  });

  it("Wochentag als »Nachname« zerstört nicht den Kalender (Anna Montag)", () => {
    const r = applyPersonPii("Anna Montag kommt. Am Montag ist das Meeting.", 1);
    // Der volle Name fällt, der alleinstehende Wochentag bleibt.
    expect(r.text).toContain("Am Montag ist das Meeting.");
    expect(r.text).not.toContain("Anna");
  });
});

/* ------------------------------------------------------------------ */
/*  Orte                                                                */
/* ------------------------------------------------------------------ */

describe("applyCityPii", () => {
  it("Stadt nur hinter lokativer Präposition — »beim Essen« bleibt Essen", () => {
    const r = applyCityPii("Das Werk in Bochum meldet Verzug. Beim Essen sprachen wir darüber.", createNumberer());
    expect(r.text).toContain("in Ort 1");
    expect(r.text).toContain("Beim Essen");
  });

  it("einmal erkannte Stadt wird überall nachgezogen (konsistentes Pseudonym)", () => {
    const r = applyCityPii("Der Standort in Bochum wächst. Bochum braucht Personal.", createNumberer());
    expect(r.text).not.toContain("Bochum");
    expect(r.text.match(/Ort 1/g)?.length).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/*  Orchestrierung (sanitizeTranscript, End-to-End)                     */
/* ------------------------------------------------------------------ */

describe("sanitizeTranscript — Netz 1 end-to-end", () => {
  const opts = {
    leaderLabel: "Anna Müller",
    employeeLabel: "Thomas Schmidt",
    detectedSpeakers: ["Anna Müller", "Thomas Schmidt"],
    extraTerms: ["GreenFjord"],
  };

  it("der Video-Fall: Kundin, IBAN, Adresse, Dritte — alles maskiert, Zuordnung intakt", () => {
    const input = [
      "Anna Müller: Frau Kerstin Ahrweiler hat sich gemeldet, IBAN DE89 3704 0044 0532 0130 00.",
      "Thomas Schmidt: Ihre Adresse ist die Feldbergstraße 12, sie ist geboren am 09.07.1990.",
      "Anna Müller: Herr Wagner von der Bergmann Logistik GmbH ruft aus Bochum an. GreenFjord läuft.",
    ].join("\n");
    const out = sanitizeTranscript(input, opts);

    expect(out).toContain("Führungskraft:");
    expect(out).toContain("Mitarbeiter:in:");
    for (const leak of [
      "Ahrweiler", "Kerstin", "DE89", "Feldbergstraße", "09.07.1990",
      "Wagner", "Bergmann", "Bochum", "GreenFjord", "Anna", "Schmidt",
    ]) {
      expect(out).not.toContain(leak);
    }
    expect(out).toContain("[IBAN]");
    expect(out).toContain("[ADRESSE]");
    expect(out).toContain("[GEBURTSDATUM]");
    expect(out).toContain("Firma 1");
    expect(out).toContain("Ort 1");
  });

  it("Findings-Steckdose: jedes Replacement ist dokumentiert (Mapping bleibt clientseitig)", () => {
    const { text, findings } = sanitizeTranscriptWithFindings(
      "Anna Müller: Herr Wagner zahlt auf DE89 3704 0044 0532 0130 00.",
      opts
    );
    expect(text).toContain("[IBAN]");
    const kinds = findings.map((f) => f.kind);
    expect(kinds).toContain("iban");
    expect(kinds).toContain("person");
    const wagner = findings.find((f) => f.original === "Wagner");
    expect(wagner?.replacement).toMatch(/^Person \d+$/);
  });

  it("P1-Kompatibilität: Sprecher-Labels bleiben byte-identisch (Führungskraft/Mitarbeiter:in)", () => {
    const out = sanitizeTranscript("Anna Müller: Hallo!\nThomas Schmidt: Guten Tag.", opts);
    expect(out).toContain("Führungskraft: Hallo!");
    expect(out).toContain("Mitarbeiter:in: Guten Tag.");
  });
});
