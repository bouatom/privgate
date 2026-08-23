/**
 * Session cookies must be Secure only on HTTPS. Chromium treats http://localhost
 * as a secure context, so a production cookie with Secure still works on the
 * console host and silently fails from another device on http://<lan-ip>:3000.
 */

type Env = NodeJS.Dict<string | undefined>;

export function cookieSecure(req?: Request, env: Env = process.env): boolean {
  const forced = (env.PRIVGATE_COOKIE_SECURE || "").trim().toLowerCase();
  if (forced === "1" || forced === "true") return true;
  if (forced === "0" || forced === "false") return false;

  const publicOrigin = (env.PRIVGATE_PUBLIC_ORIGIN || "").trim().toLowerCase();
  if (publicOrigin.startsWith("https://")) return true;
  if (publicOrigin.startsWith("http://")) return false;

  if (req && env.PRIVGATE_TRUST_PROXY === "1") {
    const proto = (req.headers.get("x-forwarded-proto") || "").split(",")[0]?.trim().toLowerCase();
    if (proto === "https") return true;
    if (proto === "http") return false;
  }

  if (req) {
    try {
      if (new URL(req.url).protocol === "https:") return true;
    } catch {
      /* ignore malformed request URLs */
    }
  }
  return false;
}
