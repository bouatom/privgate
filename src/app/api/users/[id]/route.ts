import { NextResponse } from "next/server";
import { getDb, patchUser, appendAudit } from "@/lib/db";
import { isResponse, requireAdmin } from "@/lib/http";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin("directory.users.manage");
  if (isResponse(auth)) return auth;
  const { id } = await ctx.params;
  // Disabling directory users is out of product scope; only JIT eligibility
  // is patchable. Legacy `disabled` payloads are ignored outright.
  const body = (await req.json()) as { jitEligible?: boolean };
  const user = patchUser(getDb(), id, body);
  if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });
  appendAudit(getDb(), auth.session.email, "user.patch", id, { jitEligible: Boolean(body.jitEligible) });
  return NextResponse.json({
    id: user.id,
    displayName: user.displayName,
    jitEligible: user.jitEligible === 1,
  });
}
