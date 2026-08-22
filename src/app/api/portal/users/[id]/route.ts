import { NextResponse } from "next/server";
import { getDb, appendAudit } from "@/lib/db";
import { isResponse, requireAdmin } from "@/lib/http";
import { getPortalUser, updatePortalUser } from "@/lib/portal";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin("portal.users.manage");
  if (isResponse(auth)) return auth;
  const { id } = await ctx.params;
  const body = (await req.json()) as {
    displayName?: string;
    kind?: "local" | "sso";
    password?: string;
    entraOid?: string;
    disabled?: boolean;
    roleIds?: string[];
  };
  const db = getDb();
  if (body.disabled === true && id === auth.session.id) {
    return NextResponse.json({ error: "You cannot disable your own portal account." }, { status: 400 });
  }
  const updated = updatePortalUser(db, id, body);
  if ("error" in updated) return NextResponse.json(updated, { status: 400 });
  appendAudit(db, auth.session.email, "portal.user.update", id, {
    disabled: updated.disabled,
    roles: updated.roleNames,
  });
  return NextResponse.json(updated);
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin("portal.users.manage");
  if (isResponse(auth)) return auth;
  const { id } = await ctx.params;
  const user = getPortalUser(getDb(), id);
  if (!user) return NextResponse.json({ error: "unknown user" }, { status: 404 });
  return NextResponse.json(user);
}
