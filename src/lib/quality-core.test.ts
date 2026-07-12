import { describe, it, expect } from "vitest";
import { checkEvidenceGrounding, collectQualityNotes } from "./quality-core";

const TRANSCRIPT =
  "Führungskraft: Ich möchte heute über die Projektziele sprechen. " +
  "Mitarbeiter:in: Das finde ich gut, ich habe dazu drei konkrete Vorschläge vorbereitet.";

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
