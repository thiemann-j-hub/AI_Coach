import { describe, it, expect } from "vitest";
import { isMagicLinkOid } from "./magic-link-oid";

describe("isMagicLinkOid — B12: Magic-Link-Lernende haben keine App-Freigabe", () => {
  it("erkennt die vom CreditService vergebene Kennung ml:<uuid>", () => {
    expect(isMagicLinkOid("ml:9c60a4f0-3b1e-4f0a-9d7e-1f2a3b4c5d6e")).toBe(true);
  });

  it("Entra-oids (GUIDs, auch persönliche Microsoft-Konten) sind keine Magic-Link-Kennung", () => {
    expect(isMagicLinkOid("15d438d2-61d9-4c1b-8a7e-0c2f6f0a1b2c")).toBe(false);
    expect(isMagicLinkOid("00000000-0000-0000-b89a-e62ba1ab6978")).toBe(false);
  });

  it("leer / fehlend / anderes Präfix → false", () => {
    expect(isMagicLinkOid(null)).toBe(false);
    expect(isMagicLinkOid(undefined)).toBe(false);
    expect(isMagicLinkOid("")).toBe(false);
    expect(isMagicLinkOid("xml:abc")).toBe(false);
    expect(isMagicLinkOid("ML:abc")).toBe(false);
  });
});
