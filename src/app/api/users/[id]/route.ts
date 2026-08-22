import { NextResponse } from "next/server";
import { getDb, getUser, patchUser, appendAudit } from "@/lib/db";
import { isResponse, requireAdmin } from "@/lib/http";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin("directory.users.manage");
  if (isResponse(auth)) return auth;
  const { id } = await ctx.params;
  const body = (await req.json()) as { jitEligible?: boolean; disabled?: boolean };
  const db = getDb();
  const current = getUser(db, id);
  if (body.disabled === true && current?.userPrincipalName.toLowerCase() === auth.session.email.toLowerCase()) {
    return NextResponse.json({ error: "You cannot disable your own account." }, { status: 400 });
  }
  const user = patchUser(db, id, body);
  if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });
  appendAudit(db, auth.session.email, "user.patch", id, body as Record<string, unknown>);
  return NextResponse.json({
    id: user.id,
    displayName: user.displayName,
    jitEligible: user.jitEligible === 1,
    disabled: user.disabled === 1,
  });
}
