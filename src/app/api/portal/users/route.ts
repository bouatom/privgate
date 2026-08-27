import { NextResponse } from "next/server";
import { getDb, appendAudit } from "@/lib/db";
import { isResponse, requireAdmin, requireAny } from "@/lib/http";
import { createPortalUser, listPortalUsers, patchUser } from "@/lib/portal";

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

export async function PATCH(req: Request) {
  const auth = await requireAdmin("portal.users.manage");
  if (isResponse(auth)) return auth;
  const body = (await req.json()) as {
    ids?: string[];
    roleIds?: string[];
    disabled?: boolean;
    displayName?: string;
  };
  const db = getDb();
  const results = [];
  const errors = [];

  // Handle bulk operations
  const ids = Array.isArray(body.ids) ? body.ids : body.ids ? [body.ids] : [];

  if (ids.length > 0) {
    for (const id of ids) {
      const result = patchUser(db, id, {
        disabled: body.disabled,
        roleIds: body.roleIds,
        displayName: body.displayName,
      });
      if ("error" in result) {
        errors.push({ id, error: result.error });
      } else {
        results.push(result);
      }
    }
    if (errors.length > 0) {
      return NextResponse.json({ results, errors }, { status: 400 });
    }
    appendAudit(db, "system", "portal.users.bulk.update", "bulk", { count: results.length, errors: errors.length });
    return NextResponse.json({ results, errors });
  }

  // Single user update (backward compatibility)
  const { id, ...patch } = body as { id?: string } & typeof body;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const result = patchUser(db, id, patch);
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  appendAudit(db, "system", "portal.user.patch", id, patch);
  return NextResponse.json(result);
}