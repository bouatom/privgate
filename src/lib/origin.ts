/**
 * Resolve the public origin of a request.
 *
 * The origin ends up in OAuth redirect URIs and in the installer's ApiBase, so an
 * attacker-controlled value would point enrolled endpoints or an Entra callback at
 * a host of their choosing. `Host` and `X-Forwarded-*` are both client-supplied,
 * so neither is trusted by default:
 *
 *  - `PRIVGATE_PUBLIC_ORIGIN` wins outright when set (recommended behind a proxy).
 *  - `PRIVGATE_TRUSTED_HOSTS` is a comma-separated allowlist of `host[:port]`
 *    values that may come from the request headers.
 *  - `PRIVGATE_TRUST_PROXY=1` additionally allows `X-Forwarded-Proto` /
 *    `X-Forwarded-Host`, still subject to the allowlist above.
 *
 * With none of these set the request URL's own host is used, which is correct for
 * the default loopback deployment.
 */

type Env = Record<string, string | undefined>;

function trustedHosts(env: Env): string[] {
  return (env.PRIVGATE_TRUSTED_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowedHost(host: string, allowed: string[]): boolean {
  return allowed.includes(host.trim().toLowerCase());
}

export function requestOrigin(req: Request, env: Env = process.env): string {
  const configured = (env.PRIVGATE_PUBLIC_ORIGIN || "").trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Fall through to header resolution rather than emitting a malformed origin.
    }
  }

  const url = new URL(req.url);
  const allowed = trustedHosts(env);
  const trustProxy = env.PRIVGATE_TRUST_PROXY === "1";

  let host = url.host;
  let proto = url.protocol.replace(":", "");

  if (allowed.length) {
    const candidates = trustProxy
      ? [req.headers.get("x-forwarded-host"), req.headers.get("host")]
      : [req.headers.get("host")];
    for (const candidate of candidates) {
      if (candidate && isAllowedHost(candidate, allowed)) {
        host = candidate.trim();
        break;
      }
    }
  }

  if (trustProxy) {
    const forwardedProto = (req.headers.get("x-forwarded-proto") || "").split(",")[0]?.trim();
    if (forwardedProto === "http" || forwardedProto === "https") proto = forwardedProto;
  }

  return `${proto}://${host}`;
}

export function setupRedirectUris(origin: string): string[] {
  const uris = [
    `${origin}/api/setup/entra/callback`,
    `${origin}/api/auth/entra/callback`,
  ];
  if (origin !== "http://localhost:3000") {
    uris.push("http://localhost:3000/api/setup/entra/callback");
    uris.push("http://localhost:3000/api/auth/entra/callback");
  }
  return [...new Set(uris)];
}
