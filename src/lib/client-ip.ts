/**
 * Resolve the connecting client's source IP for the device record.
 *
 * Mirrors the trust model in `src/lib/origin.ts`: `X-Forwarded-For` is
 * client-supplied, so it is only honoured when the operator has explicitly
 * opted into trusting a proxy via `PRIVGATE_TRUST_PROXY=1`. Otherwise we fall
 * back to the socket's remote address, which reflects the actual peer the
 * control plane accepted (loopback / reverse-proxy LAN address when one sits
 * in front, but never a value the device picks arbitrarily).
 */

type Env = Record<string, string | undefined>;

/** Normalize a raw remote/forwarded value; '' when absent or unusable. */
function normalizeIp(raw: string | undefined): string {
  if (!raw) return "";
  const value = raw.trim();
  if (!value || value === "unknown") return "";
  // Strip the IPv4-mapped IPv6 prefix (::ffff:1.2.3.4) Node reports on Linux.
  if (value.startsWith("::ffff:")) return value.slice(7);
  return value;
}

export function resolveClientIp(
  opts: { remoteAddress?: string; forwardedFor?: string | null | undefined },
  env: Env = process.env,
): string {
  const trustProxy = env.PRIVGATE_TRUST_PROXY === "1";
  if (trustProxy) {
    const fromXff = normalizeIp(opts.forwardedFor?.split(",")[0]?.trim());
    if (fromXff) return fromXff;
  }
  return normalizeIp(opts.remoteAddress);
}
