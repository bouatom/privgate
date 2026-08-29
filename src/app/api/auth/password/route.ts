import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getPortalPasswordHash, getPortalUserByEmail } from "@/lib/portal";
import { verifyPassword, hashPassword, assertPassword } from "@/lib/passwords";
import { bodyTooLarge, maxBodyBytes, readJsonWithLimit } from "@/lib/request-guard";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const maxBytes = maxBodyBytes();
  if (bodyTooLarge(req, maxBytes)) {
    return NextResponse.json({ error: "request body too large" }, { status: 413 });
  }
  const read = await readJsonWithLimit<{
    currentPassword?: string;
    newPassword?: string;
    confirmPassword?: string;
  }>(req, maxBytes);
  if (!read.ok) {
    return NextResponse.json(
      { error: read.reason === "too_large" ? "request body too large" : "invalid request" },
      { status: read.reason === "too_large" ? 413 : 400 },
    );
  }
  const body = read.value;
  const currentPassword = body.currentPassword?.trim();
  const newPassword = body.newPassword?.trim();
  const confirmPassword = body.confirmPassword?.trim();

  if (!currentPassword || !newPassword || !confirmPassword) {
    return NextResponse.json({ error: "all fields required" }, { status: 400 });
  }
  if (newPassword !== confirmPassword) {
    return NextResponse.json({ error: "passwords do not match" }, { status: 400 });
  }

  const problem = assertPassword(newPassword);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const db = getDb();
  const user = getPortalUserByEmail(db, session.email);
  if (!user || user.kind !== "local") {
    return NextResponse.json({ error: "password change only for local users" }, { status: 400 });
  }

  const packed = getPortalPasswordHash(db, user.id);
  if (!packed) {
    return NextResponse.json({ error: "no password set" }, { status: 400 });
  }

  const ok = verifyPassword(currentPassword, packed);
  if (!ok) {
    return NextResponse.json({ error: "current password incorrect" }, { status: 401 });
  }

  const newHash = hashPassword(newPassword);
  db.prepare("UPDATE portal_users SET password_hash = ? WHERE id = ?").run(newHash, user.id);

  return NextResponse.json({ ok: true });
}