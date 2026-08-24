import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isResponse, requireAdmin } from "@/lib/http";
import { requestAgentUpdate } from "@/lib/agent-update";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin("devices.update");
  if (isResponse(auth)) return auth;
  const { id } = await ctx.params;
  const result = requestAgentUpdate(getDb(), id, auth.session.email);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, version: result.version, queued: Boolean(result.queued) });
}
