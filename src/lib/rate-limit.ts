/**
 * In-memory rate limiter for device requests.
 * Tracks per-device request counts within sliding time windows.
 */

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateLimitBucket>();

/**
 * Checks if a device has exceeded its rate limit.
 * Uses a sliding window: resets every `windowMs` milliseconds.
 *
 * @param deviceId Unique device identifier
 * @param windowMs Time window in milliseconds (default: 60000)
 * @param maxRequests Maximum requests allowed per window (default: 30)
 * @returns { ok: true; remaining: number } if allowed, { ok: false; retryAfter: number } if rate-limited
 */
export function checkDeviceRateLimit(
  deviceId: string,
  windowMs: number = 60000,
  maxRequests: number = 30,
): { ok: true; remaining: number } | { ok: false; retryAfter: number } {
  const now = Date.now();
  let bucket = buckets.get(deviceId);

  // Initialize or reset bucket if window has expired
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(deviceId, bucket);
  }

  // Check if rate limit exceeded
  if (bucket.count >= maxRequests) {
    const retryAfter = bucket.resetAt - now;
    return { ok: false, retryAfter };
  }

  // Increment and return remaining
  bucket.count++;
  const remaining = maxRequests - bucket.count;
  return { ok: true, remaining };
}

/**
 * Resets the rate limit bucket for a device.
 * Use this when a device is re-enrolled or explicitly reset.
 *
 * @param deviceId Unique device identifier
 */
export function resetDeviceRateLimit(deviceId: string): void {
  buckets.delete(deviceId);
}

/**
 * Clears all rate limit buckets.
 * Useful for tests or cache cleanup.
 */
export function clearAllRateLimits(): void {
  buckets.clear();
}

/**
 * Returns current bucket state (for testing/debugging).
 */
export function getDeviceRateLimitState(deviceId: string): RateLimitBucket | undefined {
  return buckets.get(deviceId);
}
