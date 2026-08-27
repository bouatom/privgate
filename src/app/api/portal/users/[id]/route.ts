import { NextResponse } from "next/server";
import { getDb, appendAudit } from "@/lib/db";
import { isResponse, requireAdmin } from "@/lib/http";
import { getPortalUser, updatePortalUser, deletePortalUser } from "@/lib/portal";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin("portal.users.manage");
  if (isResponse(auth)) return auth;
  const { id } = await params;
  const db = getDb();
  const current = getPortalUser(db, id);
  if (!current) return NextResponse.json({ error: "unknown user" }, { status: 404 });
  if (current.kind === "local" && current.id === auth.session.id) {
    return NextResponse.json({ error: "cannot delete yourself" }, { status: 400 });
  }
  const res = deletePortalUser(db, id);
  if ("error" in res) return NextResponse.json(res, { status: 400 });
  appendAudit(db, auth.session.email, "portal.user.delete", id, {
    email: current.email,
  });
  return NextResponse.json({ ok: true });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin("portal.users.manage");
  if (isResponse(auth)) return auth;
  const { id } = await params;
  const body = (await req.json()) as {
    displayName?: string;
    kind?: "local" | "sso";
    password?: string;
    entraOid?: string;
    disabled?: boolean;
    roleIds?: string[];
  };
  const db = getDb();
  const updated = updatePortalUser(db, id, body);
  if ("error" in updated) return NextResponse.json(updated, { status: 400 });
  appendAudit(db, auth.session.email, "portal.user.update", id, {
    email: updated.email,
    kind: updated.kind,
    roles: updated.roleNames,
  });
  return NextResponse.json(updated);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin("portal.users.manage");
  if (isResponse(auth)) return auth;
  const { id } = await params;
  const db = getDb();
  const user = getPortalUser(db, id);
  if (!user) return NextResponse.json({ error: "unknown user" }, { status: 404 });
  return NextResponse.json(user);
}