import { NextResponse } from "next/server";
import { getDb, appendAudit } from "@/lib/db";
import { isResponse, requireAdmin, requireAny } from "@/lib/http";
import { createPortalUser, listPortalUsers } from "@/lib/portal";

export async function GET() {
  const auth = await requireAny(["portal.users.manage", "portal.roles.manage"]);
  if (isResponse(auth)) return auth;
  return NextResponse.json(listPortalUsers(getDb()));
}

export async function POST(req: Request) {
  const auth = await requireAdmin("portal.users.manage");
  if (isResponse(auth)) return auth;
  const body = (await req.json()) as {
    displayName?: string;
    email?: string;
    kind?: "local" | "sso";
    password?: string;
    entraOid?: string;
    roleIds?: string[];
  };
  const db = getDb();
  const created = createPortalUser(db, {
    displayName: body.displayName || "",
    email: body.email || "",
    kind: body.kind === "sso" ? "sso" : "local",
    password: body.password,
    entraOid: body.entraOid,
    roleIds: body.roleIds || [],
  });
  if ("error" in created) return NextResponse.json(created, { status: 400 });
  appendAudit(db, auth.session.email, "portal.user.create", created.id, {
    email: created.email,
    kind: created.kind,
    roles: created.roleNames,
  });
  return NextResponse.json(created, { status: 201 });
}
