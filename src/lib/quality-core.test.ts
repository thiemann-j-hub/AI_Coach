import { describe, it, expect } from "vitest";
import { checkEvidenceGrounding, collectQualityNotes } from "./quality-core";

const TRANSCRIPT =
  "Führungskraft: Ich möchte heute über die Projektziele sprechen. " +
  "Mitarbeiter:in: Das finde ich gut, ich habe dazu drei konkrete Vorschläge vorbereitet.";

describe("checkEvidenceGrounding — P2: Rollenspiel-Rubrik (S-Keys) über denselben Check", () => {
  const SIM_TRANSCRIPT =
    "Teilnehmer:in: Ich schlage vor, wir vereinbaren einen konkreten nächsten Schritt bis Freitag. " +
    "Dr. Robin Vance: Von mir aus — aber nur, wenn das Audit-Thema zuerst geklärt wird.";

  it("S1–S5-Evidence läuft als id durch — fabrizierte Rubrik-Kette wird error", () => {
    const notes = checkEvidenceGrounding(
      [
        { id: "S5", score: 3, evidence: ["Dieses Rubrik-Zitat wurde nie gesagt im Gespräch"] },
        // Sprecher-Prefix im Zitat wird gestrippt (evidenceNeedle) — grounded.
        {
          id: "S1",
          score: 4,
          evidence: ["Führungskraft: Ich schlage vor, wir vereinbaren einen konkreten nächsten Schritt bis Freitag."],
        },
      ],
      SIM_TRANSCRIPT
    );
    const err = notes.filter((n) => n.severity === "error");
    expect(err).toHaveLength(1);
    expect(err[0].field).toBe("S5");
    expect(notes.filter((n) => n.field === "S1")).toHaveLength(0);
  });
});

describe("checkEvidenceGrounding — §2.2 error-Eskalation", () => {
  it("GESAMTE Evidenz fabriziert + Score gesetzt → error EVIDENCE_ALL_UNGROUNDED", () => {
    const notes = checkEvidenceGrounding(
      [
        {
          id: "C1",
          score: 3,
          evidence: ["Dieses Zitat existiert nirgendwo im Gespräch", "Auch dieses ist frei erfunden worden"],
        },
      ],
      TRANSCRIPT
    );
    const err = notes.filter((n) => n.severity === "error");
    expect(err).toHaveLength(1);
    expect(err[0].code).toBe("EVIDENCE_ALL_UNGROUNDED");
    expect(err[0].field).toBe("C1");
    // Einzel-Warns bleiben zusätzlich erhalten (Transparenz).
    expect(notes.filter((n) => n.code === "EVIDENCE_NOT_GROUNDED")).toHaveLength(2);
  });

  it("teilweise groundete Evidenz → NUR warn, KEIN error (legitime Paraphrase möglich)", () => {
    const notes = checkEvidenceGrounding(
      [
        {
          id: "C2",
          score: 2,
          evidence: ["ich habe dazu drei konkrete Vorschläge vorbereitet", "Dieses Zitat ist frei erfunden worden"],
        },
      ],
      TRANSCRIPT
    );
    expect(notes.filter((n) => n.severity === "error")).toHaveLength(0);
    expect(notes.filter((n) => n.code === "EVIDENCE_NOT_GROUNDED")).toHaveLength(1);
  });

  it("fabrizierte Evidenz OHNE Score → kein error (nichts auszuliefern)", () => {
    const notes = checkEvidenceGrounding(
      [{ id: "C3", score: null, evidence: ["Dieses Zitat ist ebenfalls frei erfunden"] }],
      TRANSCRIPT
    );
    expect(notes.filter((n) => n.severity === "error")).toHaveLength(0);
  });

  it("vollständig groundete Evidenz → keinerlei Notes (Negativ-Test)", () => {
    const notes = checkEvidenceGrounding(
      [
        {
          id: "C4",
          score: 4,
          evidence: ["Ich möchte heute über die Projektziele sprechen"],
        },
      ],
      TRANSCRIPT
    );
    expect(notes).toHaveLength(0);
  });

  it("nur unprüfbar-kurze Zitate (<8 Zeichen Kern) → kein error", () => {
    const notes = checkEvidenceGrounding([{ id: "C5", score: 3, evidence: ["ok", "gut"] }], TRANSCRIPT);
    expect(notes).toHaveLength(0);
  });

  it("Interpunktions-Drift groundet trotzdem (CI-Flake-Ursache)", () => {
    const notes = checkEvidenceGrounding(
      [
        {
          id: "C7",
          score: 3,
          // Zitat weicht in Komma/Punkt/Gedankenstrich vom Transkript ab —
          // Wortlaut identisch => KEIN Fabrikat.
          evidence: ["Das finde ich gut. Ich habe dazu — drei konkrete Vorschläge vorbereitet!"],
        },
      ],
      TRANSCRIPT
    );
    expect(notes).toHaveLength(0);
  });

  it("Sprecher-Prefix wird gestrippt (groundet trotz Label)", () => {
    const notes = checkEvidenceGrounding(
      [{ id: "C6", score: 3, evidence: ["Führungskraft: Ich möchte heute über die Projektziele sprechen"] }],
      TRANSCRIPT
    );
    expect(notes).toHaveLength(0);
  });
});

