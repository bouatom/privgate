import { NextResponse } from "next/server";
import { getDb, appendAudit } from "@/lib/db";
import { isResponse, requireAdmin } from "@/lib/http";
import { deleteRole, getRole, updateRole } from "@/lib/portal";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin("portal.roles.manage");
  if (isResponse(auth)) return auth;
  const { id } = await ctx.params;
  const role = getRole(getDb(), id);
  if (!role) return NextResponse.json({ error: "unknown role" }, { status: 404 });
  return NextResponse.json(role);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin("portal.roles.manage");
  if (isResponse(auth)) return auth;
  const { id } = await ctx.params;
  const body = (await req.json()) as { name?: string; description?: string; permissions?: string[] };
  const db = getDb();
  const updated = updateRole(db, id, body);
  if ("error" in updated) return NextResponse.json(updated, { status: 400 });
  appendAudit(db, auth.session.email, "portal.role.update", id, { name: updated.name });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin("portal.roles.manage");
  if (isResponse(auth)) return auth;
  const { id } = await ctx.params;
  const db = getDb();
  const result = deleteRole(db, id);
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  appendAudit(db, auth.session.email, "portal.role.delete", id, {});
  return NextResponse.json({ ok: true });
}
