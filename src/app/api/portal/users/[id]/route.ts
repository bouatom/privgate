import { NextResponse } from "next/server";
import { getDb, appendAudit } from "@/lib/db";
import { isResponse, requireAdmin } from "@/lib/http";
import { getPortalUser, getPortalPasswordHash, patchUser, deletePortalUser } from "@/lib/portal";
import { checkStepUpPassword } from "@/lib/stepup";

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
  const { stepUpPassword, ...body } = (await req.json()) as {
    displayName?: string;
    kind?: "local" | "sso";
    password?: string;
    entraOid?: string;
    disabled?: boolean;
    roleIds?: string[];
    stepUpPassword?: string;
  };

  // Step-up security: a Master Admin can reset ANY account's password
  // (including another Master Admin's) using only a session cookie. Before we
  // apply a password change we require the acting admin to re-confirm their own
  // current password, so a single stolen/left-open session is not enough to
  // change credentials. See checkStepUpPassword for the full rule set.
  const db = getDb();
  const settingPassword = Boolean(body.password && body.password.length > 0);
  if (settingPassword) {
    const acting = getPortalUser(db, auth.session.id);
    const decision = checkStepUpPassword({
      settingPassword,
      actingKind: acting?.kind,
      actingPasswordHash: acting ? getPortalPasswordHash(db, acting.id) : "",
      stepUpPassword,
    });
    if (!decision.ok) {
      return NextResponse.json({ error: decision.error }, { status: decision.status });
    }
  }

  const updated = patchUser(db, id, body);
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