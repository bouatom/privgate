import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { localLoginEnabled } from "@/lib/auth-mode";
import { issueSession, sessionCookie } from "@/lib/auth";
import { getPortalPasswordHash, getPortalUserByEmail } from "@/lib/portal";
import { verifyPassword, dummyVerify } from "@/lib/passwords";
import { checkLoginRateLimit, resetLoginRateLimit } from "@/lib/rate-limit";
import { bodyTooLarge, maxBodyBytes, readJsonWithLimit } from "@/lib/request-guard";

export async function loginPost(req: Request) {
  if (!localLoginEnabled()) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }
  const maxBytes = maxBodyBytes();
  if (bodyTooLarge(req, maxBytes)) {
    return NextResponse.json({ error: "request body too large" }, { status: 413 });
  }
  const read = await readJsonWithLimit<{ email?: string; password?: string }>(req, maxBytes);
  if (!read.ok) {
    return NextResponse.json(
      { error: read.reason === "too_large" ? "request body too large" : "invalid credentials" },
      { status: read.reason === "too_large" ? 413 : 401 },
    );
  }
  const body = read.value;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const email = body.email?.trim();
  const password = body.password || "";
  if (!email || !password) return NextResponse.json({ error: "invalid credentials" }, { status: 401 });

  // Key by IP (aggregate throttle against credential stuffing) and IP+username
  // (targeted brute-force) so a user draining one account cannot starve others.
  const rl = checkLoginRateLimit(ip, email);
  if (!rl.ok) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfter / 1000)) } });
  }

  // Constant-time login: run a dummy scrypt whenever the user is missing so the
  // timing of a nonexistent email matches that of a real-but-wrong-password
  // attempt. Prevents user enumeration via response latency.
  const db = getDb();
  const user = getPortalUserByEmail(db, email);
  const usable = user && !user.disabled && user.permissions.length && user.kind !== "sso";
  const packed = usable ? getPortalPasswordHash(db, user.id) : null;

  let ok = false;
  if (packed) {
    ok = verifyPassword(password, packed);
  } else {
    dummyVerify(password); // burn the same ~N ms as a real scrypt
    ok = false;
  }

  if (!usable || !ok) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  // Successful login: clear the rate-limit buckets so a legitimate user who
  // fat-fingered a few attempts is not left in a lockout. This only fires on a
  // verified credential, so it does not weaken brute-force protection.
  resetLoginRateLimit(ip, email);

  const token = await issueSession({ id: user!.id, email: user!.email, name: user!.displayName });
  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(sessionCookie(token, req));
  return res;
}
