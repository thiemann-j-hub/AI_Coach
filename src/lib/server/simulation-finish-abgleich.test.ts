import { describe, expect, it } from "vitest";
import { OPEN_CHARGE_HINWEIS, openChargeLage, type OpenChargeRow } from "./simulation-finish-abgleich";

/** Paket 2, C8 (12.11.2026): Was ein stehengebliebener Buchungs-Vermerk bedeutet (Abgleich-Skript). */
const now = new Date("2026-11-12T12:00:00.000Z");
const row = (over: Partial<OpenChargeRow> & { openCharge: OpenChargeRow["openCharge"] }): OpenChargeRow => ({ id: "sim-abcdefgh", status: "active", ...over });
const KEY = "sim-finish:sim-abcdefgh:0";

describe("openChargeLage", () => {
  it("junger Vermerk am aktiven Lauf: rechnet vermutlich noch", () => {
    expect(openChargeLage(row({ openCharge: { key: KEY, at: "2026-11-12T11:55:00.000Z", txId: "tx-1" } }), now)).toBe("laeuft");
  });

  it("alter Vermerk ohne Buchungsnummer: unbestätigt (Frist des Credit-Dienstes oder Prozess-Ende vor der Antwort)", () => {
    expect(openChargeLage(row({ openCharge: { key: KEY, at: "2026-11-12T10:00:00.000Z" } }), now)).toBe("unbestaetigt");
  });

  it("alter Vermerk mit Buchungsnummer: gebucht, Auswertung fehlt", () => {
    expect(openChargeLage(row({ openCharge: { key: KEY, at: "2026-11-12T10:00:00.000Z", txId: "tx-1" } }), now)).toBe("gebucht-ohne-auswertung");
  });

  it("gescheiterte Rückbuchung zählt sofort, auch am abgebrochenen Lauf", () => {
    const m = { key: KEY, at: "2026-11-12T11:59:00.000Z", txId: "tx-1", refundFailedAt: "2026-11-12T11:59:30.000Z" };
    expect(openChargeLage(row({ openCharge: m }), now)).toBe("rueckbuchung-gescheitert");
    expect(openChargeLage(row({ status: "aborted", openCharge: m }), now)).toBe("rueckbuchung-gescheitert");
  });

  it("abgebrochener Lauf mit jungem Vermerk rechnet nicht mehr", () => {
    expect(openChargeLage(row({ status: "aborted", openCharge: { key: KEY, at: "2026-11-12T11:59:00.000Z", txId: "tx-1" } }), now)).toBe("gebucht-ohne-auswertung");
  });

  it("ausgewerteter Lauf, der genau diese Buchung trägt: kein Geld offen", () => {
    expect(openChargeLage(row({ status: "finished", centralSpendTxId: "tx-1", openCharge: { key: KEY, at: "2026-11-12T10:00:00.000Z", txId: "tx-1", refundFailedAt: "2026-11-12T10:01:00.000Z" } }), now)).toBe("gedeckt");
    expect(openChargeLage(row({ status: "finished", centralSpendTxId: "tx-2", openCharge: { key: KEY, at: "2026-11-12T10:00:00.000Z", txId: "tx-1" } }), now)).toBe("gebucht-ohne-auswertung");
  });

  it("jede Lage hat einen Hinweis für den Betrieb", () => {
    for (const lage of ["laeuft", "unbestaetigt", "gebucht-ohne-auswertung", "rueckbuchung-gescheitert", "gedeckt"] as const) {
      expect(OPEN_CHARGE_HINWEIS[lage].length).toBeGreaterThan(20);
    }
  });
});
