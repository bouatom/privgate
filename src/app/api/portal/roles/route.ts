import { NextResponse } from "next/server";
import { getDb, appendAudit } from "@/lib/db";
import { isResponse, requireAdmin, requireAny } from "@/lib/http";
import { createRole, listRoles } from "@/lib/portal";
import { PERMISSIONS } from "@/lib/permissions";

export async function GET() {
  const auth = await requireAny(["portal.users.manage", "portal.roles.manage"]);
  if (isResponse(auth)) return auth;
  return NextResponse.json({ roles: listRoles(getDb()), catalog: PERMISSIONS });
}

export async function POST(req: Request) {
  const auth = await requireAdmin("portal.roles.manage");
  if (isResponse(auth)) return auth;
  const body = (await req.json()) as { name?: string; description?: string; permissions?: string[] };
  const db = getDb();
  const created = createRole(db, {
    name: body.name || "",
    description: body.description,
    permissions: body.permissions || [],
  });
  if ("error" in created) return NextResponse.json(created, { status: 400 });
  appendAudit(db, auth.session.email, "portal.role.create", created.id, { name: created.name });
  return NextResponse.json(created, { status: 201 });
}
