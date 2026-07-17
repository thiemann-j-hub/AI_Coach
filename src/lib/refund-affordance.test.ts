import { describe, it, expect } from "vitest";
import {
  REFUND_WINDOW_MS,
  refundEligibleOnDelete,
  refundWindowFrom,
} from "./refund-affordance";

/**
 * Vertrag der Refund-Affordanz (SSOT Server + Client):
 * - refundEligibleOnDelete spiegelt EXAKT die Refund-Bedingung aus
 *   /api/runs/delete (creditsCentralEnabled() && run.centralSpendTxId) —
 *   das ist das Feld `refundOnDelete` in /api/runs/get.
 * - refundWindowFrom ist die EINE Fensterrechnung fuer Delete-Endpoint
 *   (withinWindow) und Button-Anzeige (refundable + "Erstattung bis HH:MM").
 */
describe("refundEligibleOnDelete", () => {
  it("true NUR wenn zentraler Pfad aktiv UND spend-Transaktion gespeichert", () => {
    expect(refundEligibleOnDelete(true, "tx_abc123")).toBe(true);
  });

  it("false ohne centralSpendTxId (Alt-Runs / Gratis-Pfad) — Button darf keine Erstattung versprechen", () => {
    expect(refundEligibleOnDelete(true, null)).toBe(false);
    expect(refundEligibleOnDelete(true, undefined)).toBe(false);
    expect(refundEligibleOnDelete(true, "")).toBe(false);
  });

  it("false bei CREDITS_CENTRAL=off, auch mit gespeicherter txId (Loeschen ist dann neutral)", () => {
    expect(refundEligibleOnDelete(false, "tx_abc123")).toBe(false);
    expect(refundEligibleOnDelete(false, null)).toBe(false);
  });
});

describe("refundWindowFrom", () => {
  const created = "2026-07-14T12:00:00.000Z";
  const createdMs = Date.parse(created);

  it("innerhalb des 10-Min-Fensters (Grenze inklusiv, wie /api/runs/delete)", () => {
    expect(refundWindowFrom(created, createdMs + 1_000).withinWindow).toBe(true);
    expect(refundWindowFrom(created, createdMs + REFUND_WINDOW_MS).withinWindow).toBe(true);
  });

  it("nach Ablauf des Fensters false", () => {
    expect(refundWindowFrom(created, createdMs + REFUND_WINDOW_MS + 1).withinWindow).toBe(false);
  });

  it("windowEndsAtMs = createdAt + 10 Min (Anzeige 'Erstattung bis …')", () => {
    const w = refundWindowFrom(created, createdMs + 1_000);
    expect(w.windowEndsAtMs).toBe(createdMs + REFUND_WINDOW_MS);
  });

  it("fail-closed: createdAt null/undefined/ungueltig ⇒ nie im Fenster, kein Fenster-Ende", () => {
    for (const bad of [null, undefined, "kein-datum"] as const) {
      const w = refundWindowFrom(bad, createdMs);
      expect(w.withinWindow).toBe(false);
      expect(w.windowEndsAtMs).toBeNull();
    }
  });

  it("createdAt minimal in der Zukunft (Uhren-Skew) bleibt im Fenster — Verhalten wie bisher im Delete-Endpoint", () => {
    expect(refundWindowFrom(created, createdMs - 5_000).withinWindow).toBe(true);
  });
});
