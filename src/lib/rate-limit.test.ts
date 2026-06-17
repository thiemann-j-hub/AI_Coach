import { describe, it, expect, afterEach, vi } from "vitest";
import { checkRateLimit, rateLimitKey } from "./rate-limit";

afterEach(() => {
  vi.useRealTimers();
});

describe("checkRateLimit", () => {
  it("allows requests up to the limit, then blocks with 429", () => {
    const key = "test:allow-then-block";
    expect(checkRateLimit(key, 2, 60_000)).toBeNull();
    expect(checkRateLimit(key, 2, 60_000)).toBeNull();
    const blocked = checkRateLimit(key, 2, 60_000);
    expect(blocked).not.toBeNull();
    expect(blocked?.status).toBe(429);
  });

  it("resets the window after it elapses", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-16T10:00:00Z"));
    const key = "test:window-reset";
    expect(checkRateLimit(key, 1, 1_000)).toBeNull();
    expect(checkRateLimit(key, 1, 1_000)?.status).toBe(429); // over limit within window
    vi.setSystemTime(new Date("2026-06-16T10:00:02Z")); // +2s > window
    expect(checkRateLimit(key, 1, 1_000)).toBeNull(); // window reset
  });
});

describe("rateLimitKey", () => {
  it("derives an IP-scoped key from x-forwarded-for", () => {
    const req = new Request("https://x.test/api", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    });
    expect(rateLimitKey(req, "analyze")).toBe("analyze:203.0.113.7");
  });
  it("falls back to 'unknown' without the header", () => {
    const req = new Request("https://x.test/api");
    expect(rateLimitKey(req, "credits")).toBe("credits:unknown");
  });
});
