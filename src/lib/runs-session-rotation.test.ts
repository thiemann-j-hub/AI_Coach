import { describe, expect, it } from "vitest";
import { shouldRotateSession } from "./runs-session-rotation";

describe("shouldRotateSession (B30: Verlauf fragt nicht mehr endlos nach)", () => {
  it("rotates once for a foreign session (403 FORBIDDEN)", () => {
    expect(shouldRotateSession(403, "FORBIDDEN", false)).toBe(true);
  });

  it("rotates once for an invalid session id (400 BAD_SESSION_ID)", () => {
    expect(shouldRotateSession(400, "BAD_SESSION_ID", false)).toBe(true);
  });

  it("keeps the old self-healing for a 403/400 without a code", () => {
    expect(shouldRotateSession(403, undefined, false)).toBe(true);
    expect(shouldRotateSession(400, null, false)).toBe(true);
  });

  it("never rotates when the account itself is refused", () => {
    expect(shouldRotateSession(403, "ACCOUNT_DISABLED", false)).toBe(false);
    expect(shouldRotateSession(403, "APP_NOT_ENABLED", false)).toBe(false);
  });

  it("never rotates a second time on the same page (no loop)", () => {
    expect(shouldRotateSession(403, "FORBIDDEN", true)).toBe(false);
    expect(shouldRotateSession(400, "BAD_SESSION_ID", true)).toBe(false);
    expect(shouldRotateSession(403, undefined, true)).toBe(false);
  });

  it("ignores every other status", () => {
    expect(shouldRotateSession(401, "CENTRAL_REAUTH", false)).toBe(false);
    expect(shouldRotateSession(500, undefined, false)).toBe(false);
    expect(shouldRotateSession(200, undefined, false)).toBe(false);
  });
});
