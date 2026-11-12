import { describe, expect, it } from "vitest";
import { MAX_EUR_PER_CREDIT, RUN_CREDITS, costNote, formatMaxEur, maxEurHint, showEurPrice } from "./pricing-display";

// Intl setzt vor dem €-Zeichen ein geschütztes Leerzeichen (U+00A0) — für den Vergleich normalisieren.
const plain = (s: string) => s.replace(/ /g, " ");

describe("pricing-display (Preis vor dem Klick, 29.09.2026)", () => {
  it("fester Maximalkurs 4,90 € je Credit, ein Lauf = 1 Credit", () => {
    expect(MAX_EUR_PER_CREDIT).toBe(4.9);
    expect(RUN_CREDITS).toBe(1);
  });

  it("formatiert den Maximalpreis in der Sprache der Oberfläche", () => {
    expect(plain(formatMaxEur(1, "de"))).toBe("4,90 €");
    expect(formatMaxEur(1, "en")).toBe("€4.90");
    expect(plain(formatMaxEur(3, "de"))).toBe("14,70 €");
  });

  it("setzt den Betrag in die übersetzte Vorlage ein", () => {
    expect(plain(maxEurHint("bis zu {eur}", "de"))).toBe("bis zu 4,90 €");
    expect(maxEurHint("up to {eur}", "en")).toBe("up to €4.90");
  });

  it("fällt bei unbekannter Sprache nicht um", () => {
    expect(formatMaxEur(1, "xx-invalid-locale-tag-!!")).toMatch(/4[.,]90/);
  });
});

describe("Eurobetrag nur für Admins und Selbstzahler (U23, Owner-Entscheid 12.11.2026)", () => {
  it("Admin (auch eigenes Konto ohne Firma) sieht den Betrag, Mitglied nicht", () => {
    expect(showEurPrice("admin")).toBe(true);
    expect(showEurPrice("member")).toBe(false);
  });

  it("Rolle nicht bestimmbar: Betrag bleibt sichtbar. Rolle lädt noch: kein Betrag", () => {
    expect(showEurPrice(null)).toBe(true);
    expect(showEurPrice(undefined)).toBe(false);
  });

  it("mit Betrag: setzt ihn in den Satz ein", () => {
    expect(costNote("Die Auswertung kostet 1 Credit ({eur}).", "bis zu 4,90 €")).toBe("Die Auswertung kostet 1 Credit (bis zu 4,90 €).");
    expect(costNote("1 Credit entspricht {eur}.", "bis zu 4,90 €")).toBe("1 Credit entspricht bis zu 4,90 €.");
  });

  it("ohne Betrag: die Klammer fällt weg, der Satz bleibt", () => {
    expect(costNote("Gespräch und Coach-Pausen sind kostenlos – erst die Auswertung kostet 1 Credit ({eur}).", null)).toBe(
      "Gespräch und Coach-Pausen sind kostenlos – erst die Auswertung kostet 1 Credit."
    );
    expect(costNote("Die Analyse kostet 1 Credit ({eur}). Bei einem technischen Fehler wird er erstattet.", null)).toBe(
      "Die Analyse kostet 1 Credit. Bei einem technischen Fehler wird er erstattet."
    );
    // Die Klammer darf weitere Wörter enthalten (Interview: „(bis zu {eur})“).
    expect(costNote("Das Interview kostet beim Abschluss 1 Credit (bis zu {eur}).", null)).toBe("Das Interview kostet beim Abschluss 1 Credit.");
  });

  it("ohne Betrag und ohne Klammer: der Satz besteht nur aus dem Betrag und entfällt", () => {
    expect(costNote("1 Credit entspricht {eur}.", null)).toBe("");
  });
});
