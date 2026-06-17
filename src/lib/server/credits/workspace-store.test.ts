import { describe, it, expect, vi } from "vitest";

// workspace-store importiert transitiv credit-service -> @/auth (next-auth),
// dessen interner "next/server"-Import unter Vitest nicht aufloest. Fuer die
// REINEN Helfer hier ist der Schatten-Pfad irrelevant -> credit-service stubben.
vi.mock("@/lib/server/credits/credit-service", () => ({
  shadowAdd: async () => {},
  shadowSpend: async () => {},
  creditsCentralEnabled: () => false,
}));

import { emailDomain, freeRunClaimKey } from "./workspace-store";

/**
 * Pure-Logik des Free-Run-Gates (kein Cosmos noetig). Sichert die Regel:
 * Business-Domain -> ein Free-Run pro Domain; Freemail/leer -> ein Free-Run pro uid.
 */
describe("emailDomain", () => {
  it("lowercases and trims the domain part", () => {
    expect(emailDomain("Max.Muster@Firma.DE")).toBe("firma.de");
  });
  it("returns null for malformed input", () => {
    expect(emailDomain("not-an-email")).toBeNull();
    expect(emailDomain("trailing@")).toBeNull();
  });
});

describe("freeRunClaimKey", () => {
  it("keys business domains per domain (shared free run across the company)", () => {
    expect(freeRunClaimKey("a@acme-corp.com", "uid-1")).toBe("acme-corp.com");
    expect(freeRunClaimKey("b@acme-corp.com", "uid-2")).toBe("acme-corp.com");
  });
  it("keys freemail addresses per uid (each consumer gets their own free run)", () => {
    expect(freeRunClaimKey("x@gmail.com", "uid-1")).toBe("uid:uid-1");
    expect(freeRunClaimKey("y@gmx.de", "uid-2")).toBe("uid:uid-2");
  });
  it("keys per uid when the email is missing", () => {
    expect(freeRunClaimKey(null, "uid-9")).toBe("uid:uid-9");
    expect(freeRunClaimKey(undefined, "uid-9")).toBe("uid:uid-9");
  });
});
