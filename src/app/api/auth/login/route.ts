import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { localLoginEnabled } from "@/lib/auth-mode";
import { issueSession, sessionCookie } from "@/lib/auth";
import { getPortalPasswordHash, getPortalUserByEmail } from "@/lib/portal";
import { verifyPassword } from "@/lib/passwords";

export async function POST(req: Request) {
  if (!localLoginEnabled()) {
    return NextResponse.json({ error: "local login disabled" }, { status: 403 });
  }
  let body: { email?: string; password?: string };
  try {
    body = (await req.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const email = body.email?.trim();
  const password = body.password || "";
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
  if (!password) return NextResponse.json({ error: "password required" }, { status: 401 });
  const user = getPortalUserByEmail(getDb(), email);
  if (!user || user.disabled || !user.permissions.length) {
    return NextResponse.json({ error: "not an admin" }, { status: 401 });
  }
  if (user.kind === "sso") {
    return NextResponse.json({ error: "sso required" }, { status: 401 });
  }
  const packed = getPortalPasswordHash(getDb(), user.id);
  if (!packed || !verifyPassword(password, packed)) {
    return NextResponse.json({ error: "not an admin" }, { status: 401 });
  }
  const token = await issueSession({ id: user.id, email: user.email, name: user.displayName });
  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(sessionCookie(token));
  return res;
}
