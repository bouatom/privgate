import { NextResponse } from "next/server";
import { getDb, deletePolicy, appendAudit } from "@/lib/db";
import { isResponse, requireAdmin } from "@/lib/http";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin("PolicyAdmin");
  if (isResponse(auth)) return auth;
  const { id } = await ctx.params;
  const db = getDb();
  if (!deletePolicy(db, id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  appendAudit(db, auth.session.email, "policy.delete", id, {});
  return new NextResponse(null, { status: 204 });
}
