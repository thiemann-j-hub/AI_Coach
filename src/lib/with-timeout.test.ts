import { describe, it, expect } from "vitest";
import { withTimeout, timeoutMs, TimeoutError } from "./with-timeout";

describe("withTimeout", () => {
  it("resolves with the value when the promise wins the race", async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, "fast")).resolves.toBe(42);
  });

  it("rejects with TimeoutError when the deadline is exceeded", async () => {
    const never = new Promise<number>(() => {});
    await expect(withTimeout(never, 10, "slow")).rejects.toBeInstanceOf(TimeoutError);
  });

  it("TimeoutError carries the TIMEOUT code and label", async () => {
    const never = new Promise<number>(() => {});
    try {
      await withTimeout(never, 10, "gemini-feedback");
      throw new Error("should have timed out");
    } catch (e: any) {
      expect(e.code).toBe("TIMEOUT");
      expect(String(e.message)).toContain("gemini-feedback");
    }
  });

  it("propagates the original rejection (not a timeout)", async () => {
    const boom = Promise.reject(new Error("boom"));
    await expect(withTimeout(boom, 1000, "x")).rejects.toThrow("boom");
  });
});

describe("timeoutMs", () => {
  it("returns the env value when valid", () => {
    process.env.__TEST_TO = "1234";
    expect(timeoutMs("__TEST_TO", 999)).toBe(1234);
    delete process.env.__TEST_TO;
  });
  it("falls back when unset or invalid", () => {
    delete process.env.__TEST_TO;
    expect(timeoutMs("__TEST_TO", 999)).toBe(999);
    process.env.__TEST_TO = "nope";
    expect(timeoutMs("__TEST_TO", 999)).toBe(999);
    delete process.env.__TEST_TO;
  });
});
