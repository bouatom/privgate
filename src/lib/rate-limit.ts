/**
 * In-memory rate limiters.
 *
 * Two independent limiter families live here:
 *  - A device request limiter (sliding window) used by the agent endpoints.
 *  - A login rate limiter used by the local admin password login.
 *
 * The login limiter is keyed by client IP and (when known) IP+username, keeps a
 * bounded in-memory map (stale entries are pruned), and blocks with an
 * exponential backoff that grows across repeated limit trips. It never stores
 * credentials — only counts and timestamps.
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

/* ── Login rate limiter ─────────────────────────────────────────────────── */

/** Persisted per-key state for the login limiter. */
interface LoginBucket {
  /** Number of (failed) login attempts in the current window. */
  count: number;
  /** When the current attempt-counting window ends. */
  resetAt: number;
  /** Timestamp until which the key is blocked; 0 = not blocked. */
  blockedUntil: number;
  /** Consecutive trips of the limit; drives exponential backoff. */
  cooldownLevel: number;
}

/** Tunable login rate-limit parameters. */
export interface LoginRateLimitConfig {
  /** Max allowed attempts per window per key. */
  maxAttempts: number;
  /** Length of the attempt-counting window in ms. */
  windowMs: number;
  /** Base cooldown (ms) applied when the limit is exceeded; grows 2x per trip. */
  cooldownMs: number;
}

/** Cheap guard to bound memory: sweep expired entries at most this often. */
const PRUNE_EVERY_MS = 60_000;

/** Caps exponential backoff growth so a single abandoned IP cannot escalate indefinitely. */
const MAX_COOLDOWN_LEVEL = 6;

const loginBuckets = new Map<string, LoginBucket>();
let lastPruneAt = 0;

function toPositiveInt(value: string | undefined, fallback: number): number {
  const n = value === undefined ? NaN : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Reads the login rate-limit configuration from the environment, with sane
 * defaults (5 attempts / 60s window / 60s base cooldown). Overridable via:
 *   PRIVGATE_LOGIN_RATE_LIMIT_MAX
 *   PRIVGATE_LOGIN_RATE_LIMIT_WINDOW_MS
 *   PRIVGATE_LOGIN_RATE_LIMIT_COOLDOWN_MS
 */
export function loginRateLimitConfig(
  env: Record<string, string | undefined> = process.env,
): LoginRateLimitConfig {
  return {
    maxAttempts: toPositiveInt(env.PRIVGATE_LOGIN_RATE_LIMIT_MAX, 5),
    windowMs: toPositiveInt(env.PRIVGATE_LOGIN_RATE_LIMIT_WINDOW_MS, 60_000),
    cooldownMs: toPositiveInt(env.PRIVGATE_LOGIN_RATE_LIMIT_COOLDOWN_MS, 60_000),
  };
}

function pruneExpiredLoginBuckets(now: number): void {
  if (now - lastPruneAt < PRUNE_EVERY_MS) return;
  lastPruneAt = now;
  for (const [key, bucket] of loginBuckets) {
    if (now >= bucket.resetAt && now >= bucket.blockedUntil) {
      loginBuckets.delete(key);
    }
  }
}

/** Applies one attempt to a single key's bucket. Never stores credentials. */
function attemptLoginKey(
  key: string,
  cfg: LoginRateLimitConfig,
  now: number,
): { ok: true; remaining: number } | { ok: false; retryAfter: number } {
  const existing = loginBuckets.get(key);
  if (!existing || now >= existing.resetAt) {
    loginBuckets.set(key, {
      count: 0,
      resetAt: now + cfg.windowMs,
      // A cooldown in flight persists across a window reset so a persistent
      // attacker cannot simply wait out the window to dodge the backoff.
      blockedUntil: existing ? existing.blockedUntil : 0,
      cooldownLevel: existing ? existing.cooldownLevel : 0,
    });
  }
  const bucket = loginBuckets.get(key)!;

  // Still inside a cool-down from an earlier trip.
  if (now < bucket.blockedUntil) {
    return { ok: false, retryAfter: bucket.blockedUntil - now };
  }

  if (bucket.count >= cfg.maxAttempts) {
    // Trip the limit: grow the backoff exponentially, capped so an abandoned IP
    // cannot accrue an unbounded block.
    bucket.cooldownLevel = Math.min(bucket.cooldownLevel + 1, MAX_COOLDOWN_LEVEL);
    const backoff = cfg.cooldownMs * 2 ** (bucket.cooldownLevel - 1);
    bucket.blockedUntil = now + backoff;
    return { ok: false, retryAfter: backoff };
  }

  bucket.count += 1;
  return { ok: true, remaining: cfg.maxAttempts - bucket.count };
}

/**
 * Checks a login attempt against both the client-IP aggregate bucket and the
 * IP+username bucket (when a username is supplied). Returns
 * { ok: true; remaining } when allowed, or { ok: false; retryAfter } when the
 * attempt must be rejected.
 *
 * The per-key state is reset automatically when the window expires, and for the
 * targeted user bucket via {@link resetLoginRateLimit} on a successful login.
 * Credentials are never stored.
 */
export function checkLoginRateLimit(
  ip: string,
  username?: string,
  cfg: LoginRateLimitConfig = loginRateLimitConfig(),
  now: number = Date.now(),
): { ok: true; remaining: number } | { ok: false; retryAfter: number } {
  pruneExpiredLoginBuckets(now);

  const keys = [ip];
  if (username) keys.push(`${ip}::${username}`);

  // Any key still inside its cooldown blocks the attempt. (Cooldown persists
  // across a window reset, so only `blockedUntil` matters here.)
  let longestWait = 0;
  for (const key of keys) {
    const bucket = loginBuckets.get(key);
    if (bucket && now < bucket.blockedUntil) {
      longestWait = Math.max(longestWait, bucket.blockedUntil - now);
    }
  }
  if (longestWait > 0) {
    return { ok: false, retryAfter: longestWait };
  }

  // Apply the attempt to each key; return the most restrictive result.
  let result: { ok: true; remaining: number } | undefined;
  for (const key of keys) {
    const r = attemptLoginKey(key, cfg, now);
    if (!r.ok) return r;
    if (!result || r.remaining < result.remaining) result = r;
  }
  return result!;
}

/**
 * Resets the login buckets, e.g. after a successful login, so a legitimate user
 * who fat-fingered a few attempts is not left in a lockout. Clears both the
 * shared IP bucket and the targeted IP+username bucket. Because this only fires
 * on a *successful* credential check (which an attacker cannot produce), it does
 * not weaken anti-stuffing protection.
 */
export function resetLoginRateLimit(ip: string, username?: string): void {
  loginBuckets.delete(ip);
  if (username) loginBuckets.delete(`${ip}::${username}`);
}

/** Clears all login buckets (tests / cache cleanup). */
export function clearAllLoginRateLimits(): void {
  loginBuckets.clear();
  lastPruneAt = 0;
}
