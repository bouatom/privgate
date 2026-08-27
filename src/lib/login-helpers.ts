import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { localLoginEnabled } from "@/lib/auth-mode";
import { issueSession, sessionCookie } from "@/lib/auth";
import { getPortalPasswordHash, getPortalUserByEmail } from "@/lib/portal";
import { verifyPassword, dummyVerify } from "@/lib/passwords";
import { checkLoginRateLimit } from "@/lib/rate-limit";

export async function loginPost(req: Request) {
  if (!localLoginEnabled()) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }
  let body: { email?: string; password?: string };
  try {
    body = (await req.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = checkLoginRateLimit(ip);
  if (!rl.ok) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfter / 1000)) } });
  }
  const email = body.email?.trim();
  const password = body.password || "";
  if (!email || !password) return NextResponse.json({ error: "invalid credentials" }, { status: 401 });

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

  const token = await issueSession({ id: user!.id, email: user!.email, name: user!.displayName });
  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(sessionCookie(token, req));
  return res;
}
