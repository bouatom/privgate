import { describe, it, expect, beforeEach } from "vitest";
import { checkDeviceRateLimit, resetDeviceRateLimit, clearAllRateLimits } from "./rate-limit";

describe("rate-limit", () => {
  beforeEach(() => {
    clearAllRateLimits();
  });

  it("allows requests within limit", () => {
    const deviceId = "device-1";
    for (let i = 0; i < 30; i++) {
      const result = checkDeviceRateLimit(deviceId, 60000, 30);
      expect(result.ok).toBe(true);
      expect((result as { ok: true; remaining: number }).remaining).toBe(29 - i);
    }
  });

  it("rejects requests exceeding limit", () => {
    const deviceId = "device-1";
    // First 30 requests should succeed
    for (let i = 0; i < 30; i++) {
      const result = checkDeviceRateLimit(deviceId, 60000, 30);
      expect(result.ok).toBe(true);
    }
    // 31st request should be rejected
    const result = checkDeviceRateLimit(deviceId, 60000, 30);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; retryAfter: number }).retryAfter).toBeGreaterThan(0);
    expect((result as { ok: false; retryAfter: number }).retryAfter).toBeLessThanOrEqual(60000);
  });

  it("resets bucket after window expires", async () => {
    const deviceId = "device-1";
    const windowMs = 100; // 100ms for testing
    // Fill up the bucket
    for (let i = 0; i < 5; i++) {
      checkDeviceRateLimit(deviceId, windowMs, 5);
    }
    // Should be rate-limited
    let result = checkDeviceRateLimit(deviceId, windowMs, 5);
    expect(result.ok).toBe(false);

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Should be allowed again
    result = checkDeviceRateLimit(deviceId, windowMs, 5);
    expect(result.ok).toBe(true);
  });

  it("maintains independent limits per device", () => {
    const device1 = "device-1";
    const device2 = "device-2";

    // Device 1: use 25 of 30
    for (let i = 0; i < 25; i++) {
      checkDeviceRateLimit(device1, 60000, 30);
    }
    // Device 1 should have 5 remaining
    const result1 = checkDeviceRateLimit(device1, 60000, 30);
    expect((result1 as { ok: true; remaining: number }).remaining).toBe(4);

    // Device 2 should still have 29 remaining (fresh device)
    const result2 = checkDeviceRateLimit(device2, 60000, 30);
    expect((result2 as { ok: true; remaining: number }).remaining).toBe(29);
  });

  it("resetDeviceRateLimit clears bucket", () => {
    const deviceId = "device-1";
    for (let i = 0; i < 30; i++) {
      checkDeviceRateLimit(deviceId, 60000, 30);
    }
    // Should be rate-limited
    let result = checkDeviceRateLimit(deviceId, 60000, 30);
    expect(result.ok).toBe(false);

    // Reset
    resetDeviceRateLimit(deviceId);

    // Should be allowed again
    result = checkDeviceRateLimit(deviceId, 60000, 30);
    expect(result.ok).toBe(true);
  });

  it("retryAfter reflects time remaining in window", () => {
    const deviceId = "device-1";
    const windowMs = 10000;
    for (let i = 0; i < 30; i++) {
      checkDeviceRateLimit(deviceId, windowMs, 30);
    }
    const result = checkDeviceRateLimit(deviceId, windowMs, 30);
    expect(result.ok).toBe(false);
    // retryAfter should be close to windowMs (within 100ms tolerance for timing)
    expect((result as { ok: false; retryAfter: number }).retryAfter).toBeGreaterThan(9900);
    expect((result as { ok: false; retryAfter: number }).retryAfter).toBeLessThanOrEqual(10000);
  });
});