describe("collectQualityNotes — Integration", () => {
  it("error-Note erreicht die Gesamtliste (Basis für enforce-blocked)", () => {
    const notes = collectQualityNotes(
      {
        summary: "Alles gut.",
        rewrites: [],
        competency_ratings: [
          { id: "C1", score: 3, evidence: ["Komplett ausgedachtes Beleg-Zitat ohne Treffer"] },
        ],
      },
      TRANSCRIPT
    );
    expect(notes.some((n) => n.severity === "error" && n.code === "EVIDENCE_ALL_UNGROUNDED")).toBe(true);
  });
});

describe("checkEvidenceGrounding — N4-84: Sprecher-Präfix ist Metadatum, verglichen wird der Wortlaut", () => {
  // Rohe Beiträge OHNE Labels (so übergibt /api/simulation/finish den Vergleichstext seit O1a).
  const RAW =
    "Okay, ich merke, ich bin zu schnell mit Vorschlägen. Lass mich zurücktreten. Was genau befürchtest du, wenn du etwas abgibst und es nicht perfekt wird?\n" +
    "Naja, ich hab doch erst vor drei Monaten die Rolle übernommen und will einfach einen guten Job machen.\n" +
    "Das ist ein guter Vorschlag. Lass uns festhalten: Erstens, das Angebot geht heute bis 17 Uhr raus, die Juniors prüfen vorher Anhänge und Format. Zweitens, du schreibst bis Freitag einen kurzen Delegationsplan.";

  // Nur die Einzel-Warnungen zählen (der ALL_UNGROUNDED-error folgt mechanisch, wenn alle fehlen).
  const grounded = (evidence: string[], hay = RAW) =>
    checkEvidenceGrounding([{ id: "S9", score: 3, evidence }], hay).filter(
      (n) => n.field === "S9" && n.code === "EVIDENCE_NOT_GROUNDED"
    );

  it("„Teilnehmer:in:“ vor einem Zitat aus der MITTE des Beitrags → gegroundet (vorher: fabriziert)", () => {
    expect(grounded(["Teilnehmer:in: Was genau befürchtest du, wenn du etwas abgibst und es nicht perfekt wird?"])).toHaveLength(0);
  });

  it.each([
    ["Dr. Robin Vance: Naja, ich hab doch erst vor drei Monaten die Rolle übernommen"],
    ["Führungskraft (FK): Lass uns festhalten: Erstens, das Angebot geht heute bis 17 Uhr raus"],
    ["Person 1: Okay, ich merke, ich bin zu schnell mit Vorschlägen."],
    ["Alex Morgan / Kundenverantwortliche: erst vor drei Monaten die Rolle übernommen und will einfach"],
  ])("beliebige Label-Formen werden nicht zum Zitat gezählt: %s", (q) => {
    expect(grounded([q])).toHaveLength(0);
  });

  it("Auslassungspunkte: jedes Teilstück muss wörtlich sitzen", () => {
    expect(grounded(["Teilnehmer:in: Angebot geht heute bis 17 Uhr raus... du schreibst bis Freitag einen kurzen Delegationsplan"])).toHaveLength(0);
    // Paraphrasiertes Teilstück (so stand es im echten Lauf 27.09.) bleibt ungegroundet.
    expect(grounded(["Teilnehmer:in: Angebot geht heute bis 17 Uhr raus... Delegationsplan bis Freitag"])).toHaveLength(1);
    expect(grounded(["Teilnehmer:in: Angebot geht heute bis 17 Uhr raus… und du kündigst Kim die Zusammenarbeit"])).toHaveLength(1);
  });

  it("erfundener Kopf mit echtem Schwanz rutscht NICHT durch (max. 4 führende Wörter Toleranz)", () => {
    expect(grounded(["Du hast völlig recht gehabt und ich sage: Lass mich zurücktreten. Was genau befürchtest du"])).toHaveLength(1);
    expect(grounded(["Ich habe versagt und das weiß ich"])).toHaveLength(1);
  });

  it("kurze echte Zitate bleiben gültig", () => {
    expect(grounded(["Teilnehmer:in: Lass mich zurücktreten."])).toHaveLength(0);
  });

  it("Label-Haystack (Analyse-Weg) funktioniert weiter", () => {
    const LABELED = "Führungskraft: Ich erwarte, dass der Kunde spätestens nach zwei Tagen einen Zwischenstand bekommt.\nMitarbeiter: Das verstehe ich.";
    expect(grounded(["Führungskraft: Ich erwarte, dass der Kunde spätestens nach zwei Tagen einen Zwischenstand bekommt."], LABELED)).toHaveLength(0);
    expect(grounded(["FK: der Kunde spätestens nach zwei Tagen einen Zwischenstand bekommt"], LABELED)).toHaveLength(0);
  });
});
