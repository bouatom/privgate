import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { issueSession, sessionCookie } from "@/lib/auth";
import { assertPassword } from "@/lib/passwords";
import { createPortalUser, portalNeedsSetup } from "@/lib/portal";
import { bodyTooLarge, maxBodyBytes, readJsonWithLimit } from "@/lib/request-guard";

export async function POST(req: Request) {
  const maxBytes = maxBodyBytes();
  if (bodyTooLarge(req, maxBytes)) {
    return NextResponse.json({ error: "request body too large" }, { status: 413 });
  }
  const db = getDb();
  if (!portalNeedsSetup(db)) {
    return NextResponse.json({ error: "already configured" }, { status: 409 });
  }
  const read = await readJsonWithLimit<{ email?: string; password?: string; displayName?: string }>(req, maxBytes);
  if (!read.ok) {
    return NextResponse.json(
      { error: read.reason === "too_large" ? "request body too large" : "invalid json" },
      { status: read.reason === "too_large" ? 413 : 400 },
    );
  }
  const body = read.value;
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
