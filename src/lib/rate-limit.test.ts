import { describe, it, expect, beforeEach } from "vitest";
import {
  checkDeviceRateLimit,
  resetDeviceRateLimit,
  clearAllRateLimits,
  checkLoginRateLimit,
  resetLoginRateLimit,
  clearAllLoginRateLimits,
  loginRateLimitConfig,
} from "./rate-limit";

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

/* ── Login rate limiter ────────────────────────────────────────────────── */

const LOGIN_CFG = { maxAttempts: 5, windowMs: 60_000, cooldownMs: 60_000 };
const clock = { now: 0 };

describe("login rate-limit", () => {
  beforeEach(() => {
    clock.now = 0;
    clearAllLoginRateLimits();
  });

  const check = (ip: string, user?: string) =>
    checkLoginRateLimit(ip, user, LOGIN_CFG, clock.now);

  it("allows login attempts below the threshold", () => {
    for (let i = 0; i < 5; i++) {
      const result = check("1.2.3.4", "alice");
      expect(result.ok).toBe(true);
      expect((result as { ok: true; remaining: number }).remaining).toBe(4 - i);
    }
  });

  it("blocks attempts above the threshold (per IP+user)", () => {
    expect(check("1.2.3.4", "alice").ok).toBe(true);
    for (let i = 0; i < 4; i++) check("1.2.3.4", "alice");
    const blocked = check("1.2.3.4", "alice");
    expect(blocked.ok).toBe(false);
    expect((blocked as { ok: false; retryAfter: number }).retryAfter).toBeGreaterThan(0);
  });

  it("isolates rate limits per IP while sharing the IP aggregate ceiling", () => {
    // Drain alice's account on IP 1.2.3.4 -> her per-user bucket trips and the
    // shared IP bucket reaches its ceiling.
    for (let i = 0; i < 5; i++) check("1.2.3.4", "alice");
    expect(check("1.2.3.4", "alice").ok).toBe(false);

    // A different IP has an independent budget (fresh bucket).
    const otherIp = check("5.6.7.8", "alice");
    expect(otherIp.ok).toBe(true);
    expect((otherIp as { ok: true; remaining: number }).remaining).toBe(4);
  });

  it("limits distinct users from the same IP via the shared IP bucket", () => {
    // Several one-off usernames from one IP (credential-stuffing pattern):
    // each fresh user gets their own per-user budget, but the shared IP ceiling
    // still caps total attempts from that IP.
    for (const u of ["a", "b", "c", "d", "e"]) check("9.9.9.9", u);
    const blocked = check("9.9.9.9", "f");
    expect(blocked.ok).toBe(false);
  });

  it("does not double-count: a request keyed only by IP gets IP quota only", () => {
    // With no username the IP bucket handles 5 attempts.
    for (let i = 0; i < 5; i++) check("7.7.7.7");
    expect(check("7.7.7.7").ok).toBe(false);
  });

  it("resets the per-user bucket on success", () => {
    for (let i = 0; i < 5; i++) check("1.2.3.4", "alice");
    expect(check("1.2.3.4", "alice").ok).toBe(false);

    resetLoginRateLimit("1.2.3.4", "alice");
    const after = check("1.2.3.4", "alice");
    expect(after.ok).toBe(true);
    expect((after as { ok: true; remaining: number }).remaining).toBe(4);
  });

  it("resets the window after it expires, restoring quota", () => {
    for (let i = 0; i < 5; i++) check("1.2.3.4", "alice");
    expect(check("1.2.3.4", "alice").ok).toBe(false);

    clock.now += LOGIN_CFG.windowMs + 1;
    const after = check("1.2.3.4", "alice");
    expect(after.ok).toBe(true);
    expect((after as { ok: true; remaining: number }).remaining).toBe(4);
  });

  it("applies exponential backoff that persists across window resets", () => {
    // A base cooldown well under the window lets us exercise three escalating
    // trips within a single window (no prune interference).
    const boCfg = { maxAttempts: 5, windowMs: 60_000, cooldownMs: 10_000 };
    const boCheck = (user?: string) => checkLoginRateLimit("1.2.3.4", user, boCfg, clock.now);

    // Trip 1: exhaust the window, then the next attempt trips.
    for (let i = 0; i < 5; i++) boCheck("alice");
    const trip1 = boCheck("alice") as { ok: false; retryAfter: number };
    expect(trip1.ok).toBe(false);
    expect(trip1.retryAfter).toBe(boCfg.cooldownMs); // base cooldown

    // While still blocked we remain blocked with a shrinking retryAfter.
    clock.now += 1;
    const mid = boCheck("alice") as { ok: false; retryAfter: number };
    expect(mid.ok).toBe(false);
    expect(mid.retryAfter).toBeLessThan(boCfg.cooldownMs);

    // Cooldown expires (window not yet reset). Exhaust again -> doubled backoff.
    clock.now += boCfg.cooldownMs;
    for (let i = 0; i < 5; i++) boCheck("alice");
    const trip2 = boCheck("alice") as { ok: false; retryAfter: number };
    expect(trip2.ok).toBe(false);
    expect(trip2.retryAfter).toBe(boCfg.cooldownMs * 2);

    // Third consecutive trip -> 4x.
    clock.now += boCfg.cooldownMs * 2;
    for (let i = 0; i < 5; i++) boCheck("alice");
    const trip3 = boCheck("alice") as { ok: false; retryAfter: number };
    expect(trip3.ok).toBe(false);
    expect(trip3.retryAfter).toBe(boCfg.cooldownMs * 4);
  });

  it("respects env overrides for the limiter config", () => {
    const cfg = loginRateLimitConfig({
      PRIVGATE_LOGIN_RATE_LIMIT_MAX: "3",
      PRIVGATE_LOGIN_RATE_LIMIT_WINDOW_MS: "30000",
      PRIVGATE_LOGIN_RATE_LIMIT_COOLDOWN_MS: "15000",
    });
    expect(cfg).toEqual({ maxAttempts: 3, windowMs: 30000, cooldownMs: 15000 });
  });

  it("falls back to sane defaults when env is absent or invalid", () => {
    expect(loginRateLimitConfig()).toEqual({ maxAttempts: 5, windowMs: 60000, cooldownMs: 60000 });
    expect(
      loginRateLimitConfig({
        PRIVGATE_LOGIN_RATE_LIMIT_MAX: "abc",
        PRIVGATE_LOGIN_RATE_LIMIT_WINDOW_MS: "-50",
        PRIVGATE_LOGIN_RATE_LIMIT_COOLDOWN_MS: "0",
      }),
    ).toEqual({ maxAttempts: 5, windowMs: 60000, cooldownMs: 60000 });
  });
});
