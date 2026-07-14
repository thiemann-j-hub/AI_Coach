import { describe, it, expect } from "vitest";
import { isCsrfViolation, isCsrfExempt, MUTATING_METHODS } from "./csrf-origin";

const OK = "https://app.pulsenorth.ai";

describe("csrf-origin (R7)", () => {
  it("blockt mutierenden Request mit fremder Origin", () => {
    expect(isCsrfViolation({ method: "POST", pathname: "/api/analyze", origin: "https://evil.com", allowedOrigin: OK })).toBe(true);
  });

  it("erlaubt Same-Origin-Mutation", () => {
    expect(isCsrfViolation({ method: "POST", pathname: "/api/analyze", origin: OK, allowedOrigin: OK })).toBe(false);
  });

  it("fail-open bei GET (nicht mutating)", () => {
    expect(isCsrfViolation({ method: "GET", pathname: "/api/analyze", origin: "https://evil.com", allowedOrigin: OK })).toBe(false);
  });

  it("fail-open bei fehlender Origin (server-zu-server / curl)", () => {
    expect(isCsrfViolation({ method: "POST", pathname: "/api/analyze", origin: null, allowedOrigin: OK })).toBe(false);
  });

  it("fail-open bei fehlendem allowedOrigin (AUTH_URL unkonfiguriert)", () => {
    expect(isCsrfViolation({ method: "POST", pathname: "/api/analyze", origin: "https://evil.com", allowedOrigin: null })).toBe(false);
  });

  it("kaputte Origin gilt als fremd → block", () => {
    expect(isCsrfViolation({ method: "POST", pathname: "/api/analyze", origin: "nicht-url", allowedOrigin: OK })).toBe(true);
  });

  it("Stripe-Webhook ist exempt (server-zu-server, signaturgeprüft)", () => {
    expect(isCsrfExempt("/api/webhooks/stripe")).toBe(true);
    expect(isCsrfViolation({ method: "POST", pathname: "/api/webhooks/stripe", origin: "https://stripe.com", allowedOrigin: OK })).toBe(false);
  });

  it("next-auth-Pfad ist exempt (eigener CSRF-State)", () => {
    expect(isCsrfExempt("/api/auth/callback/microsoft-entra-id")).toBe(true);
  });

  it("account-Löschung (DELETE) ist NICHT exempt → CSRF-geschützt", () => {
    expect(isCsrfExempt("/api/account")).toBe(false);
    expect(isCsrfViolation({ method: "DELETE", pathname: "/api/account", origin: "https://evil.com", allowedOrigin: OK })).toBe(true);
  });

  it("Substring-Footgun vermieden: /api/authoring ist NICHT exempt", () => {
    expect(isCsrfExempt("/api/authoring")).toBe(false);
  });

  it("basePath-robust: /coach/api/auth/… ist exempt", () => {
    expect(isCsrfExempt("/coach/api/auth/session")).toBe(true);
  });

  it("alle mutierenden Methoden erfasst", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) expect(MUTATING_METHODS.has(m)).toBe(true);
    expect(MUTATING_METHODS.has("GET")).toBe(false);
  });
});
