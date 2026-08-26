type Log = {
  warn: (message?: unknown, ...optional: unknown[]) => void;
  error: (message?: unknown, ...optional: unknown[]) => void;
};

type Env = Record<string, string | undefined>;

/**
 * Origin the control plane expects on browser WebSockets.
 * Native .NET ClientWebSocket does not send Origin at all.
 */
export function expectedAgentOrigin(env: Env = process.env, logger?: Log): string | null {
  const explicit = (env.PRIVGATE_AGENT_ORIGIN || "").trim();
  if (explicit) {
    try {
      return new URL(explicit).origin;
    } catch {
      logger?.error(`Invalid PRIVGATE_AGENT_ORIGIN: ${explicit}`);
      return null;
    }
  }

  const publicOrigin = (env.PRIVGATE_PUBLIC_ORIGIN || "").trim();
  if (!publicOrigin) return null;
  try {
    const url = new URL(publicOrigin);
    url.port = env.PRIVGATE_AGENT_PORT || "3001";
    return url.origin;
  } catch {
    logger?.error(`Invalid PRIVGATE_PUBLIC_ORIGIN: ${publicOrigin}`);
    return null;
  }
}

/**
 * HMAC already authenticated this upgrade. Origin is extra CSRF for browsers.
 *
 * - Missing Origin: native agent — allow (contract since 43d75cc).
 * - Literal "null" Origin: some clients/proxies send this sentinel when there
 *   is no meaningful origin — treat like missing; HMAC is the gate.
 * - Origin present: must match expected when we can compute it.
 * - Origin present but expected unknown (typical LAN): allow; HMAC is the gate.
 */
export function validateAgentOrigin(
  requestOrigin: string,
  env: Env = process.env,
  logger?: Log,
): boolean {
  const origin = requestOrigin.trim();
  if (!origin || origin.toLowerCase() === "null") return true;

  const expected = expectedAgentOrigin(env, logger);
  if (!expected) {
    logger?.warn("WebSocket Origin present but PRIVGATE_AGENT_ORIGIN is unset; allowing HMAC agent");
    return true;
  }

  const matches = origin.toLowerCase() === expected.toLowerCase();
  if (!matches) {
    logger?.warn(`WebSocket origin mismatch: got ${origin}, expected ${expected}`);
  }
  return matches;
}
