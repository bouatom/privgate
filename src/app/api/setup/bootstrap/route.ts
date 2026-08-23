import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { issueSession, sessionCookie } from "@/lib/auth";
import { assertPassword } from "@/lib/passwords";
import { createPortalUser, portalNeedsSetup } from "@/lib/portal";

export async function POST(req: Request) {
  const db = getDb();
  if (!portalNeedsSetup(db)) {
    return NextResponse.json({ error: "already configured" }, { status: 409 });
  }
  let body: { email?: string; password?: string; displayName?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const email = (body.email || "").trim();
  const displayName = (body.displayName || "").trim() || email.split("@")[0] || "Administrator";
  const problem = assertPassword(body.password);
  if (!email.includes("@")) return NextResponse.json({ error: "valid email required" }, { status: 400 });
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  const created = createPortalUser(db, {
    displayName,
    email,
    kind: "local",
    password: body.password,
    roleIds: ["role-master-admin"],
  });
  if ("error" in created) {
    return NextResponse.json({ error: created.error }, { status: 400 });
  }
  const token = await issueSession({ id: created.id, email: created.email, name: created.displayName });
  const res = NextResponse.json({ ok: true, email: created.email });
  res.cookies.set(sessionCookie(token, req));
  return res;
}
