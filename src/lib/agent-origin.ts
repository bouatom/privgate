type Log = {
  warn: (message?: unknown, ...optional: unknown[]) => void;
  error: (message?: unknown, ...optional: unknown[]) => void;
};

type Env = Record<string, string | undefined>;

/**
 * Validates that the WebSocket Origin header matches the configured agent origin.
 * Prevents origin-hijacking attacks (DNS rebinding, MITM origin spoofing).
 *
 * @param requestOrigin Value from the `Origin` header (or empty string if absent)
 * @param env Environment variables (used to resolve PRIVGATE_AGENT_ORIGIN)
 * @param logger Optional logger for diagnostics
 * @returns true if origin is valid, false if rejected
 */
export function validateAgentOrigin(
  requestOrigin: string,
  env: Env = process.env,
  logger?: Log,
): boolean {
  if (!requestOrigin) {
    // Browsers always send Origin header; absence suggests automated tool
    // (not necessarily malicious, but log it)
    logger?.warn("WebSocket upgrade missing Origin header");
    return false;
  }

  const explicit = (env.PRIVGATE_AGENT_ORIGIN || "").trim();
  let expectedOrigin = "";

  if (explicit) {
    try {
      expectedOrigin = new URL(explicit).origin;
    } catch {
      logger?.error(`Invalid PRIVGATE_AGENT_ORIGIN: ${explicit}`);
      return false;
    }
  } else {
    // Fallback: derive from PRIVGATE_PUBLIC_ORIGIN or compute from bind/port
    const publicOrigin = (env.PRIVGATE_PUBLIC_ORIGIN || "").trim();
    if (publicOrigin) {
      try {
        const url = new URL(publicOrigin);
        const agentPort = env.PRIVGATE_AGENT_PORT || "3001";
        url.port = agentPort;
        expectedOrigin = url.origin;
      } catch {
        logger?.error(`Invalid PRIVGATE_PUBLIC_ORIGIN: ${publicOrigin}`);
        return false;
      }
    } else {
      // Cannot validate without explicit origin configuration
      logger?.warn("WebSocket origin validation: PRIVGATE_AGENT_ORIGIN not configured, rejecting connection");
      return false;
    }
  }

  // Case-insensitive origin comparison (origins are scheme://host:port)
  const matches = requestOrigin.toLowerCase() === expectedOrigin.toLowerCase();
  if (!matches) {
    logger?.warn(`WebSocket origin mismatch: got ${requestOrigin}, expected ${expectedOrigin}`);
  }
  return matches;
}
