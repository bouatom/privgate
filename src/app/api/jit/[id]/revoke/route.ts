import { NextResponse } from "next/server";
import { getDb, revokeJit, appendAudit } from "@/lib/db";
import { isResponse, requireAdmin } from "@/lib/http";
import { notifyJitRevoke } from "@/lib/realtime/notify";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin("jit.revoke");
  if (isResponse(auth)) return auth;
  const { id } = await ctx.params;
  const db = getDb();
  const grant = revokeJit(db, id, auth.session.email);
  if (!grant) return NextResponse.json({ error: "not found" }, { status: 404 });
  appendAudit(db, auth.session.email, "jit.revoke", id, {});
  notifyJitRevoke(grant);
  return new NextResponse(null, { status: 204 });
}
