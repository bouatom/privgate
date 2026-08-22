import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { issueSession, sessionCookie } from "@/lib/auth";
import { getPortalPasswordHash, getPortalUserByEmail } from "@/lib/portal";
import { verifyPassword } from "@/lib/passwords";

export async function POST(req: Request) {
  if ((process.env.AUTH_MODE || "development") === "entra") {
    return NextResponse.json({ error: "dev login disabled" }, { status: 403 });
  }
  let body: { email?: string; password?: string };
  try {
    body = (await req.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const email = body.email?.trim();
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
  const user = getPortalUserByEmail(getDb(), email);
  if (!user || user.disabled || !user.permissions.length) {
    return NextResponse.json({ error: "not an admin" }, { status: 401 });
  }
  if (user.kind === "sso") {
    return NextResponse.json({ error: "sso required" }, { status: 401 });
  }
  const packed = getPortalPasswordHash(getDb(), user.id);
  if (!packed) {
    // No password hash stored. Allow only in explicit development mode so a
    // seeded/test account never becomes a backdoor in non-Entra deployments.
    if (process.env.NODE_ENV !== "development") {
      return NextResponse.json({ error: "not an admin" }, { status: 401 });
    }
  } else if (!body.password || !verifyPassword(body.password, packed)) {
    return NextResponse.json({ error: "not an admin" }, { status: 401 });
  }
  const token = await issueSession({ id: user.id, email: user.email, name: user.displayName });
  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(sessionCookie(token));
  return res;
}
